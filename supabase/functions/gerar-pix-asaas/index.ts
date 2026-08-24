// Edge Function: gerar-pix-asaas (Build 8.2 — hardened)
// Cria cobrança PIX na Asaas e persiste em pagamentos_pix.
//
// HARDENING (Build 8.2):
// - Exige JWT Supabase válido no header Authorization.
// - user_id é derivado do token (claim `sub`). `user_id` do body é ignorado.
// - veiculo_id é validado quanto à posse pelo user autenticado.
// - Preço é calculado server-side por tabela fixa; `valor` do body é ignorado.
// - Cupom é validado via RPC `validar_cupom_indicacao`; só reduz preço quando
//   pertence a outro perfil (padrinho ≠ afilhado).
// - tipo_produto restrito a "ativacao" | "historico".
//
// Secrets: ASAAS_API_KEY, ASAAS_ENV ("production" | "sandbox", default production),
//          SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type AnySupabaseClient = ReturnType<typeof createClient<any>>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tabela de preços — fonte única de verdade server-side.
const PRECO_ATIVACAO = 29.9;
const PRECO_ATIVACAO_COM_CUPOM = 19.9;
const PRECO_HISTORICO = 49.9;

interface PixRequest {
  // Aceitos apenas para compatibilidade de contrato; user_id do body é ignorado.
  user_id?: string;
  veiculo_id: string;
  valor?: number; // ignorado — preço vem da tabela server-side
  codigo_cupom?: string | null;
  tipo_produto?: "ativacao" | "historico" | null;
  produto_ref_id?: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asaasBaseUrl(): string {
  const env = (Deno.env.get("ASAAS_ENV") ?? "production").toLowerCase();
  return env === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";
}

async function asaasFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetch(`${asaasBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      access_token: apiKey,
      "Content-Type": "application/json",
      "User-Agent": "Jarvys/1.0",
    },
  });
}

class CpfRequiredError extends Error {
  constructor() {
    super("CPF é obrigatório para gerar o PIX (exigência do Banco Central).");
    this.name = "CpfRequiredError";
  }
}

async function ensureCustomer(
  apiKey: string,
  supabase: AnySupabaseClient,
  user_id: string,
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("asaas_customer_id, nome, email, whatsapp, cpf")
    .eq("id", user_id)
    .maybeSingle();

  const cpfDigits = (profile?.cpf ?? "").toString().replace(/\D/g, "");
  if (!cpfDigits || cpfDigits.length < 11) {
    throw new CpfRequiredError();
  }

  const baseBody: Record<string, unknown> = {
    name: profile?.nome ?? "Cliente Jarvys",
    email: profile?.email ?? undefined,
    mobilePhone: profile?.whatsapp ?? undefined,
    cpfCnpj: cpfDigits,
    externalReference: user_id,
  };

  if (profile?.asaas_customer_id) {
    const existingId = profile.asaas_customer_id as string;
    const updRes = await asaasFetch(
      apiKey,
      `/customers/${encodeURIComponent(existingId)}`,
      { method: "POST", body: JSON.stringify(baseBody) },
    );
    if (updRes.ok) {
      return existingId;
    }
    if (updRes.status === 404) {
      await supabase
        .from("profiles")
        .update({ asaas_customer_id: null })
        .eq("id", user_id);
    } else {
      const raw = await updRes.json().catch(() => ({}));
      throw new Error(
        `Asaas /customers/${existingId} ${updRes.status}: ${JSON.stringify(raw)}`,
      );
    }
  }

  const res = await asaasFetch(apiKey, "/customers", {
    method: "POST",
    body: JSON.stringify(baseBody),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Asaas /customers ${res.status}: ${JSON.stringify(raw)}`,
    );
  }
  const customerId = (raw as { id?: string }).id;
  if (!customerId) throw new Error("Asaas customer sem id");

  await supabase
    .from("profiles")
    .update({ asaas_customer_id: customerId })
    .eq("id", user_id);

  return customerId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // 1) Autenticação obrigatória via JWT Supabase.
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "UNAUTHORIZED", message: "Token ausente" }, 401);
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return json({ error: "UNAUTHORIZED", message: "Token vazio" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Cliente com o token do usuário — apenas para validar identidade.
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return json({ error: "UNAUTHORIZED", message: "Token inválido" }, 401);
    }
    const authUserId = userData.user.id;

    // 2) Parse do body — user_id é IGNORADO, quem manda é o token.
    let body: PixRequest;
    try {
      body = (await req.json()) as PixRequest;
    } catch {
      return json({ error: "INVALID_BODY" }, 400);
    }

    const veiculo_id = (body.veiculo_id ?? "").toString().trim();
    if (!veiculo_id) {
      return json({ error: "INVALID_BODY", message: "veiculo_id obrigatório" }, 400);
    }

    const tipo: "ativacao" | "historico" =
      body.tipo_produto === "historico" ? "historico" : "ativacao";

    const codigoCupomBruto = (body.codigo_cupom ?? "").toString().trim();

    // 3) Cliente service-role para operações de DB (bypassa RLS de forma controlada).
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 4) Confirma posse do veículo pelo usuário autenticado.
    const { data: veiculoRow, error: errVeic } = await supabase
      .from("veiculos")
      .select("id, user_id")
      .eq("id", veiculo_id)
      .maybeSingle();
    if (errVeic) throw errVeic;
    if (!veiculoRow || veiculoRow.user_id !== authUserId) {
      return json(
        { error: "FORBIDDEN", message: "Veículo não pertence ao usuário" },
        403,
      );
    }

    // 5) Preço server-side. `valor` do body é IGNORADO.
    let valor: number;
    let cupomAplicado: string | null = null;

    if (tipo === "historico") {
      valor = PRECO_HISTORICO;
    } else {
      valor = PRECO_ATIVACAO;
      if (codigoCupomBruto) {
        try {
          const { data: padrinhoId, error: errRpc } = await supabase.rpc(
            "validar_cupom_indicacao",
            { _codigo: codigoCupomBruto },
          );
          if (errRpc) throw errRpc;
          const padrinho = (padrinhoId as string | null) ?? null;
          if (padrinho && padrinho !== authUserId) {
            valor = PRECO_ATIVACAO_COM_CUPOM;
            cupomAplicado = codigoCupomBruto;
          }
        } catch (e) {
          // Cupom inválido não bloqueia — cai no preço cheio.
          console.warn("[gerar-pix-asaas] cupom inválido:", e);
        }
      }
    }

    const apiKey = Deno.env.get("ASAAS_API_KEY");
    if (!apiKey) return json({ error: "ASAAS_API_KEY ausente" }, 500);

    const asaas_customer_id = await ensureCustomer(apiKey, supabase, authUserId);

    const dueDate = new Date().toISOString().slice(0, 10);
    const description =
      tipo === "historico"
        ? "Histórico Premium Jarvys"
        : "Ativação Jarvys - Licença por veículo";

    const payRes = await asaasFetch(apiKey, "/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: asaas_customer_id,
        billingType: "PIX",
        value: Number(valor.toFixed(2)),
        dueDate,
        description,
        externalReference: `${authUserId}:${veiculo_id}:${tipo}`,
      }),
    });
    const payJson = await payRes.json().catch(() => ({}));
    if (!payRes.ok) {
      throw new Error(`Asaas /payments ${payRes.status}: ${JSON.stringify(payJson)}`);
    }
    const asaas_payment_id = (payJson as { id?: string }).id;
    if (!asaas_payment_id) throw new Error("Asaas payment sem id");

    const qrRes = await asaasFetch(
      apiKey,
      `/payments/${encodeURIComponent(asaas_payment_id)}/pixQrCode`,
    );
    const qrJson = await qrRes.json().catch(() => ({}));
    if (!qrRes.ok) {
      throw new Error(`Asaas /pixQrCode ${qrRes.status}: ${JSON.stringify(qrJson)}`);
    }
    const payload = (qrJson as { payload?: string }).payload ?? "";
    const encodedImage =
      (qrJson as { encodedImage?: string }).encodedImage ?? null;
    if (!payload) throw new Error("Asaas pixQrCode sem payload");

    const produto_ref_id = tipo === "historico"
      ? (body.produto_ref_id ?? veiculo_id)
      : null;

    const { data: inserted, error: insertError } = await supabase
      .from("pagamentos_pix")
      .insert({
        user_id: authUserId,
        veiculo_id,
        valor,
        codigo_cupom: cupomAplicado,
        tipo_produto: tipo,
        produto_ref_id,
        status: "pendente",
        txid_efi: asaas_payment_id,
        pix_copia_cola: payload,
        metadata: {
          gateway: "asaas",
          asaas_payment_id,
          asaas_customer_id,
          preco_origem: "server_side_table_v1",
        },
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    return json({
      success: true,
      id: inserted.id,
      pix_copia_cola: payload,
      qr_code_base64: encodedImage,
      txid_efi: asaas_payment_id,
      valor,
      cupom_aplicado: cupomAplicado !== null,
    });
  } catch (err) {
    console.error("[gerar-pix-asaas]", err);
    if (err instanceof CpfRequiredError) {
      return json({ error: "CPF_REQUIRED", message: err.message }, 400);
    }
    return json(
      { error: err instanceof Error ? err.message : "Erro desconhecido" },
      500,
    );
  }
});
