import { useEffect, useState } from "react";
import { Loader2, Lock, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { unlockHistoryFn } from "@/lib/vehicles.functions";

/**
 * Banner "Carfax Reverso" exibido em Revisões/Despesas quando o veículo ativo
 * foi resgatado (history_locked = true). "Destravar" libera o histórico antigo;
 * "Dispensar" oculta o banner apenas para esta sessão.
 */
export function LockedHistoryBanner({
  vehicleId,
  onUnlocked,
}: {
  vehicleId: string;
  onUnlocked: () => void;
}) {
  const storageKey = `jarvys_dismiss_locked_${vehicleId}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDismissed(() => {
      try {
        return sessionStorage.getItem(storageKey) === "1";
      } catch {
        return false;
      }
    });
  }, [storageKey]);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const unlock = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await unlockHistoryFn({ data: { vehicleId } });
      toast.success("Porta-Luvas Digital destravado! Histórico completo liberado.");
      onUnlocked();
    } catch (e) {
      console.error("[unlockHistoryFn]", e);
      toast.error(e instanceof Error ? e.message : "Não foi possível destravar.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-primary/40 bg-card p-4"
      style={{
        boxShadow:
          "0 0 0 1px rgba(56,189,248,0.18), 0 12px 40px -16px rgba(56,189,248,0.35)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(56,189,248,0.25), transparent 70%)",
        }}
      />
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dispensar"
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="relative flex items-start gap-3 pr-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Lock className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-3 w-3" />
            Histórico oculto encontrado
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground">
            🔒 O antigo dono usava o Jarvys! Descobrimos um histórico de manutenções
            oculto. Destrave o Porta-Luvas Digital por{" "}
            <span className="font-semibold text-primary">R$ 49,90</span>.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={unlock}
              disabled={submitting}
              className="glow-neon inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Destravar
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-xl border border-border bg-secondary px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Dispensar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
