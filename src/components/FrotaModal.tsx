import { Building2, Mail, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const EMAIL_FROTA = "contato@jarvys.com.br";

export function FrotaModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL_FROTA);
      toast.success("E-mail copiado!");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-left">Plano frotas</DialogTitle>
              <DialogDescription className="text-left">
                Acima de 5 veículos atendemos via plano corporativo.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-2xl border border-primary/40 bg-background/40 p-4 text-sm text-muted-foreground">
          <p>
            Para gerenciar uma frota com mais de 5 veículos no Jarvys, fale com o nosso time
            comercial. Montamos um plano sob medida com dashboards, multiusuário e suporte
            prioritário.
          </p>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
            <span className="flex items-center gap-2 text-foreground">
              <Mail className="h-4 w-4 text-primary" />
              {EMAIL_FROTA}
            </span>
            <button
              type="button"
              onClick={copyEmail}
              className="rounded-lg bg-primary/10 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/20"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mt-2 w-full text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Voltar para a garagem
        </button>
      </DialogContent>
    </Dialog>
  );
}
