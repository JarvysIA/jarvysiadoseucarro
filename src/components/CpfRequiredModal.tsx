import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { isValidCpf, maskCpf, onlyDigits } from "@/lib/cpf";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirmed: (cpfDigits: string) => void;
};

export function CpfRequiredModal({ open, onOpenChange, onConfirmed }: Props) {
  const [cpf, setCpf] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setCpf("");
      setSaving(false);
    }
  }, [open]);

  const valid = isValidCpf(cpf);

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const { data: sess } = await supabase.auth.getUser();
      const userId = sess.user?.id;
      if (!userId) {
        toast.error("Sessão expirada. Faça login novamente.");
        return;
      }
      const digits = onlyDigits(cpf);
      const { error } = await supabase
        .from("profiles")
        .update({ cpf: digits })
        .eq("id", userId);
      if (error) throw error;
      toast.success("CPF salvo!");
      onConfirmed(digits);
      onOpenChange(false);
    } catch (e) {
      console.error("[CpfRequiredModal]", e);
      toast.error(e instanceof Error ? e.message : "Falha ao salvar CPF.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="border-border bg-card sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Informe seu CPF
          </DialogTitle>
          <DialogDescription className="text-left">
            Para gerar o PIX, o Banco Central exige o CPF do pagador. Ele será
            salvo no seu perfil e usado apenas para emissão da cobrança.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              CPF
            </span>
            <input
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(maskCpf(e.target.value))}
              className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm outline-none focus:border-primary"
            />
            {cpf.length > 0 && !valid && (
              <span className="mt-1 text-[10px] text-destructive">
                CPF inválido.
              </span>
            )}
          </label>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="flex-1 rounded-xl border border-border px-3 py-3 text-xs font-medium text-muted-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!valid || saving}
              className="glow-neon flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Salvar e continuar"
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
