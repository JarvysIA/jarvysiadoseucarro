// Neutralizada no Build 5.6C após espelhar WHATSAPP_SENDER_SECRET no Vault.
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "gone", reason: "whatsapp-bootstrap-sender-secret neutralized in Build 5.6C" }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
