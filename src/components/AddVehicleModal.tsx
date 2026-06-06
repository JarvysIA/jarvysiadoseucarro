import { useEffect, useState } from "react";
import { Loader2, Car, AlertCircle, Check, Search, X, Gauge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lookupPlate, sanitizePlate, isValidPlate } from "@/lib/plate-lookup";
import { claimArchivedVehicleFn, inheritVehicleImageFn } from "@/lib/vehicles.functions";
import { toast } from "sonner";

type Step = "plate" | "loading" | "confirm";

type LookupData = {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  motorizacao: string;
  chassi?: string;
};

export type AddedVehicle = {
  id: string;
  placa: string;
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  km_atual: number | null;
  chassi: string;
  foto_url?: string | null;
};

function formatPlateMask(raw: string): string {
  const s = sanitizePlate(raw);
  // Mercosul (4º char é letra) → ABC1D23 (sem hífen). Antigo → ABC-1234.
  if (s.length <= 3) return s;
  if (s.length >= 5 && /[A-Z]/.test(s[4])) {
    return s; // mercosul, sem hífen
  }
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export function AddVehicleModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (v: AddedVehicle) => void;
}) {
  const [step, setStep] = useState<Step>("plate");
  const [plateRaw, setPlateRaw] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<LookupData>({
    marca: "",
    modelo: "",
    ano: "",
    cor: "",
    motorizacao: "",
    chassi: "",
  });
  const [km, setKm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("plate");
      setPlateRaw("");
      setNotFound(false);
      setData({ marca: "", modelo: "", ano: "", cor: "", motorizacao: "", chassi: "" });
      setKm("");
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const plate = sanitizePlate(plateRaw);
  const plateValid = isValidPlate(plate);

  const doLookup = async () => {
    if (!plateValid) {
      toast.error("Placa inválida. Use o formato ABC-1234 ou ABC1D23.");
      return;
    }
    setStep("loading");
    setNotFound(false);
    // 1) Antes de qualquer coisa, verifica se existe veículo arquivado com essa placa.
    // Se existir, faz o "claim" imediato (resgate) e encerra o fluxo.
    try {
      const res = await claimArchivedVehicleFn({ data: { placa: plate } });
      if (res.found) {
        toast.success("Histórico encontrado! Veículo resgatado para sua garagem.");
        onAdded({
          id: res.vehicle.id,
          placa: res.vehicle.placa,
          marca: res.vehicle.marca || "",
          modelo: res.vehicle.modelo || "",
          ano: res.vehicle.ano || "",
          cor: res.vehicle.cor || "",
          km_atual: res.vehicle.km_atual,
          chassi: res.vehicle.chassi || "",
        });
        onClose();
        return;
      }
    } catch (e) {
      console.error("[claimArchivedVehicleFn]", e);
      // segue o fluxo normal de cadastro
    }
    const r = await lookupPlate(plate);
    if (r) {
      setData({
        marca: r.marca || "",
        modelo: r.modelo || "",
        ano: r.ano || "",
        cor: r.cor || "",
        motorizacao: r.motorizacao || "",
        chassi: r.chassi || "",
      });
      setNotFound(false);
    } else {
      setNotFound(true);
    }
    setStep("confirm");
  };

  const confirmAdd = async () => {
    if (!data.marca.trim() || !data.modelo.trim()) {
      toast.error("Preencha ao menos marca e modelo.");
      return;
    }
    setSubmitting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) {
        toast.error("Sessão expirada. Faça login novamente.");
        return;
      }
      const km_atual = km ? Number(km.replace(/\D/g, "")) || null : null;
      const insertPayload = {
        user_id: userId,
        placa: plate,
        marca: data.marca.trim(),
        modelo: data.modelo.trim(),
        ano: data.ano.trim(),
        cor: data.cor.trim(),
        motorizacao: data.motorizacao.trim(),
        chassi: (data.chassi || "").trim(),
        km_atual,
      };
      const { data: inserted, error } = await supabase
        .from("veiculos")
        .insert(insertPayload)
        .select("id,placa,marca,modelo,ano,cor,km_atual,chassi")
        .single();
      if (error || !inserted) {
        toast.error("Não foi possível adicionar o veículo.");
        return;
      }
      toast.success("Veículo adicionado!");
      onAdded({
        id: inserted.id,
        placa: inserted.placa,
        marca: inserted.marca || "",
        modelo: inserted.modelo || "",
        ano: inserted.ano || "",
        cor: inserted.cor || "",
        km_atual: inserted.km_atual,
        chassi: inserted.chassi || "",
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center">
      <div
        className="glow-neon relative w-full max-w-md overflow-hidden rounded-t-3xl border border-primary/40 bg-card p-6 sm:rounded-3xl"
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

        <div className="relative">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
              <Car className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Garagem
              </p>
              <h2 className="font-tech text-lg font-bold tracking-wide text-primary">
                Adicionar Novo Veículo
              </h2>
            </div>
          </div>

          {step === "plate" && (
            <>
              <label className="block rounded-2xl border border-border bg-card px-4 py-3 focus-within:border-primary/60">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Placa do veículo
                </span>
                <input
                  autoFocus
                  value={formatPlateMask(plateRaw)}
                  onChange={(e) => setPlateRaw(e.target.value)}
                  placeholder="ABC-1234 ou ABC1D23"
                  inputMode="text"
                  autoCapitalize="characters"
                  className="font-tech mt-1 w-full bg-transparent text-2xl uppercase tracking-[0.25em] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                />
              </label>

              <button
                type="button"
                disabled={!plateValid}
                onClick={doLookup}
                className="glow-neon mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
                Buscar Veículo
              </button>

              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                Vamos consultar a base nacional para preencher os dados automaticamente.
              </p>
            </>
          )}

          {step === "loading" && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="font-tech text-xs uppercase tracking-widest text-muted-foreground">
                Buscando {plate} na base nacional...
              </p>
              <div className="mt-2 h-px w-40 overflow-hidden bg-[rgba(56,189,248,0.15)]">
                <div className="h-full w-1/3 animate-scan-line bg-[#38BDF8] shadow-[0_0_10px_#38BDF8]" />
              </div>
            </div>
          )}

          {step === "confirm" && (
            <>
              {!notFound ? (
                <div className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary">
                    <Check className="h-3.5 w-3.5" />
                    Veículo localizado
                  </div>
                  <p className="font-tech text-base font-bold text-foreground">
                    {data.marca} {data.modelo}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {data.ano} · {data.cor || "—"}
                    {data.motorizacao ? ` · ${data.motorizacao}` : ""}
                  </p>
                  <p className="font-tech mt-2 text-[11px] tracking-wider text-primary/80">
                    {plate}
                  </p>
                </div>
              ) : (
                <div className="mb-4 space-y-3">
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    Não localizamos a placa automaticamente. Preencha os dados manualmente.
                  </div>
                  <Field label="Marca" value={data.marca} onChange={(v) => setData((d) => ({ ...d, marca: v }))} placeholder="Ex.: Toyota" />
                  <Field label="Modelo" value={data.modelo} onChange={(v) => setData((d) => ({ ...d, modelo: v }))} placeholder="Ex.: Corolla XEi" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Ano" value={data.ano} onChange={(v) => setData((d) => ({ ...d, ano: v }))} placeholder="2022" />
                    <Field label="Cor" value={data.cor} onChange={(v) => setData((d) => ({ ...d, cor: v }))} placeholder="Preto" />
                  </div>
                </div>
              )}

              <label className="block rounded-2xl border border-border bg-card px-4 py-3">
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <Gauge className="h-3.5 w-3.5" />
                  Quilometragem atual{" "}
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

              <button
                type="button"
                disabled={submitting}
                onClick={confirmAdd}
                className="glow-neon mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Confirmar e Adicionar à Garagem
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
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
