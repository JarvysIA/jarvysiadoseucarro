import { useEffect, useMemo, useState } from "react";
import { TrendingUp, X, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { fetchFipeHistoryFn, type FipeHistoryPoint } from "@/lib/fipe-history.functions";

type VehicleFipe = {
  placa: string | null;
  fipe_valor: number | null;
  fipe_mes_referencia: string | null;
  fipe_updated_at: string | null;
  codigo_fipe: string | null;
  fipe_historico: FipeHistoryPoint[] | null;
  fipe_ultima_atualizacao: string | null;
};

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

const MES_PT_TO_NUM: Record<string, number> = {
  janeiro: 1, fevereiro: 2, "março": 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** "abril de 2025" → 202504 */
function parseRefMonth(s: string): number {
  if (!s) return 0;
  const parts = s.toLowerCase().trim().split(" de ");
  if (parts.length !== 2) return 0;
  const mes = MES_PT_TO_NUM[parts[0].trim()] || 0;
  const ano = parseInt(parts[1].trim(), 10) || 0;
  return ano * 100 + mes;
}

/**
 * Lazy update rule: refetch from external API se:
 *  (A) histórico vazio/nulo, OU
 *  (B) hoje >= dia 7 E (ano,mês) da última atualização < (ano,mês) atual.
 */
function shouldRefetch(historico: FipeHistoryPoint[] | null, lastAt: string | null): boolean {
  if (!historico || historico.length === 0) return true;
  if (!lastAt) return true;
  const now = new Date();
  if (now.getDate() < 7) return false;
  const last = new Date(lastAt);
  const lastKey = last.getFullYear() * 100 + (last.getMonth() + 1);
  const nowKey = now.getFullYear() * 100 + (now.getMonth() + 1);
  return lastKey < nowKey;
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

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setData(null);
    (async () => {
      const { data: row } = await supabase
        .from("veiculos")
        .select(
          "placa,fipe_valor,fipe_mes_referencia,fipe_updated_at,codigo_fipe,fipe_historico,fipe_ultima_atualizacao",
        )
        .eq("id", vehicleId)
        .maybeSingle();
      if (cancel) return;
      setData((row as unknown as VehicleFipe | null) ?? null);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [vehicleId]);

  const valor = data?.fipe_valor != null ? Number(data.fipe_valor) : null;
  const mes = data?.fipe_mes_referencia ?? null;
  const hasFipe = valor != null && valor > 0;
  const codigoFipe = data?.codigo_fipe ?? null;
  const placa = data?.placa ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => codigoFipe && setOpenChart(true)}
        disabled={!codigoFipe}
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
        {codigoFipe && (
          <span className="text-[11px] font-semibold text-primary">Ver histórico</span>
        )}
      </button>

      {openChart && (
        <FipeChartModal
          vehicleId={vehicleId}
          placa={placa}
          codigoFipe={codigoFipe}
          cachedHistorico={data?.fipe_historico ?? null}
          lastUpdate={data?.fipe_ultima_atualizacao ?? null}
          onClose={() => setOpenChart(false)}
          onCacheUpdated={(novoHist, novaData) =>
            setData((d) =>
              d ? { ...d, fipe_historico: novoHist, fipe_ultima_atualizacao: novaData } : d,
            )
          }
        />
      )}
    </>
  );
}

function FipeChartModal({
  vehicleId,
  placa,
  codigoFipe,
  cachedHistorico,
  lastUpdate,
  onClose,
  onCacheUpdated,
}: {
  vehicleId: string;
  placa: string | null;
  codigoFipe: string | null;
  cachedHistorico: FipeHistoryPoint[] | null;
  lastUpdate: string | null;
  onClose: () => void;
  onCacheUpdated: (h: FipeHistoryPoint[], at: string) => void;
}) {
  const [points, setPoints] = useState<FipeHistoryPoint[]>(cachedHistorico ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    if (!codigoFipe || !placa) return;

    const mustFetch = shouldRefetch(cachedHistorico, lastUpdate);
    if (!mustFetch) {
      setPoints(cachedHistorico ?? []);
      return;
    }

    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetchFipeHistoryFn({
          data: { placa, codigoFipe },
        });
        if (cancel) return;
        if (!res.ok || res.historico.length === 0) {
          // mantém o que houver em cache; se nada, fica vazio
          setPoints(cachedHistorico ?? []);
          setError(res.ok ? null : res.error);
          return;
        }
        setPoints(res.historico);
        // Write-through cache no Supabase
        const nowIso = new Date().toISOString();
        const { error: upErr } = await supabase
          .from("veiculos")
          .update({
            fipe_historico: res.historico as unknown as never,
            fipe_ultima_atualizacao: nowIso,
          } as never)
          .eq("id", vehicleId);
        if (!upErr) onCacheUpdated(res.historico, nowIso);
      } catch (e) {
        if (!cancel) setError((e as Error).message || "Erro ao buscar histórico");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigoFipe, placa, vehicleId]);

  const tickFormatter = useMemo(
    () => (v: string) => {
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

  const sortedPoints = useMemo(
    () =>
      [...points].sort(
        (a, b) => parseRefMonth(a.mes_referencia) - parseRefMonth(b.mes_referencia),
      ),
    [points],
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
          {!codigoFipe || !placa ? (
            <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
              Histórico não disponível para este veículo
            </div>
          ) : loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <Loader2
                className="h-7 w-7 animate-spin text-primary"
                style={{ filter: "drop-shadow(0 0 8px var(--primary))" }}
              />
              <p className="text-[11px] font-medium text-muted-foreground">
                Atualizando histórico FIPE…
              </p>
            </div>
          ) : sortedPoints.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
              {error
                ? "Não foi possível carregar o histórico agora."
                : "Histórico não disponível para este veículo"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sortedPoints} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
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
