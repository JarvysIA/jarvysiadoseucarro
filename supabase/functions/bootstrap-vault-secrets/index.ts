// Bootstrap one-shot: grava FIPE_CRON_SECRET e PAYMENT_CRON_SECRET no Vault.
// Retorna apenas status por nome; nunca revela valores.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.includes(svc)) return new Response("unauthorized", { status: 401 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, svc);
  const names = ["FIPE_CRON_SECRET", "PAYMENT_CRON_SECRET"] as const;
  const result: Record<string, string> = {};

  for (const name of names) {
    const value = Deno.env.get(name);
    if (!value) { result[name] = "missing_env"; continue; }
    const { error } = await supabase.rpc("upsert_vault_secret", {
      _name: name,
      _value: value,
    });
    result[name] = error ? `err:${error.message}` : "ok";
  }
  return Response.json({ ok: true, result });
});
