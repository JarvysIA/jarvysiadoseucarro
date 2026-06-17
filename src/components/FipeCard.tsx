import { useEffect, useMemo, useState } from "react";
import { TrendingUp, X, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";

type HistPoint = {
  mes_ano_extenso: string;
  mes?: string | number | null;
  ano?: number | null;
  valor: number;
};

type VehicleFipe = {
  fipe_valor: number | null;
  fipe_mes_referencia: string | null;
  fipe_updated_at: string | null;
  codigo_fipe: string | null;
  historico_fipe: HistPoint[] | null;
};

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

const MES_PT_TO_NUM: Record<string, number> = {
  janeiro: 1, fevereiro: 2, "março": 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** "Janeiro/2024" ou "abril de 2025" → { mes: 1..12, ano: 2024 } */
function parseMesAno(raw: string): { mes: number; ano: number } {
  const s = String(raw || "").toLowerCase().trim();
  // separa pelo primeiro / ou " de "
  const parts = s.includes("/") ? s.split("/") : s.split(" de ");
  if (parts.length !== 2) return { mes: 0, ano: 0 };
  const mes = MES_PT_TO_NUM[parts[0].trim()] || 0;
  const ano = parseInt(parts[1].trim(), 10) || 0;
  return { mes, ano };
}

export function FipeCard({
  vehicleId,
}: {
  vehicleId: string;
  placa?: string;
  ano?: string;
}) {
  const [data, setData] = useState<VehicleFipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [openChart, setOpenChart] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setData(null);
    (async () => {
      const { data: row } = await supabase
        .from("veiculos")
        .select("fipe_valor,fipe_mes_referencia,fipe_updated_at,codigo_fipe,historico_fipe")
        .eq("id", vehicleId)
        .maybeSingle();
      const { data: historico } = await supabase
        .from("fipe_history")
        .select("mes_referencia, valor")
        .eq("vehicle_id", vehicleId)
        .order("mes_referencia", { ascending: true });
      if (cancel) return;
      const enriched: VehicleFipe = {
        ...(row as unknown as VehicleFipe | null),
        historico_fipe: (historico || []).map((h) => ({
          mes_ano_extenso: h.mes_referencia,
          valor: h.valor,
        })),
      } as VehicleFipe;
      setData(enriched ?? null);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [vehicleId]);

  const valor = data?.fipe_valor != null ? Number(data.fipe_valor) : null;
  const mes = data?.fipe_mes_referencia ?? null;
  const hasFipe = valor != null && valor > 0;
  const hist = Array.isArray(data?.historico_fipe) ? data!.historico_fipe! : [];
  const hasHistorico = hist.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => hasHistorico && setOpenChart(true)}
        disabled={!hasHistorico}
        className="mt-3 flex w-full items-center justify-between rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40 disabled:cursor-default disabled:opacity-80"
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-primary"
            style={{ boxShadow: "0 0 18px -4px var(--primary)" }}
          >
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tabela FIPE Atualizada
            </p>
            {loading ? (
              <p className="mt-1 text-sm text-muted-foreground">Carregando…</p>
            ) : hasFipe ? (
              <>
                <p className="mt-0.5 text-xl font-semibold text-foreground">{formatBRL(valor!)}</p>
                {mes && <p className="mt-0.5 text-[10px] text-muted-foreground">Ref.: {mes}</p>}
              </>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Valor FIPE indisponível para este veículo.
              </p>
            )}
          </div>
        </div>
        {hasHistorico && (
          <span className="text-[11px] font-semibold text-primary">Ver histórico</span>
        )}
      </button>

      {openChart && (
        <FipeChartModal historico={hist} onClose={() => setOpenChart(false)} />
      )}
    </>
  );
}

function FipeChartModal({
  historico,
  onClose,
}: {
  historico: HistPoint[];
  onClose: () => void;
}) {
  // Normaliza pontos com (mes, ano) parseados.
  const allPoints = useMemo(() => {
    return historico
      .map((h) => {
        const p = parseMesAno(h.mes_ano_extenso);
        return {
          mes_ano_extenso: h.mes_ano_extenso,
          mes: typeof h.mes === "number" ? h.mes : p.mes,
          ano: typeof h.ano === "number" && h.ano > 0 ? h.ano : p.ano,
          valor: typeof h.valor === "number" ? h.valor : Number(h.valor) || 0,
        };
      })
      .filter((p) => p.ano > 0 && p.mes > 0 && p.valor > 0);
  }, [historico]);

  // Lista de anos disponíveis, ordenada asc.
  const anosDisponiveis = useMemo(() => {
    const set = new Set<number>();
    allPoints.forEach((p) => set.add(p.ano));
    return Array.from(set).sort((a, b) => a - b);
  }, [allPoints]);

  const [anoIdx, setAnoIdx] = useState(() => Math.max(0, anosDisponiveis.length - 1));

  const anoAtual = anosDisponiveis[anoIdx] ?? null;

  const pontosDoAno = useMemo(() => {
    if (!anoAtual) return [];
    return allPoints
      .filter((p) => p.ano === anoAtual)
      .sort((a, b) => a.mes - b.mes);
  }, [allPoints, anoAtual]);

  const tickFormatter = (v: string) => {
    const lower = String(v || "").toLowerCase();
    const parts = lower.includes("/") ? lower.split("/") : lower.split(" de ");
    if (parts.length === 2) return parts[0].slice(0, 3);
    return v;
  };

  const goPrev = () => setAnoIdx((i) => Math.max(0, i - 1));
  const goNext = () => setAnoIdx((i) => Math.min(anosDisponiveis.length - 1, i + 1));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-t-3xl border border-primary/40 bg-card p-6 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary"
            style={{ boxShadow: "0 0 18px -4px var(--primary)" }}
          >
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Histórico FIPE
            </p>
            <h3 className="text-base font-semibold text-foreground">Evolução do valor</h3>
          </div>
        </div>

        <div className="mt-5 h-64 w-full">
          {pontosDoAno.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
              {anosDisponiveis.length === 0 ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Histórico não disponível
                </span>
              ) : (
                "Sem pontos para este ano."
              )}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pontosDoAno} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="mes_ano_extenso"
                  tickFormatter={tickFormatter}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [formatBRL(v), "Valor"]}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                />
                <Line
                  type="monotone"
                  dataKey="valor"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "var(--primary)" }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {anosDisponiveis.length > 0 && (
          <div className="mt-3 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={goPrev}
              disabled={anoIdx <= 0}
              aria-label="Ano anterior"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground transition-colors hover:text-primary disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-tech min-w-[80px] text-center text-base font-semibold tracking-wider text-primary">
              {anoAtual ?? "—"}
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={anoIdx >= anosDisponiveis.length - 1}
              aria-label="Próximo ano"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground transition-colors hover:text-primary disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
