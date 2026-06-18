// Edge Function descontinuada. Gateway Efí encerrado — migrado para Asaas.
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "gateway descontinuado" }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
