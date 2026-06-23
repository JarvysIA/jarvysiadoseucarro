import { useState } from "react";
import { AlertCircle, Check, Loader2, X } from "lucide-react";

export type FipePickerOption = {
  codigo_fipe: string;
  modelo: string;
  valor: number;
  combustivel?: string;
  ano_modelo?: string;
  mes_referencia?: string;
  placafipe_hash: string;
};

type Props = {
  open: boolean;
  plate: string;
  options: FipePickerOption[];
  onClose: () => void;
  onChoose: (opt: FipePickerOption) => Promise<void> | void;
};

function formatBRL(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Picker reutilizável de versão FIPE. Usado pela garagem (FipeCard).
 * NUNCA escolhe a primeira opção sozinho — exige confirmação explícita.
 * Não toca trial: o consumidor decide quando iniciar trial.
 */
export function FipeVersionPickerModal({
  open,
  plate,
  options,
  onClose,
  onChoose,
}: Props) {
  const [selected, setSelected] = useState<FipePickerOption | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      await onChoose(selected);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-primary/40 bg-card p-6 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          boxShadow:
            "0 0 0 1px rgba(56,189,248,0.25), 0 20px 60px -10px rgba(56,189,248,0.35)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Selecione a versão FIPE
            </p>
            <h2 className="font-tech text-lg font-bold tracking-wide text-primary">
              {plate.toUpperCase()}
            </h2>
          </div>
        </div>

        <p className="mb-3 text-[11px] text-muted-foreground">
          Encontramos {options.length} versões para esta placa. Escolha a correta —
          isso define o valor FIPE e o histórico do veículo.
        </p>

        <div className="space-y-2">
          {options.map((opt) => {
            const isSel = selected?.codigo_fipe === opt.codigo_fipe;
            return (
              <label
                key={opt.codigo_fipe}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                  isSel
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <input
                  type="radio"
                  name="fipe-version-picker"
                  className="sr-only"
                  checked={isSel}
                  onChange={() => setSelected(opt)}
                />
                <span
                  className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                    isSel ? "border-primary" : "border-muted-foreground/50"
                  }`}
                >
                  {isSel && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {opt.modelo || opt.codigo_fipe}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {opt.ano_modelo && <span>{opt.ano_modelo}</span>}
                    {opt.combustivel && <span>· {opt.combustivel}</span>}
                    <span className="ml-auto font-semibold text-primary">
                      {formatBRL(opt.valor)}
                    </span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <button
          type="button"
          disabled={!selected || submitting}
          onClick={handleConfirm}
          className="glow-neon mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Confirmar versão
        </button>
      </div>
    </div>
  );
}
