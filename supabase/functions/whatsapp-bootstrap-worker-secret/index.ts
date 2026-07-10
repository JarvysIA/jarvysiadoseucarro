// Temporary function — Build 5.5C.
// One-shot: mirrors WHATSAPP_WORKER_SECRET from Edge env into vault.secrets
// via public.upsert_vault_secret. Never returns nor logs the secret value.
// Safe to invoke publicly: it only re-writes a known-only-to-server value
// into Vault; it does not read from Vault, does not expose any secret, and
// has no other side effects. Will be neutralized (410) right after use.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = Deno.env.get("WHATSAPP_WORKER_SECRET");

  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_not_configured" }, 500);
  if (!workerSecret) return json({ error: "worker_secret_missing_in_env" }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await supabase.rpc("upsert_vault_secret", {
    _name: "WHATSAPP_WORKER_SECRET",
    _value: workerSecret,
  });

  if (error) {
    console.error(JSON.stringify({ tag: "wa-bootstrap-worker-secret", status: "rpc_error", error: error.message.slice(0, 200) }));
    return json({ error: "vault_upsert_failed" }, 500);
  }

  console.log(JSON.stringify({ tag: "wa-bootstrap-worker-secret", status: "ok" }));
  return json({ ok: true });
});
