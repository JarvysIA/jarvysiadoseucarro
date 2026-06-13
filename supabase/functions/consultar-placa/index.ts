// Edge Function: consultar-placa
// Consulta dados veiculares + opções FIPE na API placafipe.com.br.
// Variáveis necessárias: PLACA_FIPE_TOKEN

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const token = Deno.env.get("PLACA_FIPE_TOKEN");
    if (!token) return json({ ok: false, error: "PLACA_FIPE_TOKEN não configurado" }, 500);

    let placa = "";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      placa = String(body?.placa || "");
    } else {
      const url = new URL(req.url);
      placa = String(url.searchParams.get("placa") || "");
    }
    placa = placa.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (placa.length < 7) return json({ ok: false, error: "Placa inválida" }, 400);

    const url = `https://api.placafipe.com.br/getplacafipe/${placa}/${token}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!res.ok) {
      return json({ ok: false, error: `HTTP ${res.status}`, raw: data ?? text }, 200);
    }

    const fipe = Array.isArray(data?.fipe) ? data.fipe : [];
    const informacoes_veiculo = data?.informacoes_veiculo ?? data?.informacoesVeiculo ?? null;

    return json({ ok: true, fipe, informacoes_veiculo, raw: data });
  } catch (e) {
    console.error("[consultar-placa]", e);
    return json({ ok: false, error: (e as Error).message || "erro" }, 500);
  }
});
