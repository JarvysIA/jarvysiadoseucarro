import { useState } from "react";
import {
  X,
  Check,
  QrCode,
  Copy,
  Sparkles,
  Car,
  Wrench,
  TrendingUp,
  ShieldCheck,
  MessageCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveReferrerId } from "@/lib/referral";
import { CpfRequiredModal } from "@/components/CpfRequiredModal";
import { PixQrCode } from "@/components/PixQrCode";

export function PaywallModal({
  open,
  onClose,
  vehicleId,
}: {
  open: boolean;
  onClose: () => void;
  vehicleId?: string;
}) {
  const [price, setPrice] = useState(29.9);
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);

  const [pixCopiaCola, setPixCopiaCola] = useState("");
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [txid, setTxid] = useState("");
  const [isLoadingPix, setIsLoadingPix] = useState(false);
  const [cpfModalOpen, setCpfModalOpen] = useState(false);

  const applyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) return;
    setIsValidatingCoupon(true);
    try {
      const padrinhoId = await resolveReferrerId(code);
      if (!padrinhoId) {
        toast.error("Cupom inválido");
        setCouponApplied(false);
        setPrice(29.9);
        return;
      }
      setPrice(19.9);
      setCouponApplied(true);
      toast.success("Cupom aplicado!");
    } catch (e) {
      console.error("[applyCoupon]", e);
      toast.error("Não foi possível validar o cupom.");
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  const handleClose = () => {
    // Reset PIX state ao fechar para permitir nova geração na próxima abertura
    setPixCopiaCola("");
    setTxid("");
    setIsLoadingPix(false);
    onClose();
  };

  const gerarPix = async () => {
    if (isLoadingPix) return;

    if (!vehicleId) {
      toast.error("Selecione um veículo antes de gerar o PIX.");
      return;
    }

    setIsLoadingPix(true);
    try {
      const { data: sessionData } = await supabase.auth.getUser();
      const userId = sessionData.user?.id;
      if (!userId) {
        toast.error("Sessão expirada. Faça login novamente.");
        setIsLoadingPix(false);
        return;
      }

      // Pré-checagem: CPF obrigatório (regra do Banco Central / Asaas)
      const { data: prof } = await supabase
        .from("profiles")
        .select("cpf")
        .eq("id", userId)
        .maybeSingle();
      const cpfDigits = (prof?.cpf ?? "").toString().replace(/\D/g, "");
      if (cpfDigits.length !== 11) {
        setIsLoadingPix(false);
        setCpfModalOpen(true);
        return;
      }

      const { data, error } = await supabase.functions.invoke("gerar-pix-asaas", {
        body: {
          user_id: userId,
          veiculo_id: vehicleId,
          valor: price,
          codigo_cupom: couponApplied ? couponCode.trim() : null,
        },
      });

      if (error) throw error;
      if (data?.error === "CPF_REQUIRED") {
        setIsLoadingPix(false);
        setCpfModalOpen(true);
        return;
      }
      if (!data?.pix_copia_cola) throw new Error("Resposta inválida do gateway");

      setPixCopiaCola(data.pix_copia_cola);
      setTxid(data.txid_efi ?? "");
      toast.success("PIX gerado! Copie o código abaixo.");
    } catch (e) {
      console.error("[gerar-pix-asaas]", e);
      toast.error("Erro ao gerar PIX. Verifique sua conexão e tente novamente.");
      setPixCopiaCola("");
      setTxid("");
    } finally {
      setIsLoadingPix(false);
    }
  };

  const copyPix = async () => {
    try {
      await navigator.clipboard.writeText(pixCopiaCola);
      toast.success("Código PIX copiado!");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  };

  const handlePrimaryClick = () => {
    if (pixCopiaCola) copyPix();
    else gerarPix();
  };

  if (!open) return null;

  const benefits = [
    { icon: <Car className="h-4 w-4" />, text: "Garagem inteligente com status de saúde" },
    { icon: <Wrench className="h-4 w-4" />, text: "Timeline das revisões" },
    { icon: <TrendingUp className="h-4 w-4" />, text: "Histórico FIPE" },
    { icon: <ShieldCheck className="h-4 w-4" />, text: "Certificado Jarvys para Revenda" },
    { icon: <MessageCircle className="h-4 w-4" />, text: "Dr. Jarvys no WhatsApp" },
  ];

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center">
      <div
        className="relative w-full max-w-md overflow-hidden rounded-t-3xl border border-primary/40 bg-card p-6 sm:rounded-3xl"
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
          onClick={handleClose}
          aria-label="Fechar"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-7 w-7" />
          </div>
          <h2 className="font-tech text-lg font-bold tracking-wide text-primary">
            Ativar minha IA automotiva
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Licença única por veículo</p>
        </div>

        <ul className="mt-6 space-y-3">
          {benefits.map((b, i) => (
            <li key={i} className="flex items-center gap-3 text-sm text-foreground">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-status-ok/15 text-status-ok">
                <Check className="h-3 w-3" />
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                {b.icon}
                {b.text}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-3">
            {couponApplied && (
              <span className="text-lg text-muted-foreground line-through">R$ 29,90</span>
            )}
            <span className="text-3xl font-bold text-foreground">
              R$ {price.toFixed(2).replace(".", ",")}
            </span>
          </div>
          {couponApplied && (
            <p className="mt-1 text-xs font-semibold text-status-ok">Cupom aplicado!</p>
          )}

          {!couponApplied && !pixCopiaCola && (
            <div className="mt-4">
              {!showCouponInput ? (
                <button
                  type="button"
                  onClick={() => setShowCouponInput(true)}
                  className="text-xs text-muted-foreground underline decoration-primary/40 underline-offset-2 hover:text-primary"
                >
                  Tenho um cupom de indicação
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    placeholder="Cupom de indicação"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyCoupon();
                    }}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={applyCoupon}
                    disabled={!couponCode.trim() || isValidatingCoupon}
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {isValidatingCoupon ? "Validando…" : "Aplicar"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className="mt-6 rounded-2xl border border-primary/30 bg-background/40 p-5"
          style={{ boxShadow: "0 0 0 1px rgba(56,189,248,0.15)" }}
        >
          <div className="flex flex-col items-center">
            {pixCopiaCola && (
              <>
                <div className="flex h-32 w-32 items-center justify-center rounded-xl bg-secondary/40">
                  <QrCode className="h-16 w-16 text-primary/70" />
                </div>
                <p className="mt-3 max-w-full truncate text-[10px] text-muted-foreground">
                  {pixCopiaCola.slice(0, 40)}…
                </p>
              </>
            )}

            <button
              type="button"
              onClick={handlePrimaryClick}
              disabled={isLoadingPix}
              className="glow-neon mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {isLoadingPix ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Gerando PIX...
                </>
              ) : pixCopiaCola ? (
                <>
                  <Copy className="h-4 w-4" />
                  Copiar Código PIX
                </>
              ) : (
                <>
                  <QrCode className="h-4 w-4" />
                  Gerar Pagamento PIX
                </>
              )}
            </button>
            <p className="mt-2 text-center text-[10px] leading-relaxed text-muted-foreground">
              Liberação do acesso em até 10 minutos.
              <br />
              Código válido para pagamento em até 60 minutos.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClose}
          className="mt-4 w-full text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Voltar para a garagem
        </button>
      </div>
    </div>
    <CpfRequiredModal
      open={cpfModalOpen}
      onOpenChange={setCpfModalOpen}
      onConfirmed={() => {
        setCpfModalOpen(false);
        void gerarPix();
      }}
    />
    </>
  );
}
