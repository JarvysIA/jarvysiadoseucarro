// Neutralizada no Build 5.6B logo após o smoke outbound.
// Foi temporária apenas para disparar whatsapp-send-outbound com o secret do env.
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "gone", reason: "whatsapp-send-outbound-trigger neutralized in Build 5.6B" }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
