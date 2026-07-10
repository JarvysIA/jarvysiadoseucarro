// Neutralizada no Build 5.4D. Função temporária do Build 5.4C.
// Será removida definitivamente após publicação do app.
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "gone", reason: "whatsapp-selftest neutralized in Build 5.4D" }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
