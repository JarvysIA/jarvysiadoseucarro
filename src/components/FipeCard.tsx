import { useEffect, useMemo, useState } from "react";
import { TrendingUp, X, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { refreshFipeFn } from "@/lib/fipe.functions";

type VehicleFipe = {
  fipe_valor: number | null;
  fipe_mes_referencia: string | null;
  fipe_updated_at: string | null;
  codigo_fipe: string | null;
};

type HistoryPoint = { mes_referencia: string; valor: number };

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

export function FipeCard({
  vehicleId,
  placa: _placa,
  ano: _ano,
}: {
  vehicleId: string;
  placa: string;
  ano: string;
}) {
  const [data, setData] = useState<VehicleFipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [openChart, setOpenChart] = useState(false);

  // Carrega cache do veículo
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setData(null);
    (async () => {
      const { data: row } = await supabase
        .from("veiculos")
        .select("fipe_valor,fipe_mes_referencia,fipe_updated_at,codigo_fipe")
        .eq("id", vehicleId)
        .maybeSingle();
      if (cancel) return;
      setData((row as VehicleFipe | null) ?? null);
      setLoading(false);

      // Lazy refresh (gratuito via BrasilAPI) se cache estiver velho
      const updated = (row as VehicleFipe | null)?.fipe_updated_at;
      const stale =
        !updated || Date.now() - new Date(updated).getTime() > 30 * 24 * 60 * 60 * 1000;
      if (stale && (row as VehicleFipe | null)?.codigo_fipe) {
        try {
          const res = await refreshFipeFn({ data: { vehicleId } });
          if (!cancel && "refreshed" in res && res.refreshed) {
            setData((prev) => ({
              ...(prev ?? { codigo_fipe: null }),
              fipe_valor: res.valor,
              fipe_mes_referencia: res.mes_referencia ?? null,
              fipe_updated_at: new Date().toISOString(),
              codigo_fipe: prev?.codigo_fipe ?? null,
            }));
          }
        } catch (e) {
          console.warn("[refreshFipeFn]", e);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [vehicleId]);

  const valor = data?.fipe_valor != null ? Number(data.fipe_valor) : null;
  const mes = data?.fipe_mes_referencia ?? null;
  const hasFipe = valor != null && valor > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => hasFipe && setOpenChart(true)}
        disabled={!hasFipe}
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
                <p className="mt-0.5 text-xl font-semibold text-foreground">
                  {formatBRL(valor!)}
                </p>
                {mes && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Ref.: {mes}</p>
                )}
              </>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Valor FIPE indisponível para este veículo.
              </p>
            )}
          </div>
        </div>
        {hasFipe && (
          <span className="text-[11px] font-semibold text-primary">Ver histórico</span>
        )}
      </button>

      {openChart && (
        <FipeChartModal vehicleId={vehicleId} onClose={() => setOpenChart(false)} />
      )}
    </>
  );
}

function FipeChartModal({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("fipe_history")
        .select("mes_referencia,valor,created_at")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: true });
      if (cancel) return;
      setPoints(
        ((data ?? []) as Array<{ mes_referencia: string; valor: number }>).map((r) => ({
          mes_referencia: r.mes_referencia,
          valor: Number(r.valor),
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [vehicleId]);

  const tickFormatter = useMemo(
    () => (v: string) => {
      // "janeiro de 2025" -> "jan/25"
      const lower = (v || "").toLowerCase();
      const parts = lower.split(" de ");
      if (parts.length === 2) {
        const m = parts[0].slice(0, 3);
        const y = parts[1].slice(-2);
        return `${m}/${y}`;
      }
      return v;
    },
    [],
  );

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
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : points.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
              Sem histórico FIPE disponível ainda.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="mes_referencia"
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
      </div>
    </div>
  );
}
