import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isActiveVehicleStatus, isArchivedVehicleStatus } from "@/lib/vehicle-status";
import { trialActive } from "@/lib/plan-capabilities";
import type { ProfileStatus } from "@/lib/profile-status";


export type FipeHistoricoItem = { mes_referencia: string; valor: string | number };

type HistoricoPoint = {
  mes_ano_extenso: string;
  mes: string | number | null;
  ano: number | null;
  valor: number;
  codigo_fipe?: string | null;
};

const MES_PT_TO_NUM: Record<string, number> = {
  janeiro: 1, fevereiro: 2, "março": 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** Converte mes (string nome ou número) + ano em um inteiro YYYYMM para ordenação. */
function pointSortKey(p: HistoricoPoint): number {
  let ano = typeof p.ano === "number" ? p.ano : 0;
  let mes = 0;

  if (typeof p.mes === "number") {
    mes = p.mes;
  } else if (typeof p.mes === "string" && p.mes.trim()) {
    const s = p.mes.toLowerCase().trim();
    const asNum = parseInt(s, 10);
    if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 12) {
      mes = asNum;
    } else {
      mes = MES_PT_TO_NUM[s] || 0;
    }
  }

  // Fallback: extrai do texto "abril de 2025" / "abril/2025"
  if ((!ano || !mes) && p.mes_ano_extenso) {
    const lower = p.mes_ano_extenso.toLowerCase().trim();
    const parts = lower.includes(" de ") ? lower.split(" de ") : lower.split("/");
    if (parts.length === 2) {
      const m = MES_PT_TO_NUM[parts[0].trim()] || parseInt(parts[0], 10) || 0;
      const a = parseInt(parts[1].trim(), 10) || 0;
      if (!mes) mes = m;
      if (!ano) ano = a;
    }
  }

  return ano * 100 + mes;
}

/**
 * Atualiza dados FIPE de um veículo usando exclusivamente Placa FIPE.
 *
 * Fluxo:
 *   1. Busca o veículo pelo id e valida ownership.
 *   2. Respeita throttle de 30 dias salvo force=true.
 *   3. Resolve placafipe_hash (usa o salvo ou recupera via lookupPlacaFipe + codigo_fipe).
 *   4. Chama consultar-historico-fipe(hash).
 *   5. Atualiza veiculos.historico_fipe, fipe_valor, fipe_mes_referencia, fipe_updated_at.
 *   6. Em falha de API, nunca apaga dados existentes — retorna reason controlada.
 */
export const refreshFipeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { vehicleId: string; force?: boolean }) => {
    if (!data?.vehicleId) throw new Error("vehicleId obrigatório.");
    return { vehicleId: data.vehicleId, force: Boolean(data.force) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: v, error } = await supabase
      .from("veiculos")
      .select(
        "id,user_id,status,placa,codigo_fipe,placafipe_hash,fipe_updated_at,fipe_valor,fipe_mes_referencia",
      )
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!v || v.user_id !== userId) throw new Error("Acesso negado.");

    // Gate server-side (Build 8.7E2): plano/status antes de qualquer chamada externa.
    if (isArchivedVehicleStatus(v.status)) {
      return { refreshed: false as const, reason: "paywall" as const };
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("status_usuario, trial_inicio")
      .eq("id", userId)
      .maybeSingle();
    const status = (prof?.status_usuario as ProfileStatus) ?? "trial";
    const trialInicio = (prof?.trial_inicio as string | null) ?? null;

    let allowed = false;
    if (status === "vip" || status === "enterprise") {
      allowed = true;
    } else if (status === "trial") {
      allowed = trialActive({
        status_usuario: "trial",
        trial_inicio: trialInicio,
        vehicleCount: 0,
        activatedVehicleCount: 0,
      });
    } else if (status === "ativo") {
      if (isActiveVehicleStatus(v.status)) {
        const { data: pay } = await supabase
          .from("pagamentos_pix")
          .select("id")
          .eq("user_id", userId)
          .eq("veiculo_id", v.id)
          .eq("status", "pago")
          .eq("tipo_produto", "ativacao")
          .limit(1)
          .maybeSingle();
        allowed = Boolean(pay);
      }
    }

    if (!allowed) {
      return { refreshed: false as const, reason: "paywall" as const };
    }

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



    // 1) Resolver hash
    let hash = (v.placafipe_hash || "").trim();

    if (!hash && v.placa && v.codigo_fipe) {
      try {
        const { data: lookupResp, error: lookupErr } = await supabase.functions.invoke(
          "consultar-placa",
          { body: { placa: v.placa } },
        );
        if (!lookupErr && lookupResp?.ok && Array.isArray(lookupResp.fipe)) {
          const match = lookupResp.fipe.find((opt: { codigo_fipe?: string; codigoFipe?: string }) => {
            const c = (opt?.codigo_fipe ?? opt?.codigoFipe ?? "").toString().trim();
            return c && c === v.codigo_fipe;
          }) as { desvalorizometro?: string; hash?: string } | undefined;
          const recovered = (match?.desvalorizometro || match?.hash || "").toString().trim();
          if (recovered) {
            hash = recovered;
            await supabase
              .from("veiculos")
              .update({ placafipe_hash: hash })
              .eq("id", v.id);
          }
        }
      } catch (e) {
        console.warn("[refreshFipeFn] lookupPlacaFipe fallback erro", e instanceof Error ? e.message : String(e));
      }
    }

    if (!hash) {
      return { refreshed: false as const, reason: "no_hash" };
    }

    // 2) Histórico via Placa FIPE
    let historico: HistoricoPoint[] = [];
    try {
      const { data: histResp, error: histErr } = await supabase.functions.invoke(
        "consultar-historico-fipe",
        { body: { hash } },
      );
      if (histErr) {
        console.error("[refreshFipeFn] consultar-historico-fipe error", histErr instanceof Error ? histErr.message : String(histErr));
        return { refreshed: false as const, reason: "api_error" };
      }
      const arr: unknown[] = Array.isArray(histResp?.historico) ? histResp.historico : [];
      historico = arr
        .map((raw) => {
          const h = raw as Record<string, unknown>;
          const valorRaw = h?.valor;
          let valor = 0;
          if (typeof valorRaw === "number") {
            valor = valorRaw;
          } else if (typeof valorRaw === "string") {
            const clean = valorRaw.replace(/R\$/gi, "").replace(/\s/g, "")
              .replace(/\./g, "").replace(",", ".");
            const n = parseFloat(clean);
            valor = Number.isFinite(n) ? n : 0;
          }
          return {
            mes_ano_extenso: String(h?.mes_ano_extenso || ""),
            mes: (h?.mes as string | number | null) ?? null,
            ano: typeof h?.ano === "number" ? (h.ano as number) : null,
            valor,
            codigo_fipe: (h?.codigo_fipe as string | null) ?? null,
          } as HistoricoPoint;
        })
        .filter((p) => (p.mes_ano_extenso || p.ano) && p.valor > 0);
    } catch (e) {
      console.error("[refreshFipeFn] exception fetching historico", e instanceof Error ? e.message : String(e));
      return { refreshed: false as const, reason: "api_error" };
    }

    if (historico.length === 0) {
      return { refreshed: false as const, reason: "no_history" };
    }

    // 3) Ponto mais recente (prefere ano/mes numéricos)
    const sorted = [...historico].sort((a, b) => pointSortKey(a) - pointSortKey(b));
    const latest = sorted[sorted.length - 1];

    // 4) Atualiza veículo
    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabase
      .from("veiculos")
      .update({
        historico_fipe: historico as never,
        fipe_valor: latest.valor,
        fipe_mes_referencia: latest.mes_ano_extenso || v.fipe_mes_referencia,
        fipe_updated_at: nowIso,
      } as never)
      .eq("id", v.id);
    if (upErr) {
      console.error("[refreshFipeFn] update error", upErr instanceof Error ? upErr.message : String(upErr));
      return { refreshed: false as const, reason: "update_error" };
    }

    return {
      refreshed: true as const,
      valor: latest.valor,
      mes_referencia: latest.mes_ano_extenso,
      points: historico.length,
    };
  });
