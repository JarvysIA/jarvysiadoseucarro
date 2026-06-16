// Edge Function: asaas-webhook
// Recebe notificações do Asaas (PAYMENT_RECEIVED, PAYMENT_CONFIRMED etc).
// Valida o header `asaas-access-token` (ASAAS_WEBHOOK_TOKEN) antes de processar.
// Identifica o pagamento via externalReference (pagamento_id local) e ativa o usuário.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET" || req.method === "HEAD")
    return new Response("ok", { status: 200, headers: corsHeaders });

  try {
    // 1) Validação do token de segurança do Asaas
    const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
    const receivedToken =
      req.headers.get("asaas-access-token") ?? req.headers.get("Asaas-Access-Token");
    if (!expectedToken || receivedToken !== expectedToken) {
      console.warn("[asaas-webhook] token inválido");
      return new Response("unauthorized", { status: 401 });
    }

    const payload = await req.json().catch(() => null);
    if (!payload) return new Response("ok", { status: 200 });

    const event = String(payload?.event ?? "");
    const pay = payload?.payment ?? {};
    const externalReference = String(pay?.externalReference ?? "");
    const asaasPaymentId = String(pay?.id ?? "");
    const status = String(pay?.status ?? "");

    console.log("[asaas-webhook] evento:", { event, externalReference, asaasPaymentId, status });

    // Só processa eventos de pagamento confirmado/recebido
    const eventosPagos = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED_IN_CASH"]);
    if (!eventosPagos.has(event)) {
      return new Response("ok", { status: 200 });
    }

    if (!externalReference && !asaasPaymentId) {
      console.warn("[asaas-webhook] sem identificador");
      return new Response("ok", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Busca por externalReference (pagamento_id local) ou fallback por txid_efi (asaas id)
    const query = supabase
      .from("pagamentos_pix")
      .select("id, user_id, veiculo_id, valor, codigo_cupom, status, tipo_produto, metadata");
    const { data: pagamento, error: selErr } = externalReference
      ? await query.eq("id", externalReference).maybeSingle()
      : await query.eq("txid_efi", asaasPaymentId).maybeSingle();

    if (selErr) {
      console.error("[asaas-webhook] erro select:", selErr);
      return new Response("err", { status: 500 });
    }
    if (!pagamento) {
      console.warn("[asaas-webhook] pagamento não encontrado:", { externalReference, asaasPaymentId });
      return new Response("ok", { status: 200 });
    }

    if (pagamento.status === "pago") {
      console.log("[asaas-webhook] já estava pago — idempotente");
      return new Response("ok", { status: 200 });
    }

    // Marca como pago (idempotência via .neq)
    const { data: upd, error: updErr } = await supabase
      .from("pagamentos_pix")
      .update({
        status: "pago",
        txid_efi: asaasPaymentId || pagamento_txid_safe(pagamento),
        metadata: {
          ...(pagamento.metadata ?? {}),
          asaas_status: status,
          asaas_event: event,
          asaas_paid_at: pay?.paymentDate ?? pay?.clientPaymentDate ?? new Date().toISOString(),
          asaas_payment_id: asaasPaymentId,
        },
      })
      .eq("id", pagamento.id)
      .neq("status", "pago")
      .select("id")
      .maybeSingle();

    if (updErr) {
      console.error("[asaas-webhook] erro update:", updErr);
      return new Response("err", { status: 500 });
    }
    if (!upd) {
      console.log("[asaas-webhook] concorrência: já marcado por outra invocação");
      return new Response("ok", { status: 200 });
    }

    // Efeitos pós-pagamento
    if (pagamento.veiculo_id) {
      await supabase
        .from("veiculos")
        .update({ status_pagamento: "ativo" })
        .eq("id", pagamento.veiculo_id);
    }

    if (pagamento.tipo_produto === "mensalidade_carro") {
      const vencimento = new Date();
      vencimento.setDate(vencimento.getDate() + 30);
      if (pagamento.veiculo_id) {
        await supabase
          .from("assinaturas")
          .upsert(
            {
              user_id: pagamento.user_id,
              veiculo_id: pagamento.veiculo_id,
              status: "ativo",
              data_vencimento: vencimento.toISOString(),
            },
            { onConflict: "user_id,veiculo_id" },
          );
      } else {
        await supabase.from("assinaturas").insert({
          user_id: pagamento.user_id,
          veiculo_id: null,
          status: "ativo",
          data_vencimento: vencimento.toISOString(),
        });
      }
    }

    if (pagamento.tipo_produto === "ativacao") {
      await supabase
        .from("profiles")
        .update({ status_usuario: "ativo" })
        .eq("id", pagamento.user_id);
    }

    console.log("[asaas-webhook] sucesso:", { pagamento_id: pagamento.id, user_id: pagamento.user_id });
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("[asaas-webhook] erro:", e);
    return new Response("err", { status: 500 });
  }
});

function pagamento_txid_safe(p: { metadata?: Record<string, unknown> | null }) {
  const m = p.metadata as { asaas_payment_id?: string } | null | undefined;
  return m?.asaas_payment_id ?? null;
}
