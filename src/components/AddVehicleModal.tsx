import { useEffect, useState } from "react";
import { Loader2, Car, AlertCircle, Check, Search, X, Gauge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sanitizePlate, isValidPlate } from "@/lib/plate";
import {
  lookupPlacaFipe,
  consultarHistoricoFipe,
  type PlacaFipeOption,
} from "@/lib/placafipe";
import { claimArchivedVehicleFn, inheritVehicleImageFn } from "@/lib/vehicles.functions";
import { buildVehicleSignature, normalizeAnoModelo } from "@/lib/vehicle-signature";

function parseCilindradas(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || !/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

import { toast } from "sonner";

type Step = "plate" | "loading" | "confirm";

// Alias para manter o restante do componente legível sem refatorar tudo.
type FipeOption = PlacaFipeOption & { texto_modelo?: string };

type LookupData = {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  motorizacao: string;
  chassi?: string;
};

type FipeFromLookup = {
  codigo_fipe: string;
  valor: number;
  mes_referencia: string;
  desvalorizometro: string;
} | null;

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
  onLimitBlocked,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (v: AddedVehicle) => void;
  onLimitBlocked?: () => void;
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
  const [fipeLookup, setFipeLookup] = useState<FipeFromLookup>(null);
  const [fipeOptions, setFipeOptions] = useState<FipeOption[]>([]);
  const [showFipePicker, setShowFipePicker] = useState(false);
  const [fipeRetryAttempted, setFipeRetryAttempted] = useState(false);
  const [retryingFipe, setRetryingFipe] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("plate");
      setPlateRaw("");
      setNotFound(false);
      setData({ marca: "", modelo: "", ano: "", cor: "", motorizacao: "", chassi: "" });
      setKm("");
      setSubmitting(false);
      setFipeLookup(null);
      setFipeOptions([]);
      setShowFipePicker(false);
      setFipeRetryAttempted(false);
      setRetryingFipe(false);
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
          foto_url: res.vehicle.foto_url || null,
        });
        onClose();
        return;
      }
    } catch (e) {
      console.error("[claimArchivedVehicleFn]", e);
      // segue o fluxo normal de cadastro
    }
    const r = await lookupPlacaFipe(plate);
    if (r.ok && (r.fipe.length > 0 || r.informacoes_veiculo)) {
      const info = r.informacoes_veiculo || {};
      setData({
        marca: info.marca || "",
        modelo: info.modelo || "",
        ano: info.ano_modelo || info.ano || "",
        cor: info.cor || "",
        motorizacao: info.motor || info.combustivel || "",
        chassi: info.chassi || "",
      });
      const opts = r.fipe;
      // Mapeia para compat. com a UI existente (texto_modelo).
      const mapped: FipeOption[] = opts.map((o) => ({ ...o, texto_modelo: o.modelo }));
      setFipeOptions(mapped);
      // Desempate automático: 1 opção → seleciona em background.
      // 2+ opções → abre o modal "Selecione a Versão Fipe".
      if (opts.length <= 1) {
        const first = opts[0];
        setFipeLookup(
          first
            ? {
                codigo_fipe: first.codigo_fipe,
                valor: first.valor,
                mes_referencia: first.mes_referencia || "",
                desvalorizometro: first.desvalorizometro,
              }
            : null,
        );
        setShowFipePicker(false);
      } else {
        setFipeLookup(null);
        setShowFipePicker(true);
      }
      setNotFound(false);
    } else {
      setFipeLookup(null);
      setFipeOptions([]);
      setShowFipePicker(false);
      setNotFound(true);
    }
    setStep("confirm");
  };

  const pickFipeOption = (opt: FipeOption) => {
    setFipeLookup({
      codigo_fipe: opt.codigo_fipe,
      valor: opt.valor,
      mes_referencia: opt.mes_referencia || "",
      desvalorizometro: opt.desvalorizometro,
    });
    setShowFipePicker(false);
    setFipeRetryAttempted(false);
  };

  /**
   * Refaz lookup de FIPE. Retorna:
   *  - "single": preencheu fipeLookup com 1 opção
   *  - "multi":  abriu picker, precisa seleção do usuário
   *  - "none":   continua sem FIPE
   */
  const runFipeLookup = async (): Promise<"single" | "multi" | "none"> => {
    try {
      const r = await lookupPlacaFipe(plate);
      if (r.ok && r.fipe.length > 0) {
        const mapped: FipeOption[] = r.fipe.map((o) => ({ ...o, texto_modelo: o.modelo }));
        setFipeOptions(mapped);
        if (mapped.length === 1) {
          const first = mapped[0];
          setFipeLookup({
            codigo_fipe: first.codigo_fipe,
            valor: first.valor,
            mes_referencia: first.mes_referencia || "",
            desvalorizometro: first.desvalorizometro,
          });
          setShowFipePicker(false);
          setNotFound(false);
          // Se houver informacoes_veiculo e os campos estiverem vazios, preenche.
          const info = r.informacoes_veiculo || {};
          setData((d) => ({
            marca: d.marca || info.marca || "",
            modelo: d.modelo || info.modelo || "",
            ano: d.ano || info.ano_modelo || info.ano || "",
            cor: d.cor || info.cor || "",
            motorizacao: d.motorizacao || info.motor || info.combustivel || "",
            chassi: d.chassi || info.chassi || "",
          }));
          return "single";
        }
        setFipeLookup(null);
        setShowFipePicker(true);
        setNotFound(false);
        const info = r.informacoes_veiculo || {};
        setData((d) => ({
          marca: d.marca || info.marca || "",
          modelo: d.modelo || info.modelo || "",
          ano: d.ano || info.ano_modelo || info.ano || "",
          cor: d.cor || info.cor || "",
          motorizacao: d.motorizacao || info.motor || info.combustivel || "",
          chassi: d.chassi || info.chassi || "",
        }));
        return "multi";
      }
      return "none";
    } catch (e) {
      console.warn("[runFipeLookup]", e);
      return "none";
    }
  };

  const retryFipeLookup = async () => {
    if (!plateValid || retryingFipe) return;
    setRetryingFipe(true);
    try {
      const result = await runFipeLookup();
      if (result === "single") {
        toast.success("FIPE localizada!");
      } else if (result === "multi") {
        toast.info("Selecione a versão FIPE correta para continuar.");
      } else {
        toast.error(
          "Não conseguimos localizar a FIPE agora. Você pode tentar novamente ou cadastrar manualmente sem FIPE.",
        );
      }
    } finally {
      setRetryingFipe(false);
    }
  };




  const confirmAdd = async () => {
    if (!data.marca.trim() || !data.modelo.trim()) {
      toast.error("Preencha ao menos marca e modelo.");
      return;
    }
    if (showFipePicker && !fipeLookup) {
      toast.error("Selecione a versão FIPE correta para continuar.");
      return;
    }
    // Retry defensivo: se vamos salvar sem FIPE mas a placa é válida,
    // tenta uma vez antes de gravar sem FIPE. Se vier picker, aborta o submit.
    if (!fipeLookup && plateValid && !fipeRetryAttempted) {
      setSubmitting(true);
      const result = await runFipeLookup();
      setSubmitting(false);
      if (result === "multi") {
        toast.info("Selecione a versão FIPE correta para continuar.");
        return;
      }
      if (result === "single") {
        toast.success("FIPE localizada! Confirme novamente para salvar.");
        return;
      }
      // none → marca tentativa e mostra aviso; próximo clique salva manual.
      setFipeRetryAttempted(true);
      toast.error(
        "Não conseguimos localizar a FIPE agora. Você pode tentar novamente ou cadastrar manualmente sem FIPE.",
      );
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
      const codigoFipe = fipeLookup?.codigo_fipe?.trim() || null;
      const placafipeHash = fipeLookup?.desvalorizometro?.trim() || null;

      // Valor e mês de referência vêm diretamente da Placa FIPE.
      const fipeValor: number | null = fipeLookup?.valor || null;
      const fipeMesRef: string | null = fipeLookup?.mes_referencia || null;

      const insertPayload: Record<string, unknown> = {
        user_id: userId,
        placa: plate,
        marca: data.marca.trim(),
        modelo: data.modelo.trim(),
        ano: data.ano.trim(),
        cor: data.cor.trim(),
        motorizacao: data.motorizacao.trim(),
        chassi: (data.chassi || "").trim(),
        km_atual,
        // Patch G: novo cadastro nasce com Histórico Premium bloqueado.
        // Só destrava via pagamento R$49,90 (unlockHistoryFn) ou VIP.
        history_locked: true,
      };
      // Elimina envio de null para FIPE: só grava quando temos dado real.
      if (codigoFipe) insertPayload.codigo_fipe = codigoFipe;
      if (placafipeHash) insertPayload.placafipe_hash = placafipeHash;
      if (fipeValor && fipeValor > 0) insertPayload.fipe_valor = fipeValor;
      if (fipeMesRef) insertPayload.fipe_mes_referencia = fipeMesRef;
      if (codigoFipe) insertPayload.fipe_updated_at = new Date().toISOString();

      const { data: inserted, error } = await supabase
        .from("veiculos")
        .insert(insertPayload as never)
        .select("id,placa,marca,modelo,ano,cor,km_atual,chassi")
        .single();
      if (error || !inserted) {
        const code = (error as { code?: string } | null)?.code;
        const msg = (error as { message?: string } | null)?.message ?? "";
        if (
          onLimitBlocked &&
          (code === "23514" || msg.includes("CADASTRO_BLOQUEADO"))
        ) {
          onClose();
          onLimitBlocked();
          return;
        }
        toast.error("Não foi possível adicionar o veículo.");
        return;
      }
      // Tenta herdar foto já gerada anteriormente para a mesma placa
      // (qualquer dono passado), evitando uma nova chamada de IA.
      let inheritedFoto: string | null = null;
      try {
        const inh = await inheritVehicleImageFn({
          data: { vehicleId: inserted.id, placa: plate },
        });
        if (inh.inherited && inh.url) inheritedFoto = inh.url;
      } catch (e) {
        console.warn("[inheritVehicleImageFn]", e);
      }


      // Histórico completo via placafipe.com.br (desvalorizômetro).
      const hash = fipeLookup?.desvalorizometro?.trim() || "";
      if (hash) {
        try {
          const historico = await consultarHistoricoFipe(hash);
          if (historico.length > 0) {
            await supabase
              .from("veiculos")
              .update({ historico_fipe: historico as never } as never)
              .eq("id", inserted.id);
          }
        } catch (e) {
          console.warn("[consultarHistoricoFipe]", e);
        }
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
        foto_url: inheritedFoto,
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
                    Não conseguimos localizar a FIPE agora. Você pode tentar novamente ou cadastrar manualmente sem FIPE.
                  </div>
                  <button
                    type="button"
                    onClick={retryFipeLookup}
                    disabled={retryingFipe || !plateValid}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                  >
                    {retryingFipe ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Search className="h-3.5 w-3.5" />
                    )}
                    Tentar FIPE novamente
                  </button>

                  <Field label="Marca" value={data.marca} onChange={(v) => setData((d) => ({ ...d, marca: v }))} placeholder="Ex.: Toyota" />
                  <Field label="Modelo" value={data.modelo} onChange={(v) => setData((d) => ({ ...d, modelo: v }))} placeholder="Ex.: Corolla XEi" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Ano" value={data.ano} onChange={(v) => setData((d) => ({ ...d, ano: v }))} placeholder="2022" />
                    <Field label="Cor" value={data.cor} onChange={(v) => setData((d) => ({ ...d, cor: v }))} placeholder="Preto" />
                  </div>
                </div>
              )}

              {showFipePicker && fipeOptions.length > 1 && (
                <div className="mb-4 rounded-2xl border border-primary/40 bg-card p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                    Selecione a versão FIPE
                  </p>
                  <p className="mb-3 text-[11px] text-muted-foreground">
                    Encontramos mais de uma versão para esse veículo. Escolha a que corresponde ao seu:
                  </p>
                  <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
                    {fipeOptions.map((opt) => {
                      const selected = fipeLookup?.codigo_fipe === opt.codigo_fipe;
                      return (
                        <li key={opt.codigo_fipe}>
                          <button
                            type="button"
                            onClick={() => pickFipeOption(opt)}
                            className={`w-full rounded-xl border px-3 py-2 text-left transition-all ${
                              selected
                                ? "border-primary bg-primary/15 shadow-[0_0_0_1px_rgba(56,189,248,0.5)]"
                                : "border-border bg-background/40 hover:border-primary/50"
                            }`}
                          >
                            <p className="text-xs font-semibold text-foreground">
                              {opt.texto_modelo || "Versão"}
                            </p>
                            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                              <span className="font-tech tracking-wider text-primary/80">
                                FIPE {opt.codigo_fipe}
                                {opt.combustivel ? ` · ${opt.combustivel}` : ""}
                              </span>
                              {opt.valor > 0 && (
                                <span className="font-semibold text-foreground">
                                  R$ {opt.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                </span>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
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
                disabled={submitting || (showFipePicker && !fipeLookup)}
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
