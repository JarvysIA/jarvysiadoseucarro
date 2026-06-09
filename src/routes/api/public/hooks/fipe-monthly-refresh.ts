import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type FipeTabela = { codigo: number; mes: string };
type FipePrecoItem = {
  anoModelo?: number | string;
  valor?: string;
  mesReferencia?: string;
};

function parseValorBR(raw: string): number {
  const clean = String(raw).replace(/[R$\s.]/g, "").replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTabelaMes(mes: string): string {
  const lower = (mes || "").toLowerCase().trim();
  const parts = lower.split("/");
  if (parts.length === 2) return `${parts[0].trim()} de ${parts[1].trim()}`;
  return lower;
}

const MES_PT_TO_NUM: Record<string, number> = {
  janeiro: 1, fevereiro: 2, "março": 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function parseRefMonth(s: string): number {
  if (!s) return 0;
  const parts = s.toLowerCase().trim().split(" de ");
  if (parts.length !== 2) return 0;
  const mes = MES_PT_TO_NUM[parts[0].trim()] || 0;
  const ano = parseInt(parts[1].trim(), 10) || 0;
  return ano * 100 + mes;
}

/**
 * Cron mensal (dia 07): busca o valor FIPE do mês vigente para TODOS os veículos
 * ativos, anexa o novo ponto a `fipe_history` e aplica janela deslizante (FIFO)
 * de 6 meses, removendo o ponto mais antigo quando ultrapassa o limite.
 *
 * Chamado por pg_cron via /api/public/* (sem auth de usuário).
 */
export const Route = createFileRoute("/api/public/hooks/fipe-monthly-refresh")({
  server: {
    handlers: {
      POST: async () => {
        // 1) Tabela FIPE do mês vigente
        let tabelaAtual: FipeTabela | null = null;
        try {
          const res = await fetch("https://brasilapi.com.br/api/fipe/tabelas/v1", {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) throw new Error(`tabelas HTTP ${res.status}`);
          const arr = (await res.json()) as FipeTabela[];
          tabelaAtual = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
        } catch (e) {
          console.error("[fipe-monthly-refresh] tabelas fetch error", e);
          return Response.json({ ok: false, reason: "tabelas_fetch_error" }, { status: 502 });
        }
        if (!tabelaAtual) {
          return Response.json({ ok: false, reason: "no_tabela_atual" }, { status: 502 });
        }

        // 2) Todos os veículos ativos com codigo_fipe
        const { data: veiculos, error: vErr } = await supabaseAdmin
          .from("veiculos")
          .select("id,ano,codigo_fipe,status")
          .not("codigo_fipe", "is", null);
        if (vErr) {
          console.error("[fipe-monthly-refresh] veiculos query error", vErr);
          return Response.json({ ok: false, reason: vErr.message }, { status: 500 });
        }

        const ativos = (veiculos ?? []).filter(
          (v) => !v.status || v.status === "active" || v.status === "ativo",
        );

        let updated = 0;
        let failed = 0;

        // 3) Processa cada veículo em série (evita bursts contra a BrasilAPI gratuita)
        for (const v of ativos) {
          try {
            const anoNum = Number((v.ano || "").toString().replace(/\D/g, ""));
            const url = `https://brasilapi.com.br/api/fipe/preco/v1/${encodeURIComponent(
              v.codigo_fipe as string,
            )}?tabela_referencia=${tabelaAtual.codigo}`;
            const res = await fetch(url, { headers: { Accept: "application/json" } });
            if (!res.ok) {
              failed++;
              continue;
            }
            const arr = (await res.json()) as FipePrecoItem[];
            if (!Array.isArray(arr) || arr.length === 0) {
              failed++;
              continue;
            }
            const match = arr.find((p) => Number(p.anoModelo) === anoNum) ?? arr[0];
            const valor = parseValorBR(match?.valor || "0");
            const mes = (match?.mesReferencia && match.mesReferencia.trim()) ||
              normalizeTabelaMes(tabelaAtual.mes);
            if (!valor || !mes) {
              failed++;
              continue;
            }

            // 3a) Anexa o novo ponto
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

            // 3b) Atualiza o "vigente" no veículo
            await supabaseAdmin
              .from("veiculos")
              .update({
                fipe_valor: valor,
                fipe_mes_referencia: mes,
                fipe_updated_at: new Date().toISOString(),
              })
              .eq("id", v.id);

            // 3c) Sliding window FIFO: mantém apenas os 6 mais recentes
            const { data: hist } = await supabaseAdmin
              .from("fipe_history")
              .select("id,mes_referencia")
              .eq("vehicle_id", v.id);
            if (hist && hist.length > 6) {
              const sorted = [...hist].sort(
                (a, b) =>
                  parseRefMonth(a.mes_referencia as string) -
                  parseRefMonth(b.mes_referencia as string),
              );
              const toDelete = sorted.slice(0, sorted.length - 6).map((r) => r.id as string);
              if (toDelete.length > 0) {
                await supabaseAdmin.from("fipe_history").delete().in("id", toDelete);
              }
            }
            updated++;
          } catch (e) {
            failed++;
            console.error("[fipe-monthly-refresh] erro veiculo", v.id, e);
          }
        }

        return Response.json({
          ok: true,
          tabela: tabelaAtual,
          total: ativos.length,
          updated,
          failed,
        });
      },
    },
  },
});
