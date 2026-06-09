import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FipeHistoricoItem = { mes_referencia: string; valor: string | number };

type FipeTabela = { codigo: number; mes: string };
type FipePrecoItem = {
  anoModelo?: number | string;
  valor?: string;
  mesReferencia?: string;
  codigoFipe?: string;
};

/** "R$ 45.123,50" → 45123.5 */
function parseValorBR(raw: string): number {
  const clean = String(raw).replace(/[R$\s.]/g, "").replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

const MES_PT_TO_NUM: Record<string, number> = {
  janeiro: 1, fevereiro: 2, "março": 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** "abril de 2025" → 202504 (number) para ordenação cronológica estrita. */
function parseRefMonth(s: string): number {
  if (!s) return 0;
  const parts = s.toLowerCase().trim().split(" de ");
  if (parts.length !== 2) return 0;
  const mes = MES_PT_TO_NUM[parts[0].trim()] || 0;
  const ano = parseInt(parts[1].trim(), 10) || 0;
  return ano * 100 + mes;
}

/**
 * Normaliza a string `mes` da tabela BrasilAPI (ex.: "abril/2025 ") para o
 * mesmo formato armazenado em `fipe_history.mes_referencia` ("abril de 2025").
 */
function normalizeTabelaMes(mes: string): string {
  const lower = (mes || "").toLowerCase().trim();
  const parts = lower.split("/");
  if (parts.length === 2) {
    return `${parts[0].trim()} de ${parts[1].trim()}`;
  }
  return lower;
}

/** Busca as N tabelas FIPE mais recentes (default = 6: mês atual + 5 anteriores). */
async function fetchRecentFipeTabelas(n = 6): Promise<FipeTabela[]> {
  const res = await fetch("https://brasilapi.com.br/api/fipe/tabelas/v1", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`BrasilAPI tabelas HTTP ${res.status}`);
  const all = (await res.json()) as FipeTabela[];
  return Array.isArray(all) ? all.slice(0, n) : [];
}

/**
 * Resgata o preço FIPE de um `codigo_fipe` em uma `tabela_referencia` específica.
 * Filtra por `Number(anoModelo)`; cai no índice [0] se não houver match exato.
 */
async function fetchFipePrecoForTabela(
  codigoFipe: string,
  tabelaCodigo: number,
  anoModelo: number,
): Promise<FipePrecoItem | null> {
  const url = `https://brasilapi.com.br/api/fipe/preco/v1/${encodeURIComponent(
    codigoFipe,
  )}?tabela_referencia=${tabelaCodigo}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const arr = (await res.json()) as FipePrecoItem[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const match = arr.find((p) => Number(p.anoModelo) === anoModelo) ?? arr[0];
    return match ?? null;
  } catch (e) {
    console.warn("[fetchFipePrecoForTabela] erro", { codigoFipe, tabelaCodigo, e });
    return null;
  }
}

/**
 * Refresh FIPE com janela deslizante de 6 meses:
 *   1) Busca as 6 tabelas FIPE mais recentes (mês atual + 5 anteriores)
 *   2) Faz 6 chamadas em paralelo via Promise.all
 *   3) Filtra por Number(anoModelo) (fallback no índice [0])
 *   4) Ordena cronologicamente e grava em fipe_history (upsert)
 *   5) Atualiza o valor "vigente" no veículo (último ponto)
 */
export const refreshFipeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { vehicleId: string; force?: boolean }) => {
    if (!data?.vehicleId) throw new Error("vehicleId obrigatório.");
    return { vehicleId: data.vehicleId, force: Boolean(data.force) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: v, error } = await supabaseAdmin
      .from("veiculos")
      .select("id,user_id,ano,codigo_fipe,fipe_updated_at,fipe_valor,fipe_mes_referencia")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!v || v.user_id !== context.userId) throw new Error("Acesso negado.");
    if (!v.codigo_fipe) return { refreshed: false as const, reason: "no_codigo_fipe" };

    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (!data.force && v.fipe_updated_at) {
      const age = Date.now() - new Date(v.fipe_updated_at).getTime();
      if (age < THIRTY_DAYS) {
        return {
          refreshed: false as const,
          reason: "fresh",
          valor: Number(v.fipe_valor),
          mes_referencia: v.fipe_mes_referencia,
        };
      }
    }

    const anoNum = Number((v.ano || "").toString().replace(/\D/g, ""));
    let tabelas: FipeTabela[] = [];
    try {
      tabelas = await fetchRecentFipeTabelas(6);
    } catch (e) {
      console.error("[refreshFipeFn] erro ao buscar tabelas", e);
      return { refreshed: false as const, reason: "tabelas_fetch_error" };
    }
    if (tabelas.length === 0) {
      return { refreshed: false as const, reason: "no_tabelas" };
    }

    const results = await Promise.all(
      tabelas.map((t) => fetchFipePrecoForTabela(v.codigo_fipe!, t.codigo, anoNum)),
    );

    type Point = { mes_referencia: string; valor: number };
    const points: Point[] = results
      .map((item, idx) => {
        if (!item) return null;
        const valor = parseValorBR(item.valor || "0");
        // Preferimos o mesReferencia da resposta; cai no `mes` da tabela como fallback.
        const mes = (item.mesReferencia && item.mesReferencia.trim()) ||
          normalizeTabelaMes(tabelas[idx]!.mes);
        if (!valor || !mes) return null;
        return { mes_referencia: mes, valor };
      })
      .filter((p): p is Point => p !== null);

    if (points.length === 0) {
      return { refreshed: false as const, reason: "no_valid_points" };
    }

    // Ordenação cronológica estrita (mais antigo → mais recente)
    points.sort((a, b) => parseRefMonth(a.mes_referencia) - parseRefMonth(b.mes_referencia));

    const rows = points.map((p) => ({
      vehicle_id: v.id,
      codigo_fipe: v.codigo_fipe as string,
      mes_referencia: p.mes_referencia,
      valor: p.valor,
    }));

    const { error: upErr } = await supabaseAdmin
      .from("fipe_history")
      .upsert(rows, { onConflict: "vehicle_id,mes_referencia" });
    if (upErr) {
      console.error("[refreshFipeFn] upsert history error", upErr);
    }

    const latest = points[points.length - 1];
    const nowIso = new Date().toISOString();
    await supabaseAdmin
      .from("veiculos")
      .update({
        fipe_valor: latest.valor,
        fipe_mes_referencia: latest.mes_referencia,
        fipe_updated_at: nowIso,
      })
      .eq("id", v.id);

    return {
      refreshed: true as const,
      valor: latest.valor,
      mes_referencia: latest.mes_referencia,
      inserted: rows.length,
    };
  });

/**
 * (Legado) Importa o histórico FIPE retornado pela API paga (PuxaPlaca).
 * Mantido para compatibilidade; novos fluxos usam `refreshFipeFn`.
 */
export const seedFipeHistoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    vehicleId: string;
    codigo_fipe: string;
    historico: FipeHistoricoItem[];
  }) => {
    if (!data?.vehicleId) throw new Error("vehicleId obrigatório.");
    if (!data?.codigo_fipe) throw new Error("codigo_fipe obrigatório.");
    return {
      vehicleId: data.vehicleId,
      codigo_fipe: data.codigo_fipe,
      historico: Array.isArray(data.historico) ? data.historico : [],
    };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: v, error } = await supabaseAdmin
      .from("veiculos")
      .select("id,user_id")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!v || v.user_id !== context.userId) throw new Error("Acesso negado.");

    const rows = data.historico
      .map((h) => ({
        vehicle_id: data.vehicleId,
        codigo_fipe: data.codigo_fipe,
        mes_referencia: (h.mes_referencia || "").trim(),
        valor: typeof h.valor === "number" ? h.valor : parseValorBR(String(h.valor || "0")),
      }))
      .filter((r) => r.mes_referencia && r.valor > 0);

    if (rows.length === 0) return { ok: true, inserted: 0 };

    const { error: upErr } = await supabaseAdmin
      .from("fipe_history")
      .upsert(rows, { onConflict: "vehicle_id,mes_referencia" });
    if (upErr) throw new Error(upErr.message);
    return { ok: true, inserted: rows.length };
  });
