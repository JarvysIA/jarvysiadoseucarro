// Edge Function: verificar-pagamentos-asaas
// Polling de fallback. Roda periodicamente.
// 1) Expira pendentes > 1h.
// 2) Para pendentes < 1h com metadata.gateway='asaas', consulta GET /v3/payments/{id}.
// 3) Em RECEIVED/CONFIRMED, chama o MESMO pipeline pós-pagamento.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { confirmarPagamento } from "../_shared/pagamento-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ASAAS_API_KEY");
    if (!apiKey) return json({ error: "ASAAS_API_KEY ausente" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // 1) Expira pendentes antigos
    const { data: expirados } = await supabase
      .from("pagamentos_pix")
      .update({ status: "expirado" })
      .eq("status", "pendente")
      .lt("created_at", umaHoraAtras)
      .select("id");

    // 2) Lista pendentes Asaas < 1h
    const { data: pendentes, error: errPend } = await supabase
      .from("pagamentos_pix")
      .select("id, txid_efi, metadata")
      .eq("status", "pendente")
      .eq("metadata->>gateway", "asaas")
      .gte("created_at", umaHoraAtras)
      .not("txid_efi", "is", null);

    if (errPend) throw errPend;

    const resumo = {
      verificados: 0,
      pagos: 0,
      expirados: expirados?.length ?? 0,
      detalhes: [] as Array<Record<string, unknown>>,
    };

    if (!pendentes || pendentes.length === 0) return json({ ok: true, ...resumo });

    for (const pag of pendentes) {
      resumo.verificados++;
      const det: Record<string, unknown> = { id: pag.id, asaas_payment_id: pag.txid_efi };
      try {
        const res = await fetch(
          `${asaasBaseUrl()}/payments/${encodeURIComponent(pag.txid_efi as string)}`,
          { headers: { access_token: apiKey, "User-Agent": "Jarvys/1.0" } },
        );
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) {
          det.erro = `HTTP ${res.status}: ${JSON.stringify(raw)}`;
          resumo.detalhes.push(det);
          continue;
        }
        const status = (raw as { status?: string }).status ?? "";
        det.asaasStatus = status;
        if (status === "RECEIVED" || status === "CONFIRMED" || status === "RECEIVED_IN_CASH") {
          const result = await confirmarPagamento({ supabase, pagamento_id: pag.id });
          if (!result.already) resumo.pagos++;
          det.result = result;
        }
      } catch (e) {
        det.erro = e instanceof Error ? e.message : String(e);
      }
      resumo.detalhes.push(det);
    }

    return json({ ok: true, ...resumo });
  } catch (err) {
    console.error("[verificar-pagamentos-asaas]", err);
    return json(
      { error: err instanceof Error ? err.message : "Erro desconhecido" },
      500,
    );
  }
});
