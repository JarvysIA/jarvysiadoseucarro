// Edge Function: gerar-pix-asaas
// CPF Just-in-Time + blindagem contra price spoofing.
//
// Entrada (POST JSON):
//   { user_id, veiculo_id?, tipo, cpf?, codigo_cupom?, descricao? }
//   tipo ∈ "ativacao" | "historico" | "mensalidade"
//     (aceita também legado "mensalidade_carro")
//
// Saída:
//   { pagamento_id, asaas_payment_id, payload, encodedImage, valor, status }
//
// Env vars: ASAAS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ASAAS_BASE = "https://api.asaas.com/v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Tipo = "ativacao" | "historico" | "mensalidade";

interface PixRequest {
  user_id: string;
  veiculo_id?: string | null;
  tipo?: Tipo | "mensalidade_carro" | null;
  tipo_produto?: Tipo | "mensalidade_carro" | null; // legado
  cpf?: string | null;
  codigo_cupom?: string | null;
  descricao?: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function friendlyError(status: number, payload: unknown): string {
  const errs = (payload as { errors?: { code?: string; description?: string }[] })?.errors;
  const first = errs?.[0];
  const code = (first?.code ?? "").toLowerCase();
  const desc = (first?.description ?? "").toLowerCase();
  if (status === 401 || code.includes("unauthorized") || code.includes("invalid_api_key")) {
    return "Pagamento indisponível no momento (falha de autorização). Tente novamente em instantes.";
  }
  if (code.includes("cpfcnpj") || desc.includes("cpf") || desc.includes("cnpj")) {
    return "CPF inválido para registro. Verifique o número e tente novamente.";
  }
  if (
    code.includes("account_disabled") ||
    code.includes("under_analysis") ||
    desc.includes("análise") ||
    desc.includes("analise")
  ) {
    return "Pagamentos em ativação. Tente novamente em alguns minutos.";
  }
  return first?.description || "Não foi possível gerar o PIX agora. Tente novamente.";
}

function normalizarTipo(t: unknown): Tipo | null {
  if (t === "ativacao" || t === "historico" || t === "mensalidade") return t;
  if (t === "mensalidade_carro") return "mensalidade";
  return null;
}

function validarCPF(cpf: string): boolean {
  const s = cpf.replace(/\D/g, "");
  if (s.length !== 11 || /^(\d)\1+$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(s[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(s[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(s[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(s[10]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const apiKey = Deno.env.get("ASAAS_API_KEY");
    if (!apiKey) {
      console.error("[gerar-pix-asaas] ASAAS_API_KEY ausente");
      return json({ error: "Configuração de pagamento indisponível." }, 500);
    }

    const body = (await req.json()) as PixRequest;
    const user_id = body?.user_id;
    const veiculo_id = body?.veiculo_id ?? null;
    const tipo = normalizarTipo(body?.tipo ?? body?.tipo_produto ?? "ativacao");
    const codigo_cupom = body?.codigo_cupom ?? null;
    const descricao = body?.descricao ?? "Jarvys - Pagamento";
    const cpfInput = (body?.cpf ?? "").replace(/\D/g, "");

    if (!user_id || !tipo) {
      return json({ error: "Parâmetros inválidos (user_id e tipo obrigatórios)" }, 400);
    }
    if ((tipo === "historico") && !veiculo_id) {
      return json({ error: "veiculo_id obrigatório para este tipo de pagamento" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 1) Carrega o perfil (cpf + asaas_customer_id + nome)
    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("id, nome, cpf, asaas_customer_id")
      .eq("id", user_id)
      .maybeSingle();
    if (pErr) {
      console.error("[gerar-pix-asaas] erro select profile:", pErr);
      return json({ error: "Falha ao carregar perfil." }, 500);
    }
    if (!profile) return json({ error: "Perfil não encontrado." }, 404);

    // 2) CPF Just-in-Time
    let cpfFinal = (profile.cpf ?? "").replace(/\D/g, "");
    if (!cpfFinal) {
      if (!cpfInput) {
        return json(
          { error: "CPF obrigatório para gerar PIX (exigência do Banco Central)." },
          400,
        );
      }
      if (!validarCPF(cpfInput)) {
        return json({ error: "CPF inválido. Verifique e tente novamente." }, 400);
      }
      cpfFinal = cpfInput;
    }

    // 3) Server-side price (anti spoofing)
    let valorFinal: number;
    let cupomValidoFlag = false;
    if (tipo === "ativacao") {
      const cupomTrim = (codigo_cupom ?? "").toString().trim();
      if (cupomTrim !== "") {
        const { data: padrinhoId, error: cupomErr } = await supabase.rpc(
          "validar_cupom_indicacao",
          { _codigo: cupomTrim },
        );
        if (cupomErr) console.error("[gerar-pix-asaas] erro RPC cupom:", cupomErr);
        cupomValidoFlag = !!padrinhoId && padrinhoId !== user_id;
        console.info("[gerar-pix-asaas] cupom:", { cupomTrim, cupomValidoFlag });
      }
      valorFinal = cupomValidoFlag ? 19.9 : 29.9;
    } else if (tipo === "historico") {
      valorFinal = 49.9;
    } else {
      valorFinal = 9.9; // mensalidade
    }

    // 4) Resolve dados do pagador
    const { data: userResp } = await supabase.auth.admin.getUserById(user_id);
    const email =
      userResp?.user?.email ?? `user-${user_id.slice(0, 8)}@jarvys.com.br`;
    const nome =
      profile.nome ??
      (userResp?.user?.user_metadata?.full_name as string | undefined) ??
      (userResp?.user?.user_metadata?.name as string | undefined) ??
      "Cliente Jarvys";

    // 5) Customer no Asaas (try/catch — CPF fake => 400 amigável)
    let customerId = profile.asaas_customer_id ?? null;
    if (!customerId) {
      try {
        const cRes = await fetch(`${ASAAS_BASE}/customers`, {
          method: "POST",
          headers: { access_token: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nome,
            email,
            cpfCnpj: cpfFinal,
            externalReference: user_id,
          }),
        });
        const cData = await cRes.json();
        if (!cRes.ok) {
          console.error("[gerar-pix-asaas] erro customer:", cRes.status, cData);
          return json({ error: friendlyError(cRes.status, cData) }, 400);
        }
        customerId = cData?.id ?? null;
      } catch (e) {
        console.error("[gerar-pix-asaas] exceção customer:", e);
        return json({ error: "Não foi possível registrar o cliente no PIX." }, 502);
      }
      if (!customerId) return json({ error: "Falha ao criar cliente no Asaas." }, 502);

      // persiste cpf + customer_id no profile
      const { error: updProfErr } = await supabase
        .from("profiles")
        .update({ cpf: cpfFinal, asaas_customer_id: customerId })
        .eq("id", user_id);
      if (updProfErr) console.error("[gerar-pix-asaas] erro persist profile:", updProfErr);
    } else if (!profile.cpf) {
      // já tinha customer no Asaas mas perdemos o CPF — repõe
      await supabase.from("profiles").update({ cpf: cpfFinal }).eq("id", user_id);
    }

    // 6) Pré-insert do pagamento local
    const { data: pagamentoPre, error: preErr } = await supabase
      .from("pagamentos_pix")
      .insert({
        user_id,
        veiculo_id,
        valor: valorFinal,
        codigo_cupom,
        status: "pendente",
        tipo_produto: tipo === "mensalidade" ? "mensalidade_carro" : tipo,
        produto_ref_id: veiculo_id,
        metadata: { provedor: "asaas", tipo },
      })
      .select("id")
      .single();
    if (preErr || !pagamentoPre) {
      console.error("[gerar-pix-asaas] erro pre-insert:", preErr);
      return json({ error: "Falha ao registrar pagamento." }, 500);
    }
    const pagamentoId = pagamentoPre.id as string;

    // 7) externalReference DNA: [TIPO]_[USER_ID]_[VEICULO_ID]
    const externalRef = `${tipo}_${user_id}_${veiculo_id ?? "none"}`;

    const hoje = new Date();
    const dueDate = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}-${String(hoje.getUTCDate()).padStart(2, "0")}`;

    const payRes = await fetch(`${ASAAS_BASE}/payments`, {
      method: "POST",
      headers: { access_token: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: customerId,
        billingType: "PIX",
        value: valorFinal,
        dueDate,
        description: descricao,
        externalReference: externalRef,
      }),
    });
    const payData = await payRes.json();
    if (!payRes.ok) {
      console.error("[gerar-pix-asaas] erro payment:", payRes.status, payData);
      await supabase.from("pagamentos_pix").update({ status: "cancelado" }).eq("id", pagamentoId);
      return json({ error: friendlyError(payRes.status, payData) }, 502);
    }
    const asaasPaymentId = String(payData?.id ?? "");

    // 8) QR Code
    const qrRes = await fetch(`${ASAAS_BASE}/payments/${asaasPaymentId}/pixQrCode`, {
      headers: { access_token: apiKey, "Content-Type": "application/json" },
    });
    const qrData = await qrRes.json();
    if (!qrRes.ok) {
      console.error("[gerar-pix-asaas] erro qrCode:", qrRes.status, qrData);
      return json({ error: friendlyError(qrRes.status, qrData) }, 502);
    }
    const payload: string | null = qrData?.payload ?? null;
    const encodedImage: string | null = qrData?.encodedImage ?? null;

    await supabase
      .from("pagamentos_pix")
      .update({
        txid_efi: asaasPaymentId,
        pix_copia_cola: payload,
        metadata: {
          provedor: "asaas",
          tipo,
          external_reference: externalRef,
          asaas_payment_id: asaasPaymentId,
          asaas_customer_id: customerId,
          qr_base64: encodedImage,
          expiration: qrData?.expirationDate ?? null,
          cupom_valido: cupomValidoFlag,
        },
      })
      .eq("id", pagamentoId);

    console.info("[gerar-pix-asaas] sucesso:", {
      pagamentoId,
      asaasPaymentId,
      tipo,
      valor: valorFinal,
    });

    return json({
      pagamento_id: pagamentoId,
      asaas_payment_id: asaasPaymentId,
      payload,
      encodedImage,
      qr_code: payload,
      qr_code_base64: encodedImage,
      valor: valorFinal,
      status: "pendente",
    });
  } catch (e) {
    console.error("[gerar-pix-asaas] erro inesperado:", e);
    return json({ error: "Erro inesperado ao gerar PIX. Tente novamente." }, 500);
  }
});
