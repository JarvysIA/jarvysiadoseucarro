import { useEffect, useState } from "react";
import { Copy, Loader2, QrCode, Sparkles, Car } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

const VALOR_MENSALIDADE = 9.9;

/**
 * Cobrança mensal (R$ 9,90) para adicionar um veículo extra a uma conta já ativa.
 * Gera PIX via Asaas, polla o status e libera o cadastro quando pago.
 */
export function MensalidadeVeiculoModal({
  open,
  onOpenChange,
  onPaid,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPaid: () => void;
}) {
  const [qrCode, setQrCode] = useState("");
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pagamentoId, setPagamentoId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<"aguardando" | "pago" | null>(null);

  useEffect(() => {
    if (!open) {
      setQrCode("");
      setQrBase64(null);
      setPagamentoId(null);
      setStatus(null);
      setIsLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!pagamentoId || status === "pago") return;
    const t = setInterval(async () => {
      const { data } = await supabase
        .from("pagamentos_pix")
        .select("status")
        .eq("id", pagamentoId)
        .maybeSingle();
      if (data?.status === "pago") {
        setStatus("pago");
        toast.success("Pagamento confirmado! Você já pode cadastrar o veículo.");
        onOpenChange(false);
        onPaid();
      }
    }, 8000);
    return () => clearInterval(t);
  }, [pagamentoId, status, onOpenChange, onPaid]);

  const gerarPix = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const { data: sess } = await supabase.auth.getUser();
      const uid = sess.user?.id;
      if (!uid) {
        toast.error("Sessão expirada.");
        return;
      }
      const { data, error } = await supabase.functions.invoke("gerar-pix-mp", {
        body: {
          user_id: uid,
          veiculo_id: null,
          valor: VALOR_MENSALIDADE,
          tipo_produto: "mensalidade_carro",
          descricao: "Jarvys — Mensalidade veículo adicional",
        },
      });
      if (error) throw error;
      if (!data?.qr_code) throw new Error("Resposta inválida do Mercado Pago");
      setQrCode(data.qr_code);
      setPagamentoId(data.pagamento_id ?? null);
      setStatus("aguardando");
      toast.success("PIX gerado!");
    } catch (e) {
      console.error("[mensalidade pix]", e);
      toast.error(e instanceof Error ? e.message : "Erro ao gerar PIX.");
    } finally {
      setIsLoading(false);
    }
  };

  const copyPix = async () => {
    try {
      await navigator.clipboard.writeText(qrCode);
      toast.success("Código PIX copiado!");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !isLoading && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Car className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-left">Veículo adicional</DialogTitle>
              <DialogDescription className="text-left">
                Cada veículo extra na sua garagem custa R$ 9,90/mês.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-2xl border border-primary/40 bg-background/40 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Resumo
          </p>
          <ul className="mt-2 space-y-1 text-[12px] text-muted-foreground">
            <li className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Acesso completo à IA para mais um veículo
            </li>
            <li className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Renovação automática a cada 30 dias
            </li>
          </ul>
          <div className="mt-3 flex items-end justify-between border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">Total mensal</span>
            <span className="text-2xl font-bold text-foreground">
              R$ 9<span className="text-base">,90</span>
            </span>
          </div>
        </div>

        {qrCode && (
          <div className="rounded-2xl border border-primary/30 bg-background/40 p-4">
            <div className="flex flex-col items-center">
              <div className="flex h-28 w-28 items-center justify-center rounded-xl bg-secondary/40">
                <QrCode className="h-14 w-14 text-primary/70" />
              </div>
              <p className="mt-3 max-w-full truncate text-[10px] text-muted-foreground">
                {qrCode.slice(0, 40)}…
              </p>
              {status === "aguardando" && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Aguardando confirmação…
                </p>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={qrCode ? copyPix : gerarPix}
          disabled={isLoading}
          className="glow-neon mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Gerando PIX…
            </>
          ) : qrCode ? (
            <>
              <Copy className="h-4 w-4" />
              Copiar Código PIX
            </>
          ) : (
            <>
              <QrCode className="h-4 w-4" />
              Gerar PIX · R$ 9,90/mês
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={isLoading}
          className="mt-1 w-full text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Voltar para a garagem
        </button>
      </DialogContent>
    </Dialog>
  );
}
