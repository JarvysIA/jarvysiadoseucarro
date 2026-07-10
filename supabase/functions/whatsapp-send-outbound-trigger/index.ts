// Trigger temporário (Build 5.6B) para disparar o sender outbound manualmente
// com o WHATSAPP_SENDER_SECRET vindo do env. Será neutralizado logo após o smoke.
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  const senderSecret = Deno.env.get("WHATSAPP_SENDER_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!senderSecret || !supabaseUrl) {
    return new Response(JSON.stringify({ error: "not_configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const url = new URL(req.url);
  const batchSize = url.searchParams.get("batch_size") ?? "1";
  const target = `${supabaseUrl}/functions/v1/whatsapp-send-outbound?batch_size=${encodeURIComponent(batchSize)}`;
  const res = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sender-secret": senderSecret,
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
    },
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});
