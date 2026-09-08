// Edge Function: asaas-webhook
// Recebe eventos PAYMENT_RECEIVED / PAYMENT_CONFIRMED da Asaas
// e delega para o pipeline pós-pagamento idempotente único.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { confirmarPagamento } from "../_shared/pagamento-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, asaas-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    const expected = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
    const token = req.headers.get("asaas-access-token");
    if (!expected || token !== expected) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const event = (body as { event?: string }).event ?? "";
    const payment = (body as { payment?: { id?: string } }).payment ?? {};

    if (event !== "PAYMENT_RECEIVED" && event !== "PAYMENT_CONFIRMED") {
      // Aceita 200 para não causar retry desnecessário
      return json({ ok: true, ignored: event });
    }

    const asaas_payment_id = payment.id;
    if (!asaas_payment_id) return json({ ok: true, ignored: "sem payment.id" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Localiza por metadata.asaas_payment_id; fallback txid_efi
    let { data: row } = await supabase
      .from("pagamentos_pix")
      .select("id")
      .eq("metadata->>asaas_payment_id", asaas_payment_id)
      .maybeSingle();

    if (!row) {
      const r = await supabase
        .from("pagamentos_pix")
        .select("id")
        .eq("txid_efi", asaas_payment_id)
        .maybeSingle();
      row = r.data ?? null;
    }

    if (!row) {
      console.warn("[asaas-webhook] pagamento não encontrado:", asaas_payment_id);
      return json({ ok: true, ignored: "pagamento_nao_encontrado" });
    }

    const result = await confirmarPagamento({ supabase, pagamento_id: row.id });
    return json({ ok: true, result });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[asaas-webhook]", errMessage);
    return json({ error: errMessage }, 500);
  }
});
