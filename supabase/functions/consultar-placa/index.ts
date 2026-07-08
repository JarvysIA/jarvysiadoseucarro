// Edge Function: consultar-placa
// Consulta dados veiculares + opções FIPE na API placafipe.com.br.
// Variáveis necessárias: PLACA_FIPE_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

async function requireAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!bearer) return json({ ok: false, error: "unauthorized" }, 401);

  // Bypass para chamadas internas (service_role usado por jobs/edge functions).
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRole && bearer === serviceRole) return null;

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ ok: false, error: "unauthorized" }, 401);
  const supabase = createClient(url, anon);
  const { data, error } = await supabase.auth.getUser(bearer);
  if (error || !data?.user) return json({ ok: false, error: "unauthorized" }, 401);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFail = await requireAuth(req);
  if (authFail) return authFail;

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
