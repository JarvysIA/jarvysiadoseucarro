import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Wallet, Receipt, Loader2, Plus } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { NewExpenseModal } from "@/components/NewExpenseModal";
import { useActiveVehicleId } from "@/lib/active-vehicle";
import {
  CATEGORIAS,
  CATEGORIA_COLOR,
  formatBRL,
  type Despesa,
  type DespesaCategoria,
} from "@/lib/despesas";

export const Route = createFileRoute("/despesas")({
  head: () => ({ meta: [{ title: "Despesas — Jarvys" }] }),
  component: DespesasPage,
});

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function monthBounds(year: number, month0: number) {
  const start = new Date(year, month0, 1, 0, 0, 0, 0);
  const end = new Date(year, month0 + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function DespesasPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0..11
  const activeVehicleId = useActiveVehicleId();
  const [items, setItems] = useState<Despesa[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [vehicleKm, setVehicleKm] = useState(0);

  // Carrega KM atual do veículo ativo (para defaults do modal)
  useEffect(() => {
    if (!activeVehicleId) {
      setVehicleKm(0);
      return;
    }
    supabase
      .from("veiculos")
      .select("km_atual")
      .eq("id", activeVehicleId)
      .maybeSingle()
      .then(({ data }) => setVehicleKm(data?.km_atual ?? 0));
  }, [activeVehicleId, reloadKey]);
    let cancel = false;
    (async () => {
      setLoading(true);
      if (!activeVehicleId) {
        if (!cancel) {
          setItems([]);
          setLoading(false);
        }
        return;
      }
      const { start, end } = monthBounds(year, month);
      const { data, error } = await supabase
        .from("despesas")
        .select("*")
        .eq("vehicle_id", activeVehicleId)
        .gte("data", start.toISOString())
        .lt("data", end.toISOString())
        .order("data", { ascending: false });
      if (!cancel) {
        if (error) {
          console.error("[despesas]", error);
          setItems([]);
        } else {
          setItems((data || []) as Despesa[]);
        }
        setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [year, month, activeVehicleId]);

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  };

  const total = useMemo(
    () => items.reduce((s, d) => s + Number(d.valor || 0), 0),
    [items],
  );

  const byCategoria = useMemo(() => {
    const m = new Map<DespesaCategoria, number>();
    CATEGORIAS.forEach((c) => m.set(c, 0));
    for (const d of items) {
      m.set(d.categoria, (m.get(d.categoria) || 0) + Number(d.valor || 0));
    }
    return CATEGORIAS.map((c) => ({
      name: c,
      value: m.get(c) || 0,
      color: CATEGORIA_COLOR[c],
    }));
  }, [items]);

  const chartData = byCategoria.filter((d) => d.value > 0);

  return (
    <div className="relative min-h-screen bg-background pb-40">
      <header className="px-6 pt-10">
        <h1 className="text-2xl font-semibold">Despesas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Controle gastos com combustível, manutenção e seguros em um só lugar.
        </p>
      </header>

      {/* Navegação temporal */}
      <section className="mt-6 px-6">
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-2">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Mês anterior"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Período
            </p>
            <p className="text-sm font-semibold text-foreground">
              {MESES_PT[month]} {year}
            </p>
          </div>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Próximo mês"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </section>

      {/* Gasto total */}
      <section className="mt-4 px-6">
        <div className="glow-neon rounded-2xl border border-primary/30 bg-card p-5">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Wallet className="h-3.5 w-3.5 text-primary" />
            Gasto total no mês
          </div>
          <p className="mt-1 text-3xl font-bold text-foreground">{formatBRL(total)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {items.length} {items.length === 1 ? "lançamento" : "lançamentos"}
          </p>
        </div>
      </section>

      {/* Gráfico de Pizza */}
      <section className="mt-6 px-6">
        <h2 className="mb-3 text-sm font-semibold">Distribuição por categoria</h2>
        <div className="rounded-2xl border border-border bg-card p-5">
          {loading ? (
            <div className="flex h-56 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhuma despesa neste mês.</p>
            </div>
          ) : (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={90}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {chartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(value: number, name) => [formatBRL(value), name as string]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {byCategoria.map((d) => {
                  const pct = total > 0 ? (d.value / total) * 100 : 0;
                  return (
                    <div
                      key={d.name}
                      className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: d.color,
                            boxShadow: `0 0 10px -2px ${d.color}`,
                          }}
                        />
                        <span className="truncate text-[11px] font-medium text-foreground">
                          {d.name}
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Lista de transações */}
      <section className="mt-6 px-6">
        <h2 className="mb-3 text-sm font-semibold">Extrato do mês</h2>
        {loading ? null : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Sem lançamentos em {MESES_PT[month]} de {year}.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
              >
                <span
                  className="h-9 w-9 shrink-0 rounded-xl"
                  style={{
                    backgroundColor: `color-mix(in oklab, ${CATEGORIA_COLOR[d.categoria]} 15%, transparent)`,
                    boxShadow: `inset 0 0 0 1px ${CATEGORIA_COLOR[d.categoria]}`,
                  }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {d.descricao || d.categoria}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(d.data).toLocaleDateString("pt-BR")} ·{" "}
                    <span style={{ color: CATEGORIA_COLOR[d.categoria] }}>{d.categoria}</span>
                  </p>
                </div>
                <p className="text-sm font-semibold text-foreground">
                  {formatBRL(Number(d.valor))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BottomNav />
    </div>
  );
}
