// Temporária (Build 5.6C): espelha WHATSAPP_SENDER_SECRET no Vault.
// Neutralizada imediatamente após o uso.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  try {
    const senderSecret = Deno.env.get("WHATSAPP_SENDER_SECRET") ?? "";
    if (!senderSecret) {
      return new Response(JSON.stringify({ error: "misconfigured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error } = await supabase.rpc("upsert_vault_secret", {
      _name: "WHATSAPP_SENDER_SECRET",
      _value: senderSecret,
    });
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", detail: String(e).slice(0, 200) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
