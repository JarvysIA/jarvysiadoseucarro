// Temporary function — Build 5.5C.
// Mirrors WHATSAPP_WORKER_SECRET from Edge env into vault.secrets via
// public.upsert_vault_secret. Never returns nor logs the secret value.
// Protected by SUPABASE_SERVICE_ROLE_KEY. Will be neutralized (410) after use.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = Deno.env.get("WHATSAPP_WORKER_SECRET");

  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_not_configured" }, 500);
  if (!workerSecret) return json({ error: "worker_secret_missing_in_env" }, 500);

  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!provided || !safeEqual(provided, serviceRoleKey)) {
    return json({ error: "unauthorized" }, 401);
  }

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
