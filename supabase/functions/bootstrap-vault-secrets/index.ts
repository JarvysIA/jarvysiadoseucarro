// Bootstrap desativado após uso único. Sempre retorna 410 Gone.
Deno.serve(() => new Response("gone", { status: 410 }));
