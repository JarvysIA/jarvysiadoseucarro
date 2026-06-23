import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron mensal FIPE (Build 5) — fonte única: Placa FIPE.
 *
 * Agendamento atual em pg_cron: `0 9 7 * *` (dia 07, 09:00). NÃO alterado.
 *
 * Endpoint público em /api/public/* por legado/agendamento (pg_cron chama sem
 * header). Proteção dedicada (assinatura/secret) pode ser endereçada em build
 * futuro — fora do escopo do Build 5.
 *
 * Regras de elegibilidade:
 *   - profiles.status_usuario ∈ {ativo, vip, enterprise}
 *   - veiculos.status = 'ativo'
 *   - trial / trial expirado / archived são ignorados
 *
 * Para cada elegível:
 *   1. resolve placafipe_hash (salvo ou fallback consultar-placa com codigo_fipe)
 *   2. chama consultar-historico-fipe(hash)
 *   3. atualiza veiculos.historico_fipe, fipe_valor, fipe_mes_referencia, fipe_updated_at
 *   4. NÃO escreve em fipe_history (órfã na UI — ver auditoria do Build 5)
 *
 * Erros por veículo são isolados em try/catch e não interrompem o lote.
 */

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

function pointSortKey(p: HistoricoPoint): number {
  let ano = typeof p.ano === "number" ? p.ano : 0;
  let mes = 0;
  if (typeof p.mes === "number") {
    mes = p.mes;
  } else if (typeof p.mes === "string" && p.mes.trim()) {
    const s = p.mes.toLowerCase().trim();
    const asNum = parseInt(s, 10);
    if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 12) mes = asNum;
    else mes = MES_PT_TO_NUM[s] || 0;
  }
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

function normalizeHistorico(raw: unknown): HistoricoPoint[] {
  const arr: unknown[] = Array.isArray(raw) ? raw : [];
  return arr
    .map((item) => {
      const h = item as Record<string, unknown>;
      const valorRaw = h?.valor;
      let valor = 0;
      if (typeof valorRaw === "number") {
        valor = valorRaw;
      } else if (typeof valorRaw === "string") {
        const clean = valorRaw
          .replace(/R\$/gi, "")
          .replace(/\s/g, "")
          .replace(/\./g, "")
          .replace(",", ".");
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
}

export const Route = createFileRoute("/api/public/hooks/fipe-monthly-refresh")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const ranAt = new Date().toISOString();

        // Contagens "ignorados" — queries leves e independentes (não bloqueiam o refresh).
        let skipped_by_plan = 0;
        let skipped_by_status = 0;
        try {
          const { count } = await supabaseAdmin
            .from("veiculos")
            .select("id, profiles!inner(status_usuario)", { count: "exact", head: true })
            .eq("status", "ativo")
            .eq("profiles.status_usuario", "trial");
          skipped_by_plan = count ?? 0;
        } catch (e) {
          console.warn("[fipe-monthly-refresh] skipped_by_plan count falhou", e);
        }
        try {
          const { count } = await supabaseAdmin
            .from("veiculos")
            .select("id", { count: "exact", head: true })
            .neq("status", "ativo");
          skipped_by_status = count ?? 0;
        } catch (e) {
          console.warn("[fipe-monthly-refresh] skipped_by_status count falhou", e);
        }

        // Elegíveis: veiculo ativo + dono ativo/vip/enterprise.
        const { data: veiculos, error: vErr } = await supabaseAdmin
          .from("veiculos")
          .select("id, user_id, placa, codigo_fipe, placafipe_hash, profiles!inner(status_usuario)")
          .eq("status", "ativo")
          .in("profiles.status_usuario", ["ativo", "vip", "enterprise"]);

        if (vErr) {
          console.error("[fipe-monthly-refresh] query elegíveis erro", vErr);
          return Response.json(
            { ok: false, reason: vErr.message, ran_at: ranAt },
            { status: 500 },
          );
        }

        const elegiveis = veiculos ?? [];
        let updated = 0;
        let no_hash = 0;
        let no_history = 0;
        let errors = 0;

        for (const v of elegiveis) {
          try {
            let hash = (v.placafipe_hash || "").trim();

            // Fallback: tenta recuperar hash via consultar-placa quando há placa + codigo_fipe.
            if (!hash && v.placa && v.codigo_fipe) {
              try {
                const { data: lookupResp, error: lookupErr } =
                  await supabaseAdmin.functions.invoke("consultar-placa", {
                    body: { placa: v.placa },
                  });
                if (!lookupErr && lookupResp?.ok && Array.isArray(lookupResp.fipe)) {
                  const match = lookupResp.fipe.find(
                    (opt: { codigo_fipe?: string; codigoFipe?: string }) => {
                      const c = (opt?.codigo_fipe ?? opt?.codigoFipe ?? "")
                        .toString()
                        .trim();
                      return c && c === v.codigo_fipe;
                    },
                  ) as { desvalorizometro?: string; hash?: string } | undefined;
                  const recovered = (match?.desvalorizometro || match?.hash || "")
                    .toString()
                    .trim();
                  if (recovered) {
                    hash = recovered;
                    await supabaseAdmin
                      .from("veiculos")
                      .update({ placafipe_hash: hash })
                      .eq("id", v.id);
                  }
                }
              } catch (e) {
                console.warn("[fipe-monthly-refresh] consultar-placa fallback erro", v.id, e);
              }
            }

            if (!hash) {
              no_hash++;
              continue;
            }

            const { data: histResp, error: histErr } =
              await supabaseAdmin.functions.invoke("consultar-historico-fipe", {
                body: { hash },
              });
            if (histErr) {
              console.error("[fipe-monthly-refresh] historico erro", v.id, histErr);
              errors++;
              continue;
            }

            const historico = normalizeHistorico(histResp?.historico);
            if (historico.length === 0) {
              no_history++;
              continue;
            }

            const sorted = [...historico].sort((a, b) => pointSortKey(a) - pointSortKey(b));
            const latest = sorted[sorted.length - 1];

            const { error: upErr } = await supabaseAdmin
              .from("veiculos")
              .update({
                historico_fipe: historico as never,
                fipe_valor: latest.valor,
                fipe_mes_referencia: latest.mes_ano_extenso,
                fipe_updated_at: new Date().toISOString(),
              } as never)
              .eq("id", v.id);
            if (upErr) {
              console.error("[fipe-monthly-refresh] update erro", v.id, upErr);
              errors++;
              continue;
            }

            updated++;
          } catch (e) {
            errors++;
            console.error("[fipe-monthly-refresh] exceção veiculo", v.id, e);
          }
        }

        const summary = {
          ok: true,
          ran_at: ranAt,
          processed: elegiveis.length,
          updated,
          no_hash,
          no_history,
          errors,
          skipped_by_plan,
          skipped_by_status,
        };
        console.log("[fipe-monthly-refresh] resumo", summary);
        return Response.json(summary);
      },
    },
  },
});
