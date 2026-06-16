// Edge Function: gerar-pix-asaas
// Gera cobrança PIX via Asaas (POST /v3/payments + GET /v3/payments/{id}/pixQrCode)
// e persiste em pagamentos_pix. Mantém a coluna txid_efi (nome genérico) p/ guardar o id.
//
// Env vars:
//   ASAAS_API_KEY  (chave de produção do painel Asaas)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ASAAS_BASE = "https://api.asaas.com/v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TipoProduto = "ativacao" | "historico" | "mensalidade_carro";

interface PixRequest {
  user_id: string;
  veiculo_id?: string | null;
  valor: number;
  codigo_cupom?: string | null;
  tipo_produto?: TipoProduto | null;
  produto_ref_id?: string | null;
  descricao?: string | null;
  payer_email?: string | null;
  payer_name?: string | null;
  payer_cpf?: string | null;
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
  const desc = first?.description ?? "";
  if (status === 401 || code.includes("unauthorized") || code.includes("invalid_api_key")) {
    return "Pagamento indisponível no momento (falha de autorização). Tente novamente em instantes.";
  }
  if (
    code.includes("account_disabled") ||
    code.includes("under_analysis") ||
    desc.toLowerCase().includes("análise") ||
    desc.toLowerCase().includes("analise")
  ) {
    return "Pagamentos em ativação. Tente novamente em alguns minutos.";
  }
  return desc || "Não foi possível gerar o PIX agora. Tente novamente.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const apiKey = Deno.env.get("ASAAS_API_KEY");
    if (!apiKey) return json({ error: "ASAAS_API_KEY ausente" }, 500);

    const body = (await req.json()) as PixRequest;
    const {
      user_id,
      veiculo_id = null,
      valor,
      codigo_cupom = null,
      tipo_produto = "ativacao",
      produto_ref_id = null,
      descricao = "Jarvys - Pagamento",
      payer_email = null,
      payer_name = null,
      payer_cpf = null,
    } = body ?? {};

    if (!user_id || typeof valor !== "number" || valor <= 0) {
      return json({ error: "Parâmetros inválidos (user_id e valor obrigatórios)" }, 400);
    }

    // Admin client (service_role) — ignora RLS para validar cupom em profiles
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Preço fixo server-side (anti price spoofing)
    const PRECOS_FIXOS: Record<string, number> = {
      mensalidade_carro: 9.9,
      historico: 49.9,
    };

    let valorFinal: number;
    if (tipo_produto === "ativacao") {
      let cupomValido = false;
      const cupomTrim = (codigo_cupom ?? "").toString().trim();
      if (cupomTrim !== "") {
        const { data: padrinhoId, error: cupomErr } = await supabase.rpc(
          "validar_cupom_indicacao",
          { _codigo: cupomTrim },
        );
        if (cupomErr) console.error("[gerar-pix-asaas] erro RPC cupom:", cupomErr);
        cupomValido = !!padrinhoId && padrinhoId !== user_id;
        console.log("[gerar-pix-asaas] cupom:", { enviado: cupomTrim, padrinhoId, valido: cupomValido });
      }
      valorFinal = cupomValido ? 19.9 : 29.9;
    } else if (tipo_produto && PRECOS_FIXOS[tipo_produto] !== undefined) {
      valorFinal = PRECOS_FIXOS[tipo_produto];
    } else {
      valorFinal = Number(valor.toFixed(2));
    }

    // Resolve dados do pagador
    let email = payer_email;
    let nome = payer_name;
    if (!email || !nome) {
      const { data: userResp } = await supabase.auth.admin.getUserById(user_id);
      email = email ?? userResp?.user?.email ?? `user-${user_id.slice(0, 8)}@jarvys.com.br`;
      nome =
        nome ??
        (userResp?.user?.user_metadata?.full_name as string | undefined) ??
        (userResp?.user?.user_metadata?.name as string | undefined) ??
        "Cliente Jarvys";
    }

    // 1) Cria/recupera customer no Asaas
    const cpfDigits = (payer_cpf ?? "").replace(/\D/g, "");
    const customerPayload: Record<string, unknown> = {
      name: nome,
      email,
      externalReference: user_id,
    };
    if (cpfDigits.length === 11 || cpfDigits.length === 14) {
      customerPayload.cpfCnpj = cpfDigits;
    }

    // Procura customer existente pelo externalReference (user_id)
    let customerId: string | null = null;
    const findRes = await fetch(
      `${ASAAS_BASE}/customers?externalReference=${encodeURIComponent(user_id)}&limit=1`,
      { headers: { access_token: apiKey, "Content-Type": "application/json" } },
    );
    if (findRes.ok) {
      const findData = await findRes.json();
      customerId = findData?.data?.[0]?.id ?? null;
    }
    if (!customerId) {
      const cRes = await fetch(`${ASAAS_BASE}/customers`, {
        method: "POST",
        headers: { access_token: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(customerPayload),
      });
      const cData = await cRes.json();
      if (!cRes.ok) {
        console.error("[gerar-pix-asaas] erro customer:", cRes.status, cData);
        return json({ error: friendlyError(cRes.status, cData), details: cData }, 502);
      }
      customerId = cData?.id ?? null;
    }
    if (!customerId) return json({ error: "Falha ao criar cliente no Asaas" }, 502);

    // 2) externalReference do pagamento = pagamento_id local. Pré-cria registro para ter id.
    const { data: pagamentoPre, error: preErr } = await supabase
      .from("pagamentos_pix")
      .insert({
        user_id,
        veiculo_id,
        valor: valorFinal,
        codigo_cupom,
        status: "pendente",
        tipo_produto,
        produto_ref_id,
        metadata: { provedor: "asaas" },
      })
      .select("id")
      .single();
    if (preErr || !pagamentoPre) {
      console.error("[gerar-pix-asaas] erro pre-insert:", preErr);
      return json({ error: "Falha ao registrar pagamento", details: preErr?.message }, 500);
    }
    const pagamentoId = pagamentoPre.id as string;

    // 3) Cria cobrança PIX (vencimento hoje)
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
        externalReference: pagamentoId,
      }),
    });
    const payData = await payRes.json();
    if (!payRes.ok) {
      console.error("[gerar-pix-asaas] erro payment:", payRes.status, payData);
      await supabase.from("pagamentos_pix").update({ status: "cancelado" }).eq("id", pagamentoId);
      return json({ error: friendlyError(payRes.status, payData), details: payData }, 502);
    }
    const asaasPaymentId = String(payData?.id ?? "");

    // 4) Busca QR Code PIX
    const qrRes = await fetch(`${ASAAS_BASE}/payments/${asaasPaymentId}/pixQrCode`, {
      headers: { access_token: apiKey, "Content-Type": "application/json" },
    });
    const qrData = await qrRes.json();
    if (!qrRes.ok) {
      console.error("[gerar-pix-asaas] erro qrCode:", qrRes.status, qrData);
      return json({ error: friendlyError(qrRes.status, qrData), details: qrData }, 502);
    }
    const payload: string | null = qrData?.payload ?? null;
    const encodedImage: string | null = qrData?.encodedImage ?? null;

    await supabase
      .from("pagamentos_pix")
      .update({
        txid_efi: asaasPaymentId, // nome genérico — guarda id Asaas
        pix_copia_cola: payload,
        metadata: {
          provedor: "asaas",
          asaas_payment_id: asaasPaymentId,
          asaas_customer_id: customerId,
          qr_base64: encodedImage,
          expiration: qrData?.expirationDate ?? null,
        },
      })
      .eq("id", pagamentoId);

    return json({
      pagamento_id: pagamentoId,
      asaas_payment_id: asaasPaymentId,
      // chaves legadas (compat) + novas
      qr_code: payload,
      qr_code_base64: encodedImage,
      payload,
      encodedImage,
      valor: valorFinal,
      status: "pendente",
    });
  } catch (e) {
    console.error("[gerar-pix-asaas] erro:", e);
    return json({ error: "Erro inesperado ao gerar PIX. Tente novamente." }, 500);
  }
});
