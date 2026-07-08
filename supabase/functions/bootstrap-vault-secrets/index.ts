// One-shot ephemeral bootstrap. Deletado logo após uso.
// Copia FIPE_CRON_SECRET e PAYMENT_CRON_SECRET do env para o Vault via RPC.
// Não retorna valores; apenas status por nome.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const names = ["FIPE_CRON_SECRET", "PAYMENT_CRON_SECRET"] as const;
  const result: Record<string, string> = {};
  for (const name of names) {
    const value = Deno.env.get(name);
    if (!value) { result[name] = "missing_env"; continue; }
    const { error } = await supabase.rpc("upsert_vault_secret", { _name: name, _value: value });
    result[name] = error ? `err:${error.message}` : "ok";
  }
  return Response.json({ ok: true, result });
});
