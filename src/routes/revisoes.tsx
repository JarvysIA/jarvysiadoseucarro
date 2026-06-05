import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Camera, Gauge, Loader2, Plus, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { NewExpenseModal } from "@/components/NewExpenseModal";
import { useActiveVehicleId } from "@/lib/active-vehicle";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CATEGORIA_COLOR,
  formatBRL,
  getReceiptSignedUrl,
  type Despesa,
} from "@/lib/despesas";

export const Route = createFileRoute("/revisoes")({
  head: () => ({ meta: [{ title: "Revisões — Jarvys" }] }),
  component: RevisoesPage,
});

function RevisoesPage() {
  const activeVehicleId = useActiveVehicleId();
  const [items, setItems] = useState<Despesa[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDespesa, setOpenDespesa] = useState<Despesa | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [vehicleKm, setVehicleKm] = useState(0);

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

  useEffect(() => {
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
      const { data, error } = await supabase
        .from("despesas")
        .select("*")
        .eq("vehicle_id", activeVehicleId)
        .in("categoria", ["Revisão", "Manutenção"])
        .order("data", { ascending: false });
      if (!cancel) {
        if (error) {
          console.error("[revisoes]", error);
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
  }, [activeVehicleId, reloadKey]);

  // Carrega o signed URL ao abrir o modal
  useEffect(() => {
    setReceiptUrl(null);
    if (!openDespesa?.receipt_image_url) return;
    setReceiptLoading(true);
    let cancel = false;
    getReceiptSignedUrl(openDespesa.receipt_image_url).then((url) => {
      if (cancel) return;
      setReceiptUrl(url);
      setReceiptLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, [openDespesa]);

  const grouped = useMemo(() => {
    // Agrupar por ano para a timeline (apenas visual)
    const map = new Map<number, Despesa[]>();
    for (const d of items) {
      const y = new Date(d.data).getFullYear();
      if (!map.has(y)) map.set(y, []);
      map.get(y)!.push(d);
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [items]);

  return (
    <div className="relative min-h-screen bg-background pb-40">
      <header className="px-6 pt-10">
        <h1 className="text-2xl font-semibold">Revisões</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Histórico global de revisões e manutenções — seu porta-luvas digital.
        </p>
      </header>

      <section className="mt-6 px-6">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
              <Wrench className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">
              Nenhuma revisão registrada ainda
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Adicione uma nota fiscal pelo Status do Veículo para iniciar sua timeline.
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Linha vertical neon */}
            <div
              className="absolute left-[18px] top-2 bottom-2 w-px"
              style={{
                background:
                  "linear-gradient(180deg, color-mix(in oklab, var(--primary) 60%, transparent), transparent)",
              }}
            />
            <div className="flex flex-col gap-6">
              {grouped.map(([year, list]) => (
                <div key={year}>
                  <p className="mb-3 pl-12 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {year}
                  </p>
                  <ul className="flex flex-col gap-3">
                    {list.map((d) => {
                      const color = CATEGORIA_COLOR[d.categoria];
                      const hasReceipt = !!d.receipt_image_url;
                      return (
                        <li key={d.id} className="relative pl-12">
                          {/* Bolinha do timeline */}
                          <span
                            className="absolute left-[10px] top-4 h-4 w-4 rounded-full border-2 border-background"
                            style={{
                              backgroundColor: color,
                              boxShadow: `0 0 12px -2px ${color}`,
                            }}
                            aria-hidden
                          />
                          <button
                            type="button"
                            onClick={() => setOpenDespesa(d)}
                            className="w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 active:scale-[0.99]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                                    style={{
                                      color,
                                      backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
                                    }}
                                  >
                                    {d.categoria}
                                  </span>
                                  {hasReceipt && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                                      title="Nota fiscal anexada"
                                    >
                                      <Camera className="h-3 w-3" />
                                      Nota
                                    </span>
                                  )}
                                </div>
                                <p className="mt-2 truncate text-sm font-semibold text-foreground">
                                  {d.descricao || d.categoria}
                                </p>
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  {new Date(d.data).toLocaleDateString("pt-BR", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  })}
                                  {d.km_registro != null && (
                                    <>
                                      {" · "}
                                      <Gauge className="inline h-3 w-3 text-primary" />{" "}
                                      {d.km_registro.toLocaleString("pt-BR")} km
                                    </>
                                  )}
                                </p>
                              </div>
                              <p className="text-sm font-bold text-foreground">
                                {formatBRL(Number(d.valor))}
                              </p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Modal: detalhes + foto da nota */}
      <Dialog open={!!openDespesa} onOpenChange={(o) => !o && setOpenDespesa(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-md">
          {openDespesa && (
            <>
              <DialogHeader>
                <DialogTitle className="text-left">
                  {openDespesa.descricao || openDespesa.categoria}
                </DialogTitle>
                <DialogDescription className="text-left">
                  Conferência do "papel original" — dados extraídos e imagem da nota.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <Info label="Data">
                  {new Date(openDespesa.data).toLocaleDateString("pt-BR")}
                </Info>
                <Info label="Categoria">
                  <span style={{ color: CATEGORIA_COLOR[openDespesa.categoria] }}>
                    {openDespesa.categoria}
                  </span>
                </Info>
                <Info label="Valor">{formatBRL(Number(openDespesa.valor))}</Info>
                <Info label="KM">
                  {openDespesa.km_registro != null
                    ? `${openDespesa.km_registro.toLocaleString("pt-BR")} km`
                    : "—"}
                </Info>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Nota fiscal
                </p>
                {!openDespesa.receipt_image_url ? (
                  <div className="rounded-xl border border-dashed border-border bg-background/40 p-6 text-center text-xs text-muted-foreground">
                    Nenhuma imagem anexada.
                  </div>
                ) : receiptLoading ? (
                  <div className="flex h-48 items-center justify-center rounded-xl border border-border bg-background/40">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : receiptUrl ? (
                  <a
                    href={receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-xl border border-border"
                  >
                    <img
                      src={receiptUrl}
                      alt="Nota fiscal"
                      className="h-auto w-full object-contain"
                    />
                  </a>
                ) : (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-center text-xs text-destructive">
                    Não foi possível carregar a imagem.
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* FAB — novo registro manual */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        aria-label="Novo registro"
        className="glow-neon fixed bottom-24 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.7_0.18_250)] text-primary-foreground shadow-xl transition-transform active:scale-95"
      >
        <Plus className="h-6 w-6" />
      </button>

      <NewExpenseModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        vehicleId={activeVehicleId}
        kmAtualVeiculo={vehicleKm}
        defaultCategoria="Revisão"
        onCreated={() => setReloadKey((k) => k + 1)}
        onVehicleKmUpdated={(km) => setVehicleKm(km)}
      />

      <BottomNav />
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{children}</p>
    </div>
  );
}
