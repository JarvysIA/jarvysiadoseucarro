import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Sparkles, History, Gauge, Calendar } from "lucide-react";
import {
  STATUS_LABEL_PT,
  formatRemainingKm,
  formatRemainingMonths,
  type MaintComputed,
} from "@/lib/maintenance";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onClose: () => void;
  computed: MaintComputed | null;
  kmAtual: number;
};

export function MaintenancePanel({ open, onClose, computed, kmAtual }: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-3xl border-border bg-card p-0"
      >
        {computed && (
          <div className="flex flex-col gap-6 p-6">
            <SheetHeader className="text-left">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: `var(--status-${computed.status})`,
                    boxShadow: `0 0 12px -1px var(--status-${computed.status})`,
                  }}
                />
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: `var(--status-${computed.status})` }}
                >
                  {STATUS_LABEL_PT[computed.status]}
                </span>
              </div>
              <SheetTitle className="text-xl">{computed.item.nome}</SheetTitle>
              <SheetDescription>
                Histórico, próximas trocas e registros de despesas deste item.
              </SheetDescription>
            </SheetHeader>

            {/* Métricas resumo */}
            <div className="grid grid-cols-2 gap-3">
              <Metric
                icon={<Gauge className="h-4 w-4 text-primary" />}
                label="Por quilometragem"
                value={formatRemainingKm(computed.remainingKm)}
                hint={`Validade ${computed.item.validade_km.toLocaleString("pt-BR")} km`}
                highlight={computed.driver === "km"}
              />
              <Metric
                icon={<Calendar className="h-4 w-4 text-primary" />}
                label="Por tempo"
                value={formatRemainingMonths(computed.remainingMonths)}
                hint={`Validade ${computed.item.validade_meses} meses`}
                highlight={computed.driver === "tempo"}
              />
            </div>

            {/* Barra de progresso */}
            <div>
              <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Uso</span>
                <span>{Math.round(Math.min(computed.pct, 1.5) * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/60">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${Math.min(computed.pct, 1) * 100}%`,
                    backgroundColor: `var(--status-${computed.status})`,
                    boxShadow: `0 0 12px -2px var(--status-${computed.status})`,
                  }}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                KM atual do veículo:{" "}
                <span className="font-medium text-foreground">
                  {kmAtual.toLocaleString("pt-BR")} km
                </span>{" "}
                · Última troca em{" "}
                <span className="font-medium text-foreground">
                  {computed.item.ultima_troca_km.toLocaleString("pt-BR")} km
                </span>
              </p>
            </div>

            {/* Histórico vazio */}
            <div className="rounded-2xl border border-dashed border-border bg-background/40 p-5 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                <History className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">
                Nenhum registro ainda
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Adicione sua primeira nota fiscal ou orçamento para começar o histórico.
              </p>
            </div>

            {/* CTA IA */}
            <button
              type="button"
              onClick={() =>
                toast.info("Em breve: leitura de Nota Fiscal/Orçamento com IA.")
              }
              className="glow-neon group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-5 py-5 text-base font-semibold text-primary-foreground shadow-lg transition-transform active:scale-[0.98]"
            >
              <Sparkles className="h-5 w-5" />
              Adicionar Registro com IA
              <span className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-white/40" />
            </button>
            <p className="-mt-3 text-center text-[11px] text-muted-foreground">
              Tire foto da nota fiscal ou orçamento — a IA preenche tudo automaticamente.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border bg-background/40 p-3 ${
        highlight ? "border-primary/50" : "border-border"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-sm font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}
