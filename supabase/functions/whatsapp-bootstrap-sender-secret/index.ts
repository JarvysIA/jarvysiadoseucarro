// Temporária (Build 5.6C): espelha WHATSAPP_SENDER_SECRET no Vault.
// Guardada por WA_SENDER_BOOT_TOKEN. Neutralizar imediatamente após uso.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req) => {
  try {
    const bootToken = Deno.env.get("WA_SENDER_BOOT_TOKEN") ?? "";
    const senderSecret = Deno.env.get("WHATSAPP_SENDER_SECRET") ?? "";
    const provided = req.headers.get("x-boot-token") ?? "";

    if (!bootToken || !senderSecret) {
      return new Response(JSON.stringify({ error: "misconfigured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
    if (!safeEqual(provided, bootToken)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" },
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
