import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FipeHistoricoItem = { mes_referencia: string; valor: string | number };

/**
 * Lazy refresh do valor FIPE via BrasilAPI (gratuita).
 * Só executa se o veículo possui `codigo_fipe` salvo e `fipe_updated_at` é
 * mais antigo que 30 dias (ou nunca foi atualizado). Filtra a resposta pelo
 * `anoModelo` salvo no veículo, atualiza a UI e grava em `fipe_history`.
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

    const codigo = encodeURIComponent(v.codigo_fipe);
    const url = `https://brasilapi.com.br/api/fipe/preco/v1/${codigo}`;
    let payload: Array<{ anoModelo?: number | string; valor?: string; mesReferencia?: string; codigoFipe?: string }> = [];
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`BrasilAPI HTTP ${res.status}`);
      payload = await res.json();
    } catch (e) {
      console.error("[refreshFipeFn] fetch error", e);
      return { refreshed: false as const, reason: "fetch_error" };
    }

    const anoNum = Number((v.ano || "").toString().replace(/\D/g, ""));
    const match =
      payload.find((p) => Number(p.anoModelo) === anoNum) || payload[0];
    if (!match) return { refreshed: false as const, reason: "no_match" };

    const valor = parseValorBR(match.valor || "0");
    const mes = (match.mesReferencia || "").trim();
    if (!valor || !mes) return { refreshed: false as const, reason: "invalid_payload" };

    const nowIso = new Date().toISOString();
    await supabaseAdmin
      .from("veiculos")
      .update({
        fipe_valor: valor,
        fipe_mes_referencia: mes,
        fipe_updated_at: nowIso,
      })
      .eq("id", v.id);

    // upsert em fipe_history (chave única vehicle_id+mes_referencia)
    await supabaseAdmin
      .from("fipe_history")
      .upsert(
        {
          vehicle_id: v.id,
          codigo_fipe: v.codigo_fipe,
          mes_referencia: mes,
          valor,
        },
        { onConflict: "vehicle_id,mes_referencia" },
      );

    return {
      refreshed: true as const,
      valor,
      mes_referencia: mes,
    };
  });

/** "R$ 45.123,50" → 45123.5 */
function parseValorBR(raw: string): number {
  const clean = String(raw)
    .replace(/[R$\s.]/g, "")
    .replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Importa o histórico FIPE retornado pela API paga (PuxaPlaca) para o gráfico.
 * Idempotente via upsert por (vehicle_id, mes_referencia).
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
    console.log("[seedFipeHistoryFn] start", {
      vehicleId: data.vehicleId,
      codigo_fipe: data.codigo_fipe,
      historicoLen: data.historico?.length ?? 0,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: v, error } = await supabaseAdmin
      .from("veiculos")
      .select("id,user_id")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (error) {
      console.error("[seedFipeHistoryFn] veiculo lookup error", error);
      throw new Error(error.message);
    }
    if (!v || v.user_id !== context.userId) {
      console.error("[seedFipeHistoryFn] acesso negado", { found: !!v });
      throw new Error("Acesso negado.");
    }

    const rows = data.historico
      .map((h) => ({
        vehicle_id: data.vehicleId,
        codigo_fipe: data.codigo_fipe,
        mes_referencia: (h.mes_referencia || "").trim(),
        valor: typeof h.valor === "number" ? h.valor : parseValorBR(String(h.valor || "0")),
      }))
      .filter((r) => r.mes_referencia && r.valor > 0);

    console.log("[seedFipeHistoryFn] rows preparadas", { count: rows.length, sample: rows[0] });
    if (rows.length === 0) {
      console.warn("[seedFipeHistoryFn] nenhuma linha válida no histórico recebido");
      return { ok: true, inserted: 0 };
    }

    const { error: upErr } = await supabaseAdmin
      .from("fipe_history")
      .upsert(rows, { onConflict: "vehicle_id,mes_referencia" });
    if (upErr) {
      console.error("[seedFipeHistoryFn] upsert error", upErr);
      throw new Error(upErr.message);
    }
    console.log("[seedFipeHistoryFn] sucesso", { inserted: rows.length });
    return { ok: true, inserted: rows.length };
  });
