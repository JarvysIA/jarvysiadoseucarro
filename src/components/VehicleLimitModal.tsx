import { X, Lock, Sparkles } from "lucide-react";

export type VehicleLimitReason = "trial_limit" | "ativo_limit" | "no_eligible";

const COPY: Record<VehicleLimitReason, { title: string; body: string }> = {
  trial_limit: {
    title: "Limite de veículos atingido",
    body:
      "Você já possui um veículo gratuito. Ative seu veículo atual por R$29,90 para liberar mais um cadastro.",
  },
  ativo_limit: {
    title: "Limite de veículos atingido",
    body:
      "Seu veículo gratuito já está em uso. Ative o veículo gratuito da garagem por R$29,90 para liberar mais um cadastro.",
  },
  no_eligible: {
    title: "Todos os seus veículos já estão ativos",
    body:
      "Todos os seus veículos já estão ativos. Em breve liberaremos a compra de slots adicionais.",
  },
};

export function VehicleLimitModal({
  open,
  onClose,
  reason,
  eligibleVehicleId,
  onActivate,
}: {
  open: boolean;
  onClose: () => void;
  reason: VehicleLimitReason;
  eligibleVehicleId: string | null;
  onActivate: (vehicleId: string) => void;
}) {
  if (!open) return null;
  const copy = COPY[reason];
  const showCta = reason !== "no_eligible" && !!eligibleVehicleId;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center">
      <div
        className="glow-neon relative w-full max-w-md overflow-hidden rounded-t-3xl border border-primary/40 bg-card p-6 sm:rounded-3xl"
        style={{
          boxShadow:
            "0 0 0 1px rgba(56,189,248,0.25), 0 20px 60px -10px rgba(56,189,248,0.35)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-background/60 text-muted-foreground hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{copy.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          {showCta && (
            <button
              type="button"
              onClick={() => onActivate(eligibleVehicleId!)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              Ativar meu veículo agora
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-xl border border-border bg-background/40 px-4 py-3 text-sm font-medium text-foreground hover:bg-background/70"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}
