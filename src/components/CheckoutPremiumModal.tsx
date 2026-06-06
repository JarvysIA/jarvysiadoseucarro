import { useState } from "react";
import { CreditCard, Loader2, Lock, QrCode, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { unlockHistoryFn } from "@/lib/vehicles.functions";

type PayMethod = "pix" | "card";

/**
 * Modal de checkout (simulado) para destravar o "Porta-Luvas Digital" — R$ 49,90.
 * Ao finalizar, dispara `unlockHistoryFn` e notifica o caller para recarregar a timeline.
 */
export function CheckoutPremiumModal({
  open,
  onOpenChange,
  vehicleId,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vehicleId: string;
  onUnlocked: () => void;
}) {
  const [method, setMethod] = useState<PayMethod>("pix");
  const [submitting, setSubmitting] = useState(false);

  const handleFinish = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await unlockHistoryFn({ data: { vehicleId } });
      toast.success("Pagamento confirmado! Porta-Luvas Digital destravado.");
      onOpenChange(false);
      onUnlocked();
    } catch (e) {
      console.error("[checkout unlock]", e);
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir o pagamento.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-left">Porta-Luvas Digital</DialogTitle>
              <DialogDescription className="text-left">
                Liberação vitalícia do histórico oculto deste veículo.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Resumo */}
        <div
          className="relative overflow-hidden rounded-2xl border border-primary/40 bg-background/40 p-4"
          style={{ boxShadow: "0 0 0 1px rgba(56,189,248,0.18)" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -top-12 -right-10 h-32 w-32 rounded-full"
            style={{
              background: "radial-gradient(closest-side, rgba(56,189,248,0.22), transparent 70%)",
            }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Resumo do pedido
          </p>
          <p className="mt-2 text-sm text-foreground">
            Você está adquirindo o <strong>Porta-Luvas Digital</strong> deste veículo.
          </p>
          <ul className="mt-3 space-y-1 text-[12px] text-muted-foreground">
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Histórico completo de revisões e despesas anteriores
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Acesso vitalício enquanto o veículo for seu
            </li>
          </ul>
          <div className="mt-4 flex items-end justify-between border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-2xl font-bold text-foreground">
              R$ 49<span className="text-base">,90</span>
            </span>
          </div>
        </div>

        {/* Métodos de pagamento */}
        <div className="mt-1">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Forma de pagamento
          </p>
          <div className="grid grid-cols-2 gap-2">
            <MethodButton
              active={method === "pix"}
              onClick={() => setMethod("pix")}
              icon={<QrCode className="h-4 w-4" />}
              label="Pix"
              hint="Aprovação imediata"
            />
            <MethodButton
              active={method === "card"}
              onClick={() => setMethod("card")}
              icon={<CreditCard className="h-4 w-4" />}
              label="Cartão"
              hint="Crédito à vista"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleFinish}
          disabled={submitting}
          className="glow-neon mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Lock className="h-4 w-4" />
          )}
          Finalizar pagamento · R$ 49,90
        </button>

        <p className="text-center text-[10px] text-muted-foreground">
          Pagamento simulado · ambiente de demonstração
        </p>
      </DialogContent>
    </Dialog>
  );
}

function MethodButton({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-primary/60 bg-primary/10"
          : "border-border bg-background/40 hover:border-primary/30"
      }`}
    >
      <div className="flex items-center gap-2 text-foreground">
        <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </button>
  );
}
