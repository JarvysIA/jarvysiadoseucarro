// Edge Function: gerar-pix-mp
// Gera cobrança PIX via Mercado Pago (POST /v1/payments) e persiste em pagamentos_pix.
// Mantém o nome de coluna txid_efi (genérico) para guardar o id do pagamento MP.
//
// Env vars:
//   MERCADOPAGO_ACCESS_TOKEN  (production)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!token) return json({ error: "MERCADOPAGO_ACCESS_TOKEN ausente" }, 500);

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
    } = body ?? {};

    if (!user_id || typeof valor !== "number" || valor <= 0) {
      return json({ error: "Parâmetros inválidos (user_id e valor obrigatórios)" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve email do pagador se não veio
    let email = payer_email;
    if (!email) {
      const { data: userResp } = await supabase.auth.admin.getUserById(user_id);
      email = userResp?.user?.email ?? `user-${user_id.slice(0, 8)}@jarvys.com.br`;
    }

    const idempotencyKey = crypto.randomUUID();
    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: Number(valor.toFixed(2)),
        description: descricao,
        payment_method_id: "pix",
        payer: { email },
        metadata: { user_id, veiculo_id, tipo_produto, codigo_cupom, produto_ref_id },
      }),
    });

    const mpData = await mpRes.json();
    if (!mpRes.ok) {
      console.error("[gerar-pix-mp] erro MP:", mpRes.status, mpData);
      return json({ error: "Falha ao gerar PIX no Mercado Pago", details: mpData }, 502);
    }

    const mpPaymentId = String(mpData?.id ?? "");
    const qrCode =
      mpData?.point_of_interaction?.transaction_data?.qr_code ?? null;
    const qrBase64 =
      mpData?.point_of_interaction?.transaction_data?.qr_code_base64 ?? null;

    const { data: pagamento, error: insErr } = await supabase
      .from("pagamentos_pix")
      .insert({
        user_id,
        veiculo_id,
        valor,
        codigo_cupom,
        status: "pendente",
        txid_efi: mpPaymentId, // nome genérico — guarda id MP
        pix_copia_cola: qrCode,
        tipo_produto,
        produto_ref_id,
        metadata: {
          provedor: "mercadopago",
          mp_payment_id: mpPaymentId,
          qr_base64: qrBase64,
          idempotency_key: idempotencyKey,
        },
      })
      .select("id")
      .single();

    if (insErr) {
      console.error("[gerar-pix-mp] erro insert:", insErr);
      return json({ error: "Falha ao salvar pagamento", details: insErr.message }, 500);
    }

    return json({
      pagamento_id: pagamento.id,
      mp_payment_id: mpPaymentId,
      qr_code: qrCode,
      qr_code_base64: qrBase64,
      status: "pendente",
    });
  } catch (e) {
    console.error("[gerar-pix-mp] erro:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
