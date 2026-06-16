// Edge Function: asaas-webhook
// Cérebro isolado de pós-pagamento. Valida token, decodifica externalReference
// no formato [TIPO]_[USER_ID]_[VEICULO_ID] e aplica regras de negócio estritas.
//
// Env vars: ASAAS_WEBHOOK_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type Tipo = "ativacao" | "historico" | "mensalidade";

function parseExternalRef(ref: string): { tipo: Tipo | null; userId: string | null; veiculoId: string | null } {
  const parts = ref.split("_");
  if (parts.length < 3) return { tipo: null, userId: null, veiculoId: null };
  const tipoRaw = parts[0];
  // UUID v4 tem 5 segmentos (4 hifens) -> precisamos remontar
  // Mas usamos formato: TIPO_UUID_UUID|none
  // Como UUIDs contêm hifens (não underscores), split('_') = [tipo, userId, veiculoId]
  const tipo = (["ativacao", "historico", "mensalidade"].includes(tipoRaw) ? tipoRaw : null) as Tipo | null;
  const userId = parts[1] || null;
  const veiculoId = parts[2] === "none" ? null : (parts[2] || null);
  return { tipo, userId, veiculoId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET" || req.method === "HEAD")
    return new Response("ok", { status: 200, headers: corsHeaders });

  // 1) Token de segurança — PRIMEIRA LINHA
  const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  const receivedToken =
    req.headers.get("asaas-access-token") ?? req.headers.get("Asaas-Access-Token");
  if (!expectedToken || receivedToken !== expectedToken) {
    console.warn("[asaas-webhook] token inválido — 401");
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const payload = await req.json().catch(() => null);
    if (!payload) {
      console.warn("[asaas-webhook] payload vazio");
      return new Response("ok", { status: 200 });
    }

    const event = String(payload?.event ?? "");
    const pay = payload?.payment ?? {};
    const externalReference = String(pay?.externalReference ?? "");
    const asaasPaymentId = String(pay?.id ?? "");
    const status = String(pay?.status ?? "");

    console.info("[asaas-webhook] evento recebido:", {
      event,
      externalReference,
      asaasPaymentId,
      status,
    });

    const eventosPagos = new Set([
      "PAYMENT_RECEIVED",
      "PAYMENT_CONFIRMED",
      "PAYMENT_RECEIVED_IN_CASH",
    ]);
    if (!eventosPagos.has(event)) {
      console.info("[asaas-webhook] evento ignorado:", event);
      return new Response("ok", { status: 200 });
    }

    const { tipo, userId, veiculoId } = parseExternalRef(externalReference);
    if (!tipo || !userId) {
      console.error("[asaas-webhook] externalReference inválido:", externalReference);
      return new Response("ok", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 2) Localiza pagamento_pix pelo asaas_payment_id (txid_efi)
    const { data: pagamento, error: selErr } = await supabase
      .from("pagamentos_pix")
      .select("id, user_id, veiculo_id, status, tipo_produto, metadata")
      .eq("txid_efi", asaasPaymentId)
      .maybeSingle();

    if (selErr) {
      console.error("[asaas-webhook] erro select:", selErr);
      return new Response("err", { status: 500 });
    }
    if (!pagamento) {
      console.warn("[asaas-webhook] pagamento local não encontrado:", asaasPaymentId);
      return new Response("ok", { status: 200 });
    }
    if (pagamento.status === "pago") {
      console.info("[asaas-webhook] idempotente — já pago:", pagamento.id);
      return new Response("ok", { status: 200 });
    }

    // 3) Marca como pago (atomicidade via .neq)
    const { data: upd, error: updErr } = await supabase
      .from("pagamentos_pix")
      .update({
        status: "pago",
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
      console.error("[asaas-webhook] erro update pagamento:", updErr);
      return new Response("err", { status: 500 });
    }
    if (!upd) {
      console.info("[asaas-webhook] race — já marcado por outra invocação");
      return new Response("ok", { status: 200 });
    }

    // 4) Regras de negócio estritas baseadas no TIPO
    if (tipo === "ativacao") {
      const { error: e } = await supabase
        .from("profiles")
        .update({ status_usuario: "ativo" })
        .eq("id", userId);
      if (e) console.error("[asaas-webhook] erro ativar profile:", e);
      else console.info("[asaas-webhook] ativacao ✓ user:", userId);
    } else if (tipo === "historico") {
      // APENAS destranca o histórico do veículo — NÃO altera o status do profile
      if (veiculoId) {
        const { error: e } = await supabase
          .from("veiculos")
          .update({ status_pagamento: "ativo" })
          .eq("id", veiculoId)
          .eq("user_id", userId);
        if (e) console.error("[asaas-webhook] erro liberar historico:", e);
        else console.info("[asaas-webhook] historico ✓ veiculo:", veiculoId);
      } else {
        console.warn("[asaas-webhook] historico sem veiculoId");
      }
    } else if (tipo === "mensalidade") {
      const vencimento = new Date();
      vencimento.setDate(vencimento.getDate() + 30);
      const { error: e } = await supabase.from("assinaturas").upsert(
        {
          user_id: userId,
          veiculo_id: veiculoId,
          status: "ativo",
          data_vencimento: vencimento.toISOString(),
        },
        { onConflict: "user_id,veiculo_id" },
      );
      if (e) console.error("[asaas-webhook] erro upsert assinatura:", e);
      else console.info("[asaas-webhook] mensalidade ✓ user/veiculo:", userId, veiculoId);

      if (veiculoId) {
        await supabase
          .from("veiculos")
          .update({ status_pagamento: "ativo" })
          .eq("id", veiculoId)
          .eq("user_id", userId);
      }
    }

    console.info("[asaas-webhook] processado com sucesso:", {
      pagamento_id: pagamento.id,
      tipo,
      userId,
      veiculoId,
    });
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("[asaas-webhook] erro inesperado:", e);
    return new Response("err", { status: 500 });
  }
});
