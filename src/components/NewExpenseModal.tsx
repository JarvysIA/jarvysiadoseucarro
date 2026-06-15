import { useEffect, useState } from "react";
import { Loader2, Check, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  CATEGORIAS,
  CATEGORIA_COLOR,
  uploadReceiptImage,
  type Despesa,
  type DespesaCategoria,
} from "@/lib/despesas";
import { classifyExpenseTextFn } from "@/lib/classify-expense-text.functions";

async function classifyDescricao(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    const res = await classifyExpenseTextFn({ data: { text: trimmed } });
    return (res as { text?: string }).text || trimmed;
  } catch (e) {
    console.warn("[classifyDescricao] fallback", e);
    return trimmed;
  }
}

export type ExpensePrefill = {
  valor?: number;
  data?: string | null;
  km?: number | null;
  categoria?: DespesaCategoria;
  descricao?: string;
  /** Arquivo da nota lida pela IA — será anexado no submit. */
  file?: File | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  vehicleId: string | null;
  kmAtualVeiculo: number;
  defaultCategoria?: DespesaCategoria;
  /** Quando informado, o modal opera em modo EDIÇÃO da despesa existente. */
  editing?: Despesa | null;
  /** Pré-preenche os campos (ex.: vindo da IA leitora de nota). */
  prefill?: ExpensePrefill | null;
  onCreated?: () => void; // refetch trigger
  onUpdated?: () => void;
  onDeleted?: () => void;
  onVehicleKmUpdated?: (newKm: number) => void;
};

export function NewExpenseModal({
  open,
  onClose,
  vehicleId,
  kmAtualVeiculo,
  defaultCategoria = "Manutenção",
  editing = null,
  prefill = null,
  onCreated,
  onUpdated,
  onDeleted,
  onVehicleKmUpdated,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = Boolean(editing?.id);
  const [categoria, setCategoria] = useState<DespesaCategoria>(defaultCategoria);
  const [valor, setValor] = useState("");
  const [data, setData] = useState(today);
  const [km, setKm] = useState(String(kmAtualVeiculo || ""));
  const [descricao, setDescricao] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setCategoria(editing.categoria);
      setValor(String(editing.valor).replace(".", ","));
      setData(new Date(editing.data).toISOString().slice(0, 10));
      setKm(editing.km_registro != null ? String(editing.km_registro) : "");
      setDescricao(editing.descricao || "");
      setPendingFile(null);
    } else if (prefill) {
      setCategoria(prefill.categoria ?? defaultCategoria);
      setValor(prefill.valor != null ? prefill.valor.toFixed(2).replace(".", ",") : "");
      setData(prefill.data ?? today);
      setKm(prefill.km != null ? String(prefill.km) : String(kmAtualVeiculo || ""));
      setDescricao(prefill.descricao ?? "");
      setPendingFile(prefill.file ?? null);
    } else {
      setCategoria(defaultCategoria);
      setValor("");
      setData(today);
      setKm(String(kmAtualVeiculo || ""));
      setDescricao("");
      setPendingFile(null);
    }
    setSaving(false);
    setDeleting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, prefill]);

  const submit = async () => {
    if (!vehicleId && !isEdit) {
      toast.error("Selecione um veículo primeiro.");
      return;
    }
    const valorNum = parseFloat(valor.replace(",", "."));
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    const kmNum = km ? parseInt(km.replace(/\D/g, ""), 10) : null;
    if (km && (!Number.isFinite(kmNum!) || kmNum! < 0)) {
      toast.error("KM inválida.");
      return;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    if (data > todayStr) {
      toast.error("Você não pode registrar uma manutenção no futuro.");
      return;
    }
    if (data < todayStr && kmNum != null && kmNum > kmAtualVeiculo) {
      toast.error(
        "Inconsistência: Um registro com data antiga não pode ter uma quilometragem maior que a atual do painel.",
      );
      return;
    }
    setSaving(true);
    setSaving(true);
    try {
      const descricaoBase = descricao.trim() || categoria;
      const descricaoFinal = await classifyDescricao(descricaoBase);

      if (isEdit && editing) {
        const { error: upErr } = await supabase
          .from("despesas")
          .update({
            data: new Date(data).toISOString(),
            valor: valorNum,
            categoria,
            descricao: descricaoFinal,
            km_registro: kmNum,
          })
          .eq("id", editing.id);
        if (upErr) throw upErr;
        if (kmNum != null && kmNum > kmAtualVeiculo && editing.vehicle_id) {
          await supabase
            .from("veiculos")
            .update({ km_atual: kmNum })
            .eq("id", editing.vehicle_id);
          onVehicleKmUpdated?.(kmNum);
        }
        toast.success("Alterações salvas!");
        onUpdated?.();
        onClose();
        return;
      }

      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) throw new Error("Sessão expirada.");
      if (!vehicleId) throw new Error("Veículo não selecionado.");

      let receiptPath: string | null = null;
      if (pendingFile) {
        receiptPath = await uploadReceiptImage(userId, vehicleId, pendingFile);
      }

      const { error: insErr } = await supabase.from("despesas").insert({
        user_id: userId,
        vehicle_id: vehicleId,
        data: new Date(data).toISOString(),
        valor: valorNum,
        categoria,
        descricao: descricaoFinal,
        km_registro: kmNum,
        receipt_image_url: receiptPath,
      });
      if (insErr) throw insErr;

      if (kmNum != null && kmNum > kmAtualVeiculo) {
        await supabase.from("veiculos").update({ km_atual: kmNum }).eq("id", vehicleId);
        onVehicleKmUpdated?.(kmNum);
      }

      toast.success("Registro salvo!");
      onCreated?.();
      onClose();
    } catch (e) {
      console.error("[NewExpenseModal]", e);
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!confirm("Excluir este registro? Esta ação não pode ser desfeita.")) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("despesas").delete().eq("id", editing.id);
      if (error) throw error;
      toast.success("Registro excluído.");
      onDeleted?.();
      onClose();
    } catch (e) {
      console.error("[NewExpenseModal delete]", e);
      toast.error(e instanceof Error ? e.message : "Falha ao excluir.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <Sparkles className="h-4 w-4 text-primary" />
            {isEdit ? "Editar Registro" : "Novo Registro Manual"}
          </DialogTitle>
          <DialogDescription className="text-left">
            {isEdit
              ? "Atualize os dados ou exclua este lançamento."
              : "Adicione uma despesa diretamente — sem precisar de nota fiscal."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex flex-col gap-4">
          <Field label="Categoria">
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIAS.map((c) => {
                const active = categoria === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategoria(c)}
                    className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      borderColor: active ? CATEGORIA_COLOR[c] : "var(--border)",
                      color: active ? CATEGORIA_COLOR[c] : "var(--muted-foreground)",
                      backgroundColor: active
                        ? `color-mix(in oklab, ${CATEGORIA_COLOR[c]} 12%, transparent)`
                        : "transparent",
                      boxShadow: active ? `0 0 10px -3px ${CATEGORIA_COLOR[c]}` : "none",
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor (R$)">
              <input
                inputMode="decimal"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value.replace(/[^0-9.,]/g, ""))}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
              />
            </Field>
            <Field label="Data">
              <input
                type="date"
                max={today}
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
              />
            </Field>
          </div>

          <Field label="KM no momento do serviço">
            <input
              inputMode="numeric"
              placeholder={kmAtualVeiculo ? String(kmAtualVeiculo) : "Opcional"}
              value={km}
              onChange={(e) => setKm(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </Field>

          <Field label="Descrição">
            <input
              type="text"
              placeholder="Ex: Troca de óleo, IPVA 2026..."
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={140}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </Field>

          {isEdit && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving || deleting}
              className="flex items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-3 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/15 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {deleting ? "Excluindo..." : "Excluir Registro"}
            </button>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || deleting}
              className="flex-1 rounded-xl border border-border px-3 py-3 text-xs font-medium text-muted-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || deleting || (!vehicleId && !isEdit)}
              className="glow-neon flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "Salvando..." : isEdit ? "Salvar Alterações" : "Salvar Registro"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
