import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  Sparkles,
  History,
  Gauge,
  Calendar,
  ScanLine,
  Camera,
  Loader2,
  Receipt,
  Check,
  X,
} from "lucide-react";
import {
  STATUS_LABEL_PT,
  formatRemainingKm,
  formatRemainingMonths,
  type MaintComputed,
} from "@/lib/maintenance";
import { parseReceiptFn, type ParsedReceipt, type ReceiptCategory, type DespesaCategoria } from "@/lib/parse-receipt.functions";
import { CATEGORIAS, CATEGORIA_COLOR } from "@/lib/despesas";
import { toast } from "sonner";

export type MaintExpense = {
  id: string;
  data_servico: string;
  valor_total: number;
  descricao: string;
};

export type MaintSaveInput = {
  data_servico: string; // ISO
  km_registrada: number;
  valor_total: number;
  descricao: string;
  categoria: DespesaCategoria;
  file: File | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  computed: MaintComputed | null;
  kmAtual: number;
  expenses?: MaintExpense[];
  onSave?: (update: MaintSaveInput) => void | Promise<void>;
};

type FlowState = "idle" | "scanning" | "confirm" | "error";

// Mapeia categoria da IA para nossa chave de manutenção
const CATEGORY_LABEL: Record<ReceiptCategory, string> = {
  oleo: "Óleo",
  filtros: "Filtros",
  pneus: "Pneus",
  freios: "Freios",
  bateria: "Bateria",
  outro: "Outro",
};

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const [, b64] = result.split(",");
      resolve({ base64: b64 || "", mimeType: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

export function MaintenancePanel({
  open,
  onClose,
  computed,
  kmAtual,
  expenses = [],
  onSave,
}: Props) {
  const [flow, setFlow] = useState<FlowState>("idle");
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset ao reabrir/trocar item
  useEffect(() => {
    if (!open) {
      setFlow("idle");
      setParsed(null);
      setScannedFile(null);
      setErrorMsg(null);
      setSaving(false);
    }
  }, [open, computed?.item.key]);

  const triggerUpload = () => inputRef.current?.click();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFlow("scanning");
    setErrorMsg(null);
    setScannedFile(file);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const res = await parseReceiptFn({ data: { imageBase64: base64, mimeType } });
      if (!res.ok) {
        setErrorMsg(res.error);
        setFlow("error");
        return;
      }
      setParsed(res.receipt);
      setFlow("confirm");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Erro ao analisar a nota.");
      setFlow("error");
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto rounded-t-3xl border-border bg-card p-0"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {computed && (
          <div className="flex flex-col gap-6 p-6">
            {/* Header sempre presente */}
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
                {flow === "scanning"
                  ? "Aguarde — Jarvys está lendo sua nota."
                  : flow === "confirm"
                  ? "Confirme os dados extraídos pela IA antes de salvar."
                  : "Histórico, próximas trocas e registros de despesas deste item."}
              </SheetDescription>
            </SheetHeader>

            {flow === "scanning" && <ScanningState />}

            {flow === "error" && (
              <ErrorState
                message={errorMsg ?? "Falha ao processar"}
                onRetry={triggerUpload}
                onCancel={() => setFlow("idle")}
              />
            )}

            {flow === "confirm" && parsed && (
              <ConfirmForm
                parsed={parsed}
                defaultKm={kmAtual}
                itemName={computed.item.nome}
                saving={saving}
                onCancel={() => {
                  setParsed(null);
                  setScannedFile(null);
                  setFlow("idle");
                }}
                onConfirm={async (payload) => {
                  setSaving(true);
                  try {
                    await onSave?.({ ...payload, file: scannedFile });
                    toast.success("Registro salvo! Semáforo atualizado.");
                    setParsed(null);
                    setScannedFile(null);
                    setFlow("idle");
                    onClose();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
                  } finally {
                    setSaving(false);
                  }
                }}
              />
            )}

            {flow === "idle" && (
              <>
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

                {/* Histórico */}
                {expenses.length === 0 ? (
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
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Histórico
                    </p>
                    {expenses.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <Receipt className="h-4 w-4 text-primary" />
                          <div>
                            <p className="text-xs font-medium text-foreground">
                              {e.descricao}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(e.data_servico).toLocaleDateString("pt-BR")}
                            </p>
                          </div>
                        </div>
                        <p className="text-sm font-semibold text-foreground">
                          R$ {e.valor_total.toFixed(2).replace(".", ",")}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* CTA IA */}
                <button
                  type="button"
                  onClick={triggerUpload}
                  className="glow-neon group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-5 py-5 text-base font-semibold text-primary-foreground shadow-lg transition-transform active:scale-[0.98]"
                >
                  <Sparkles className="h-5 w-5" />
                  Adicionar Registro com IA
                  <span className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-white/40" />
                </button>
                <p className="-mt-3 text-center text-[11px] text-muted-foreground">
                  Tire foto da nota fiscal ou orçamento — a IA preenche tudo automaticamente.
                </p>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ScanningState() {
  return (
    <div className="flex flex-col items-center justify-center gap-5 rounded-3xl border border-primary/30 bg-background/40 px-6 py-10 text-center">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
        <span className="absolute inset-2 animate-pulse rounded-full bg-primary/15" />
        <div
          className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          style={{ boxShadow: "0 0 30px -4px var(--primary)" }}
        >
          <ScanLine className="h-8 w-8 animate-pulse" />
        </div>
      </div>
      <div>
        <p className="text-base font-semibold text-foreground">
          Jarvys está analisando a nota da oficina... 🤖📄
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Identificando data, KM, valor e itens trocados.
        </p>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Pode levar alguns segundos
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  onCancel,
}: {
  message: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-center">
      <p className="text-sm font-semibold text-destructive">Não consegui ler a nota</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{message}</p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="flex-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
        >
          <Camera className="mr-1 inline h-3.5 w-3.5" />
          Tirar outra foto
        </button>
      </div>
    </div>
  );
}

function ConfirmForm({
  parsed,
  defaultKm,
  itemName,
  saving,
  onConfirm,
  onCancel,
}: {
  parsed: ParsedReceipt;
  defaultKm: number;
  itemName: string;
  saving: boolean;
  onConfirm: (p: Omit<MaintSaveInput, "file">) => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(parsed.data_servico || today);
  const [km, setKm] = useState(String(parsed.km_registrada ?? defaultKm));
  const [valor, setValor] = useState(parsed.valor_total.toFixed(2));
  const [itens, setItens] = useState(parsed.itens_identificados);
  const [categoria, setCategoria] = useState<DespesaCategoria>(parsed.categoria);

  const submit = () => {
    const kmNum = parseInt(km.replace(/\D/g, ""), 10);
    const valorNum = parseFloat(valor.replace(",", "."));
    if (!Number.isFinite(kmNum) || kmNum < 0) {
      toast.error("KM inválida");
      return;
    }
    if (!Number.isFinite(valorNum) || valorNum < 0) {
      toast.error("Valor inválido");
      return;
    }
    const descricao =
      itens.length > 0
        ? itens.map((i) => i.descricao).slice(0, 2).join(" + ")
        : `Serviço — ${itemName}`;
    onConfirm({
      data_servico: new Date(data).toISOString(),
      km_registrada: kmNum,
      valor_total: valorNum,
      descricao,
      categoria,
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-primary/30 bg-background/40 p-5">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        Dados extraídos pela IA — revise e confirme
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Data do serviço">
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </Field>
        <Field label="KM registrada">
          <input
            inputMode="numeric"
            value={km}
            onChange={(e) => setKm(e.target.value.replace(/\D/g, ""))}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </Field>
      </div>

      <Field label="Valor total (R$)">
        <input
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value.replace(/[^0-9.,]/g, ""))}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
        />
      </Field>

      {itens.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Itens identificados
          </p>
          <div className="flex flex-col gap-1.5">
            {itens.map((it, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-border bg-card/60 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {it.descricao}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {CATEGORY_LABEL[it.categoria]}
                  </p>
                </div>
                <span className="text-xs font-semibold text-foreground">
                  R$ {it.valor.toFixed(2).replace(".", ",")}
                </span>
                <button
                  type="button"
                  aria-label="Remover item"
                  onClick={() => setItens((arr) => arr.filter((_, i) => i !== idx))}
                  className="ml-2 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-border px-3 py-3 text-xs font-medium text-muted-foreground"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          className="glow-neon flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-3 text-sm font-semibold text-primary-foreground"
        >
          <Check className="h-4 w-4" />
          Confirmar e Salvar Registro
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
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
