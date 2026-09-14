// Saque-Padrinho: efetiva UM saque pendente de comissão de indicação via
// transferência PIX real no Asaas.
//
// DECISÃO DE DESIGN: processarSaquePadrinho é INDEPENDENTE de quem a
// aciona. Hoje é chamada por um botão de admin (processarSaquePendenteFn em
// src/lib/admin-users.functions.ts, com assertSuperAdmin como gate manual);
// no futuro, quando o fluxo estiver validado, pode virar um cron automático
// (edge function agendada) SEM NENHUMA MUDANÇA nesta função — só troca o
// que decide "quando" pagar, nunca o "como" pagar.
//
// Este arquivo é um espelho intencional de src/lib/saque-padrinho.ts (não
// um import cross-boundary — confirmado que não dá: supabase/functions/
// roda em Deno e fica fora do tsconfig.json do app, que só inclui
// "src/**/*"). Mesmo padrão de duplicação já usado no projeto entre
// parse-receipt.ts (app) e a versão WhatsApp. Mudanças de lógica aqui
// devem ser espelhadas manualmente no lado do app, e vice-versa.
//
// detectPixKeyType duplicado inline (não vale a pena um arquivo próprio só
// pra isso do lado Deno) — mesma lógica de src/lib/pix-key-type.ts.

type PixAddressKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";

function detectPixKeyType(chaveRaw: string): PixAddressKeyType {
  const chave = (chaveRaw ?? "").trim();
  if (chave.includes("@")) return "EMAIL";
  if (chave.startsWith("+")) return "PHONE";
  const digits = chave.replace(/\D/g, "");
  if (digits.length === 11) return "CPF";
  if (digits.length === 14) return "CNPJ";
  return "EVP";
}

type MovimentacaoRow = {
  id: string;
  padrinho_id: string;
  valor: number;
  status: string;
};

type MovSelectBuilder = {
  eq(column: string, value: unknown): MovSelectBuilder;
  maybeSingle(): Promise<{ data: MovimentacaoRow | null; error: { message: string } | null }>;
};

type MovUpdateBuilder = {
  eq(column: string, value: unknown): MovUpdateBuilder;
  select(
    columns: string,
  ): Promise<{ data: { id: string }[] | null; error: { message: string } | null }>;
};

type ProfileRow = { pix_recebimento: string | null };

type ProfileSelectBuilder = {
  eq(column: string, value: unknown): ProfileSelectBuilder;
  maybeSingle(): Promise<{ data: ProfileRow | null; error: { message: string } | null }>;
};

type CarteiraRow = { saldo_reservado: number };

type CarteiraSelectBuilder = {
  eq(column: string, value: unknown): CarteiraSelectBuilder;
  maybeSingle(): Promise<{ data: CarteiraRow | null; error: { message: string } | null }>;
};

type CarteiraUpdateBuilder = {
  eq(column: string, value: unknown): Promise<{ error: { message: string } | null }>;
};

export type SaquePadrinhoClient = {
  from(table: "movimentacoes_indicacao"): {
    select(columns: string): MovSelectBuilder;
    update(row: { status: string }): MovUpdateBuilder;
  };
  from(table: "profiles"): {
    select(columns: string): ProfileSelectBuilder;
  };
  from(table: "carteiras_indicacao"): {
    select(columns: string): CarteiraSelectBuilder;
    update(row: { saldo_reservado: number }): CarteiraUpdateBuilder;
  };
};

export type ProcessarSaquePadrinhoDeps = {
  client: SaquePadrinhoClient;
  fetchImpl: typeof fetch;
};

export type SaquePadrinhoResult =
  | { ok: true; padrinhoId: string; valor: number }
  | { ok: false; erro: string };

function asaasBaseUrl(asaasEnv: string): string {
  return asaasEnv.toLowerCase() === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";
}

export async function processarSaquePadrinho(
  movimentacaoId: string,
  apiKey: string,
  asaasEnv: string,
  deps: ProcessarSaquePadrinhoDeps,
): Promise<SaquePadrinhoResult> {
  const { client, fetchImpl } = deps;

  // 1) Idempotência: só processa se ainda estiver 'reservado'.
  const { data: mov, error: movError } = await client
    .from("movimentacoes_indicacao")
    .select("id, padrinho_id, valor, status")
    .eq("id", movimentacaoId)
    .maybeSingle();
  if (movError) return { ok: false, erro: movError.message };
  if (!mov || mov.status !== "reservado") {
    return { ok: false, erro: "já processada ou inválida" };
  }

  // 2) Chave PIX do padrinho.
  const { data: profile, error: profError } = await client
    .from("profiles")
    .select("pix_recebimento")
    .eq("id", mov.padrinho_id)
    .maybeSingle();
  if (profError) return { ok: false, erro: profError.message };
  const chavePix = profile?.pix_recebimento?.trim();
  if (!chavePix) return { ok: false, erro: "padrinho sem chave PIX cadastrada" };

  const pixAddressKeyType = detectPixKeyType(chavePix);

  // 3) Transferência PIX real via Asaas.
  let transferRes: Response;
  try {
    transferRes = await fetchImpl(`${asaasBaseUrl(asaasEnv)}/transfers`, {
      method: "POST",
      headers: {
        access_token: apiKey,
        "Content-Type": "application/json",
        "User-Agent": "Jarvys/1.0",
      },
      body: JSON.stringify({
        value: mov.valor,
        pixAddressKey: chavePix,
        pixAddressKeyType,
        externalReference: movimentacaoId,
      }),
    });
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  if (!transferRes.ok) {
    const raw = await transferRes.json().catch(() => ({}));
    return { ok: false, erro: `Asaas /transfers ${transferRes.status}: ${JSON.stringify(raw)}` };
  }

  // 4) Marca pago — condicionado a status='reservado' na própria query
  // pra fechar a janela de corrida entre a leitura do passo 1 e esta
  // escrita: se `updatedRows` vier vazio, outro processo já pagou essa
  // movimentação nesse meio-tempo, e NÃO decrementamos a carteira de novo.
  const { data: updatedRows, error: updError } = await client
    .from("movimentacoes_indicacao")
    .update({ status: "pago" })
    .eq("id", movimentacaoId)
    .eq("status", "reservado")
    .select("id");
  if (updError) return { ok: false, erro: updError.message };
  if (!updatedRows || updatedRows.length === 0) {
    return { ok: false, erro: "já processada por outro processo (corrida)" };
  }

  // 5) Decrementa saldo_reservado. Leitura-e-escrita (não atômico em SQL
  // puro) — aceitável no fluxo atual (clique manual único de admin, ou um
  // cron sequencial); o guard do passo 4 já é o que protege contra
  // reprocessar a MESMA movimentação duas vezes.
  const { data: carteira, error: carteiraError } = await client
    .from("carteiras_indicacao")
    .select("saldo_reservado")
    .eq("user_id", mov.padrinho_id)
    .maybeSingle();
  if (carteiraError) return { ok: false, erro: carteiraError.message };

  const saldoAtual = carteira?.saldo_reservado ?? 0;
  const { error: carteiraUpdError } = await client
    .from("carteiras_indicacao")
    .update({ saldo_reservado: Math.max(0, saldoAtual - mov.valor) })
    .eq("user_id", mov.padrinho_id);
  if (carteiraUpdError) return { ok: false, erro: carteiraUpdError.message };

  return { ok: true, padrinhoId: mov.padrinho_id, valor: mov.valor };
}
