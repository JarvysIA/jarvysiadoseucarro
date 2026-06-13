// Edge Function: consultar-historico-fipe
// Consulta o desvalorizômetro (histórico FIPE) na API placafipe.com.br via hash.
// Variáveis necessárias: PLACA_FIPE_TOKEN

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseValor(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  // Aceita "47100.00", "47.100,00", "R$ 47.100,00"
  let clean = s.replace(/R\$/gi, "").replace(/\s/g, "");
  if (clean.includes(",")) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método inválido" }, 405);

  try {
    const token = Deno.env.get("PLACA_FIPE_TOKEN");
    if (!token) return json({ ok: false, error: "PLACA_FIPE_TOKEN não configurado" }, 500);

    const body = await req.json().catch(() => ({}));
    const hash = String(body?.hash || body?.desvalorizometro || "").trim();
    if (!hash) return json({ ok: false, error: "hash ausente" }, 400);

    const res = await fetch("https://api.placafipe.com.br/getdesvalorizometro", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ desvalorizometro: hash, token }),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!res.ok) {
      return json({ ok: false, error: `HTTP ${res.status}`, raw: data ?? text }, 200);
    }

    const tabelas: any[] = Array.isArray(data?.desvalorizometro?.tabelas)
      ? data.desvalorizometro.tabelas
      : Array.isArray(data?.tabelas)
        ? data.tabelas
        : [];

    // Normaliza: valor sempre número (Recharts exige numérico)
    const historico = tabelas.map((t) => ({
      mes_ano_extenso: String(t?.mes_ano_extenso ?? t?.mesAnoExtenso ?? t?.mes_referencia ?? ""),
      mes: t?.mes ?? null,
      ano: t?.ano ? Number(t.ano) : (() => {
        const m = String(t?.mes_ano_extenso ?? "").match(/(\d{4})/);
        return m ? Number(m[1]) : null;
      })(),
      valor: parseValor(t?.valor),
      codigo_fipe: t?.codigo_fipe ?? null,
    })).filter((p) => p.mes_ano_extenso && p.valor > 0);

    return json({ ok: true, historico, raw: data });
  } catch (e) {
    console.error("[consultar-historico-fipe]", e);
    return json({ ok: false, error: (e as Error).message || "erro" }, 500);
  }
});
