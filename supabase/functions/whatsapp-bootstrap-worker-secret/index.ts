// Neutralizada no Build 5.5C após espelhar WHATSAPP_WORKER_SECRET no Vault.
// Função temporária, removida definitivamente após publicação do app.
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "gone", reason: "whatsapp-bootstrap-worker-secret neutralized in Build 5.5C" }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
