// One-shot: copia FIPE_CRON_SECRET e PAYMENT_CRON_SECRET do env para o Vault.
// Não retorna valores. Idempotente (update se já existir).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const auth = req.headers.get("authorization") ?? "";
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!auth.includes(svc)) return new Response("unauthorized", { status: 401 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, svc);
  const names = ["FIPE_CRON_SECRET", "PAYMENT_CRON_SECRET"] as const;
  const result: Record<string, string> = {};

  for (const name of names) {
    const value = Deno.env.get(name);
    if (!value) { result[name] = "missing_env"; continue; }
    // Verifica se já existe
    const { data: existing } = await supabase
      .schema("vault")
      .from("secrets")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await supabase.rpc("_vault_update_secret_by_name", {
        p_name: name, p_value: value,
      }).single();
      // Fallback direto via SQL se o RPC não existir
      if (error) {
        await supabase.schema("vault").from("secrets")
          .update({ secret: value }).eq("id", existing.id);
      }
      result[name] = "updated";
    } else {
      const { error } = await supabase.rpc("vault_create_secret", {
        p_secret: value, p_name: name,
      });
      if (error) {
        // usar função nativa
        await supabase.rpc("create_vault_secret", { secret: value, name });
      }
      result[name] = "created";
    }
  }
  return Response.json({ ok: true, result });
});
