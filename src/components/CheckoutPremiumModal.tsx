import { useEffect, useState } from "react";
import { Copy, Loader2, Lock, QrCode, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

const VALOR_HISTORICO = 49.9;

/**
 * Modal de checkout do "Porta-Luvas Digital" — R$ 49,90 via PIX (Asaas).
 * Cartão temporariamente desabilitado (operação 100% PIX para evitar chargebacks).
 * Quando o pagamento é confirmado pela Edge Function `verificar-pagamentos-asaas`,
 * o `history_locked` do veículo é setado para `false` automaticamente.
 */
export function CheckoutPremiumModal({
  open,
  onOpenChange,
  vehicleId,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vehicleId: string;
  onUnlocked: () => void;
}) {
  const [pixCopiaCola, setPixCopiaCola] = useState("");
  const [pagamentoId, setPagamentoId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusPoll, setStatusPoll] = useState<"aguardando" | "pago" | null>(null);

  // Reset ao fechar
  useEffect(() => {
    if (!open) {
      setPixCopiaCola("");
      setPagamentoId(null);
      setStatusPoll(null);
      setIsLoading(false);
    }
  }, [open]);

  // Polling do status enquanto aguardando
  useEffect(() => {
    if (!pagamentoId || statusPoll === "pago") return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("pagamentos_pix")
        .select("status")
        .eq("id", pagamentoId)
        .maybeSingle();
      if (data?.status === "pago") {
        setStatusPoll("pago");
        toast.success("Pagamento confirmado! Histórico liberado.");
        onOpenChange(false);
        onUnlocked();
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [pagamentoId, statusPoll, onOpenChange, onUnlocked]);

  const gerarPix = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getUser();
      const userId = sessionData.user?.id;
      if (!userId) {
        toast.error("Sessão expirada. Faça login novamente.");
        return;
      }

      const { data, error } = await supabase.functions.invoke("gerar-pix-asaas", {
        body: {
          user_id: userId,
          veiculo_id: vehicleId,
          valor: VALOR_HISTORICO,
          tipo_produto: "historico",
          produto_ref_id: vehicleId,
        },
      });

      if (error) throw error;
      if (!data?.pix_copia_cola) throw new Error("Resposta inválida do gateway");

      setPixCopiaCola(data.pix_copia_cola);
      setPagamentoId(data.id ?? null);
      setStatusPoll("aguardando");
      toast.success("PIX gerado! Copie o código abaixo.");
    } catch (e) {
      console.error("[checkout historico pix]", e);
      toast.error(e instanceof Error ? e.message : "Erro ao gerar PIX.");
    } finally {
      setIsLoading(false);
    }
  };

  const copyPix = async () => {
    try {
      await navigator.clipboard.writeText(pixCopiaCola);
      toast.success("Código PIX copiado!");
    } catch {
      toast.error("Não foi possível copiar. Selecione manualmente.");
    }
  };

  const handlePrimary = () => {
    if (pixCopiaCola) copyPix();
    else gerarPix();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !isLoading && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-left">Porta-Luvas Digital</DialogTitle>
              <DialogDescription className="text-left">
                Liberação vitalícia do histórico oculto deste veículo.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Resumo */}
        <div
          className="relative overflow-hidden rounded-2xl border border-primary/40 bg-background/40 p-4"
          style={{ boxShadow: "0 0 0 1px rgba(56,189,248,0.18)" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -top-12 -right-10 h-32 w-32 rounded-full"
            style={{
              background: "radial-gradient(closest-side, rgba(56,189,248,0.22), transparent 70%)",
            }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Resumo do pedido
          </p>
          <p className="mt-2 text-sm text-foreground">
            Você está adquirindo o <strong>Porta-Luvas Digital</strong> deste veículo.
          </p>
          <ul className="mt-3 space-y-1 text-[12px] text-muted-foreground">
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Histórico completo de revisões e despesas anteriores
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Acesso vitalício enquanto o veículo for seu
            </li>
          </ul>
          <div className="mt-4 flex items-end justify-between border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-2xl font-bold text-foreground">
              R$ 49<span className="text-base">,90</span>
            </span>
          </div>
        </div>

        {/* Forma de pagamento — apenas PIX nesta versão */}
        <div className="mt-1">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Forma de pagamento
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-primary/60 bg-primary/10 px-3 py-2.5">
            <QrCode className="h-4 w-4 text-primary" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">Pix</span>
              <span className="text-[10px] text-muted-foreground">
                Aprovação automática em até 10 minutos
              </span>
            </div>
          </div>
        </div>

        {pixCopiaCola && (
          <div
            className="mt-2 rounded-2xl border border-primary/30 bg-background/40 p-4"
            style={{ boxShadow: "0 0 0 1px rgba(56,189,248,0.15)" }}
          >
            <div className="flex flex-col items-center">
              <div className="flex h-28 w-28 items-center justify-center rounded-xl bg-secondary/40">
                <QrCode className="h-14 w-14 text-primary/70" />
              </div>
              <p className="mt-3 max-w-full truncate text-[10px] text-muted-foreground">
                {pixCopiaCola.slice(0, 40)}…
              </p>
              {statusPoll === "aguardando" && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Aguardando confirmação do pagamento…
                </p>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handlePrimary}
          disabled={isLoading}
          className="glow-neon mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Gerando PIX…
            </>
          ) : pixCopiaCola ? (
            <>
              <Copy className="h-4 w-4" />
              Copiar Código PIX
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" />
              Gerar Pagamento PIX · R$ 49,90
            </>
          )}
        </button>

        <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
          Liberação do acesso em até 10 minutos.
          <br />
          Código válido para pagamento em até 60 minutos.
        </p>
      </DialogContent>
    </Dialog>
  );
}
