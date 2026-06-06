import { Crown, X, Star } from "lucide-react";

export type PaywallMode = "upgrade-vip" | "upgrade-super_vip" | "enterprise";

export function PaywallModal({
  open,
  onClose,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  mode: PaywallMode;
}) {
  if (!open) return null;

  const config =
    mode === "upgrade-vip"
      ? {
          icon: <Star className="h-7 w-7" />,
          title: "Garagem Premium",
          desc: "Você atingiu o limite de 1 veículo do plano gratuito. Faça upgrade para o ⭐ VIP e cadastre até 2 veículos com inteligência do Jarvys.",
          cta: "Quero ser VIP",
        }
      : mode === "upgrade-super_vip"
        ? {
            icon: <Crown className="h-7 w-7" />,
            title: "Garagem Ilimitada",
            desc: "Você atingiu o limite de 2 veículos do plano VIP. Eleve-se ao 👑 Super VIP e tenha veículos ilimitados, prioridade total e tratamento exclusivo da IA.",
            cta: "Quero ser Super VIP",
          }
        : {
            icon: <Crown className="h-7 w-7" />,
            title: "Limite Atingido",
            desc: "Limite máximo da sua conta atingido. Entre em contato com o time Jarvys para liberar mais veículos.",
            cta: null,
          };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center">
      <div
        className="relative w-full max-w-md overflow-hidden rounded-t-3xl border border-primary/40 bg-card p-6 sm:rounded-3xl"
        style={{
          boxShadow:
            "0 0 0 1px rgba(56,189,248,0.25), 0 20px 60px -10px rgba(56,189,248,0.35)",
        }}
      >
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(56,189,248,0.25), transparent 70%)",
          }}
        />

        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {config.icon}
          </div>

          <h2 className="font-tech text-lg font-bold tracking-wide text-primary">
            {config.title}
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {config.desc}
          </p>

          {config.cta && (
            <button
              type="button"
              onClick={() => {
                window.location.href = "https://jarvys.com.br/assinar";
              }}
              className="glow-neon mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              <Crown className="h-4 w-4" />
              {config.cta}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-3 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}
