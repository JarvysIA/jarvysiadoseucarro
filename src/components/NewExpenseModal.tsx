import { useEffect, useState } from "react";
import { Loader2, Check, Sparkles } from "lucide-react";
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
  type DespesaCategoria,
} from "@/lib/despesas";

type Props = {
  open: boolean;
  onClose: () => void;
  vehicleId: string | null;
  kmAtualVeiculo: number;
  defaultCategoria?: DespesaCategoria;
  onCreated?: () => void; // refetch trigger
  onVehicleKmUpdated?: (newKm: number) => void;
};

export function NewExpenseModal({
  open,
  onClose,
  vehicleId,
  kmAtualVeiculo,
  defaultCategoria = "Manutenção",
  onCreated,
  onVehicleKmUpdated,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [categoria, setCategoria] = useState<DespesaCategoria>(defaultCategoria);
  const [valor, setValor] = useState("");
  const [data, setData] = useState(today);
  const [km, setKm] = useState(String(kmAtualVeiculo || ""));
  const [descricao, setDescricao] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCategoria(defaultCategoria);
      setValor("");
      setData(today);
      setKm(String(kmAtualVeiculo || ""));
      setDescricao("");
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (!vehicleId) {
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
    try {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) throw new Error("Sessão expirada.");

      const { error: insErr } = await supabase.from("despesas").insert({
        user_id: userId,
        vehicle_id: vehicleId,
        data: new Date(data).toISOString(),
        valor: valorNum,
        categoria,
        descricao: descricao.trim() || categoria,
        km_registro: kmNum,
        receipt_image_url: null,
      });
      if (insErr) throw insErr;

      // Atualiza KM do veículo se a informada for maior
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <Sparkles className="h-4 w-4 text-primary" />
            Novo Registro Manual
          </DialogTitle>
          <DialogDescription className="text-left">
            Adicione uma despesa diretamente — sem precisar de nota fiscal.
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

          <Field label="KM atual do veículo">
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

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-xl border border-border px-3 py-3 text-xs font-medium text-muted-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || !vehicleId}
              className="glow-neon flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "Salvando..." : "Salvar Registro"}
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
