import { useEffect, useState } from "react";
import { Loader2, Car, AlertCircle, Check } from "lucide-react";

export type FipeOption = {
  codigo_fipe: string;
  modelo: string;
  valor: number;
  combustivel?: string;
  ano_modelo?: string;
  mes_referencia?: string;
  placafipe_hash: string;
  codigo_marca?: string;
  codigo_modelo?: string;
};

export type PlateLookupResult = {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  motorizacao: string;
  chassi?: string;
  cilindradas?: string;
  fipe_options?: FipeOption[];
} | null;

export type CarConfirmPayload = {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  motorizacao: string;
  chassi: string;
  km_atual: number | null;
  fipe: FipeOption | null;
  cilindradas?: string | null;
};

type Props = {
  open: boolean;
  plate: string;
  /** Async lookup. Return null/undefined to fall back to manual fill. */
  lookup: (plate: string) => Promise<PlateLookupResult>;
  onConfirm: (data: CarConfirmPayload) => Promise<void> | void;
};

function formatBRL(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function CarConfirmModal({ open, plate, lookup, onConfirm }: Props) {
  const [loading, setLoading] = useState(true);
  const [autofilled, setAutofilled] = useState(false);
  const [notFoundNotice, setNotFoundNotice] = useState(false);
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [ano, setAno] = useState("");
  const [cor, setCor] = useState("");
  const [motorizacao, setMotorizacao] = useState("");
  const [chassi, setChassi] = useState("");
  const [cilindradas, setCilindradas] = useState<string | null>(null);
  const [km, setKm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fipeOptions, setFipeOptions] = useState<FipeOption[]>([]);
  const [selectedFipe, setSelectedFipe] = useState<FipeOption | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoading(true);
    setAutofilled(false);
    setNotFoundNotice(false);
    setMarca("");
    setModelo("");
    setAno("");
    setCor("");
    setMotorizacao("");
    setChassi("");
    setCilindradas(null);
    setFipeOptions([]);
    setSelectedFipe(null);
    lookup(plate).then((r) => {
      if (cancel) return;
      if (r) {
        setMarca(r.marca || "");
        setModelo(r.modelo || "");
        setAno(r.ano || "");
        setCor(r.cor || "");
        setMotorizacao(r.motorizacao || "");
        setChassi(r.chassi || "");
        setCilindradas(r.cilindradas ?? null);
        setAutofilled(true);
        const opts = r.fipe_options ?? [];
        setFipeOptions(opts);
        // 1 versão → auto-seleciona. >1 versões → exige escolha.
        if (opts.length === 1) setSelectedFipe(opts[0]);
      } else {
        setNotFoundNotice(true);
      }
      setLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, [open, plate, lookup]);

  if (!open) return null;

  const needsFipeChoice = fipeOptions.length > 1 && !selectedFipe;

  const handleConfirm = async () => {
    if (!marca.trim() || !modelo.trim()) {
      setNotFoundNotice(true);
      return;
    }
    if (needsFipeChoice) return;
    setSubmitting(true);
    try {
      await onConfirm({
        marca: marca.trim(),
        modelo: modelo.trim(),
        ano: ano.trim(),
        cor: cor.trim(),
        motorizacao: motorizacao.trim(),
        chassi: chassi.trim(),
        km_atual: km ? Number(km.replace(/\D/g, "")) || null : null,
        fipe: selectedFipe,
        cilindradas,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center">
      <div
        className="glow-neon relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-primary/40 bg-card p-6 sm:rounded-3xl"
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

        <div className="relative">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
              <Car className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Confirme seu veículo
              </p>
              <h2 className="font-tech text-lg font-bold tracking-wide text-primary">
                {plate.toUpperCase()}
              </h2>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="font-tech text-xs uppercase tracking-widest text-muted-foreground">
                Buscando veículo na base nacional...
              </p>
              <div className="mt-2 h-px w-40 overflow-hidden bg-[rgba(56,189,248,0.15)]">
                <div className="h-full w-1/3 animate-scan-line bg-[#38BDF8] shadow-[0_0_10px_#38BDF8]" />
              </div>
            </div>
          ) : (
            <>
              {autofilled && (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3 text-[11px] text-primary">
                  <Check className="h-4 w-4 shrink-0" />
                  Dados preenchidos automaticamente. Você pode editar se algo estiver errado.
                </div>
              )}
              {notFoundNotice && !autofilled && (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Não conseguimos localizar a placa automaticamente. Por favor, digite os
                  dados do veículo manualmente.
                </div>
              )}

              <div className="space-y-3">
                <ManualField label="Marca" value={marca} onChange={setMarca} placeholder="Ex.: Toyota" />
                <ManualField label="Modelo" value={modelo} onChange={setModelo} placeholder="Ex.: Corolla XEi" />
                <div className="grid grid-cols-2 gap-3">
                  <ManualField label="Ano" value={ano} onChange={setAno} placeholder="2022" />
                  <ManualField label="Cor" value={cor} onChange={setCor} placeholder="Preto" />
                </div>
                <ManualField label="Motor" value={motorizacao} onChange={setMotorizacao} placeholder="2.0 Flex" />
              </div>

              {fipeOptions.length > 1 && (
                <div className="mt-5 rounded-2xl border border-primary/30 bg-primary/5 p-4">
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                    <AlertCircle className="h-4 w-4" />
                    Selecione a versão FIPE do seu veículo
                  </div>
                  <p className="mb-3 text-[11px] text-muted-foreground">
                    Encontramos {fipeOptions.length} versões para esta placa. Escolha a
                    correta — isso define o valor FIPE e o histórico do veículo.
                  </p>
                  <div className="space-y-2">
                    {fipeOptions.map((opt) => {
                      const isSel = selectedFipe?.codigo_fipe === opt.codigo_fipe;
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
                            name="fipe-version"
                            className="sr-only"
                            checked={isSel}
                            onChange={() => setSelectedFipe(opt)}
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
                </div>
              )}

              <div className="mt-4">
                <label className="block rounded-2xl border border-border bg-card px-4 py-3">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    KM Atual do Painel{" "}
                    <span className="text-muted-foreground/60">(opcional)</span>
                  </span>
                  <input
                    inputMode="numeric"
                    value={km}
                    onChange={(e) => setKm(e.target.value.replace(/\D/g, ""))}
                    placeholder="Ex.: 38500"
                    className="mt-1 w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                </label>
              </div>

              {needsFipeChoice && (
                <p className="mt-3 text-center text-[11px] text-amber-300">
                  Escolha uma versão FIPE acima para continuar.
                </p>
              )}

              <button
                type="button"
                disabled={submitting || needsFipeChoice}
                onClick={handleConfirm}
                className="glow-neon mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Confirmar e Ir para a Garagem
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block rounded-2xl border border-border bg-card px-4 py-3">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </label>
  );
}
