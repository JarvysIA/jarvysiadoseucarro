// Edge Function: mp-webhook
// Recebe notificações do Mercado Pago. Faz double-check via GET /v1/payments/{id}
// (nunca confia no payload do webhook) e atualiza o pagamento de forma idempotente.
// Se for mensalidade_carro, cria/renova assinatura. Dispara bonificação (fire-and-forget).

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
    const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!token) return new Response("missing token", { status: 500 });

    const url = new URL(req.url);
    let paymentId =
      url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? null;
    let topic =
      url.searchParams.get("type") ?? url.searchParams.get("topic") ?? null;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        paymentId = String(body?.data?.id ?? body?.id ?? paymentId ?? "");
        topic = body?.type ?? body?.action ?? topic;
      } catch {
        /* body pode estar vazio */
      }
    }

    if (!paymentId) {
      console.warn("[mp-webhook] sem payment id");
      return new Response("ok", { status: 200 });
    }

    if (topic && !String(topic).includes("payment")) {
      // Eventos não-payment ignorados (merchant_order etc).
      return new Response("ok", { status: 200 });
    }

    // DOUBLE-CHECK: consulta autoritativa
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!mpRes.ok) {
      const t = await mpRes.text();
      console.error("[mp-webhook] double-check falhou:", mpRes.status, t);
      return new Response("retry", { status: 502 });
    }
    const pay = await mpRes.json();
    const status = String(pay?.status ?? "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pagamento, error: selErr } = await supabase
      .from("pagamentos_pix")
      .select("id, user_id, veiculo_id, valor, codigo_cupom, status, tipo_produto, metadata")
      .eq("txid_efi", String(paymentId))
      .maybeSingle();

    if (selErr) {
      console.error("[mp-webhook] erro select:", selErr);
      return new Response("err", { status: 500 });
    }
    if (!pagamento) {
      console.warn(`[mp-webhook] pagamento ${paymentId} não encontrado`);
      return new Response("ok", { status: 200 });
    }

    // Idempotência atômica: só atualiza se ainda não está pago
    if (pagamento.status === "pago") {
      return new Response("ok", { status: 200 });
    }

    if (status !== "approved") {
      // Atualiza status intermediário sem disparar efeitos
      const novo =
        status === "rejected" || status === "cancelled" ? "cancelado" : "pendente";
      await supabase
        .from("pagamentos_pix")
        .update({
          status: novo,
          metadata: { ...(pagamento.metadata ?? {}), mp_status: status },
        })
        .eq("id", pagamento.id)
        .neq("status", "pago");
      return new Response("ok", { status: 200 });
    }

    // approved -> marca pago condicionalmente (.neq status pago = idempotência)
    const { data: upd, error: updErr } = await supabase
      .from("pagamentos_pix")
      .update({
        status: "pago",
        metadata: {
          ...(pagamento.metadata ?? {}),
          mp_status: status,
          mp_paid_at: pay?.date_approved ?? new Date().toISOString(),
        },
      })
      .eq("id", pagamento.id)
      .neq("status", "pago")
      .select("id")
      .maybeSingle();

    if (updErr) {
      console.error("[mp-webhook] erro update:", updErr);
      return new Response("err", { status: 500 });
    }
    if (!upd) {
      // outra invocação já marcou como pago
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
        // mensalidade pré-cadastro do veículo: cria assinatura "solta"
        // que será consumida pelo trigger proteger_cadastro_veiculo
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

    // Bonificação (fire-and-forget) — apenas se houver cupom
    if (pagamento.codigo_cupom) {
      try {
        await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-bonificacao`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ pagamento_id: pagamento.id }),
          },
        );
      } catch (e) {
        console.error("[mp-webhook] erro disparando bonificação:", e);
      }
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("[mp-webhook] erro:", e);
    return new Response("err", { status: 500 });
  }
});
