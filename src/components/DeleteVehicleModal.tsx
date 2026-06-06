import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { sanitizePlate } from "@/lib/plate-lookup";
import { softDeleteVehicleFn } from "@/lib/vehicles.functions";

export function DeleteVehicleModal({
  open,
  onClose,
  vehicleId,
  placa,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  vehicleId: string;
  placa: string;
  onDeleted: () => void;
}) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const target = sanitizePlate(placa);
  const matches = sanitizePlate(input) === target && target.length > 0;

  useEffect(() => {
    if (!open) {
      setInput("");
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const confirm = async () => {
    if (!matches || submitting) return;
    setSubmitting(true);
    try {
      await softDeleteVehicleFn({
        data: { vehicleId, placaConfirm: target },
      });
      toast.success("Veículo removido da sua garagem.");
      onDeleted();
      onClose();
    } catch (e) {
      console.error("[softDeleteVehicleFn]", e);
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center">
      <div className="relative w-full max-w-md overflow-hidden rounded-t-3xl border border-destructive/40 bg-card p-6 sm:rounded-3xl">
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Exclusão de veículo
            </p>
            <h2 className="font-tech text-lg font-bold tracking-wide text-destructive">
              Atenção: ação destrutiva
            </h2>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-foreground">
          Você perderá acesso a este veículo e ao seu histórico.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          Para confirmar, digite a placa{" "}
          <span className="font-tech font-semibold tracking-wider text-foreground">
            {target}
          </span>{" "}
          abaixo.
        </p>

        <label className="mt-4 block rounded-2xl border border-border bg-card px-4 py-3 focus-within:border-destructive/60">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Confirmação da placa
          </span>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite a placa exata"
            autoCapitalize="characters"
            className="font-tech mt-1 w-full bg-transparent text-lg uppercase tracking-[0.2em] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </label>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-2xl border border-border bg-secondary py-3 text-sm font-semibold text-foreground hover:bg-secondary/80 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!matches || submitting}
            className="flex items-center justify-center gap-2 rounded-2xl bg-destructive py-3 text-sm font-semibold text-destructive-foreground transition-opacity disabled:opacity-40"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
