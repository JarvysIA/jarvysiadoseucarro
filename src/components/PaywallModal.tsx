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
} from "lucide-react";
import { toast } from "sonner";

export function PaywallModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [price, setPrice] = useState(29.9);
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [showCouponInput, setShowCouponInput] = useState(false);

  const applyCoupon = () => {
    if (couponCode.trim().length > 0) {
      setPrice(19.9);
      setCouponApplied(true);
    }
  };

  const copyPix = () => {
    toast.success("Código copiado!");
  };

  if (!open) return null;

  const benefits = [
    {
      icon: <Car className="h-4 w-4" />,
      text: "Garagem inteligente com status de saúde",
    },
    {
      icon: <Wrench className="h-4 w-4" />,
      text: "Timeline das revisões",
    },
    {
      icon: <TrendingUp className="h-4 w-4" />,
      text: "Histórico FIPE",
    },
    {
      icon: <ShieldCheck className="h-4 w-4" />,
      text: "Certificado Jarvys para Revenda",
    },
    {
      icon: <MessageCircle className="h-4 w-4" />,
      text: "Dr. Jarvys no WhatsApp",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center">
      <div
        className="relative w-full max-w-md overflow-hidden rounded-t-3xl border border-primary/40 bg-card p-6 sm:rounded-3xl"
        style={{
          boxShadow:
            "0 0 0 1px rgba(56,189,248,0.25), 0 20px 60px -10px rgba(56,189,248,0.35)",
        }}
      >
        {/* Ambient glow */}
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(56,189,248,0.25), transparent 70%)",
          }}
        />

        {/* Close */}
        <button
          onClick={onClose}
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
          <p className="mt-1 text-sm text-muted-foreground">
            Licença única por veículo
          </p>
        </div>

        {/* Benefits */}
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

        {/* Price & Coupon */}
        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-3">
            {couponApplied && (
              <span className="text-lg text-muted-foreground line-through">
                R$ 29,90
              </span>
            )}
            <span className="text-3xl font-bold text-foreground">
              R$ {price.toFixed(2).replace(".", ",")}
            </span>
          </div>
          {couponApplied && (
            <p className="mt-1 text-xs font-semibold text-status-ok">
              Cupom aplicado!
            </p>
          )}

          {!couponApplied && (
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
                    disabled={!couponCode.trim()}
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Aplicar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* PIX Container */}
        <div
          className="mt-6 rounded-2xl border border-primary/30 bg-background/40 p-5"
          style={{
            boxShadow: "0 0 0 1px rgba(56,189,248,0.15)",
          }}
        >
          <div className="flex flex-col items-center">
            <div className="flex h-32 w-32 items-center justify-center rounded-xl bg-secondary/40">
              <QrCode className="h-16 w-16 text-primary/40" />
            </div>
            <button
              type="button"
              onClick={copyPix}
              className="glow-neon mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              <Copy className="h-4 w-4" />
              Copiar Código PIX
            </button>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Pagamento processado via Efí Bank. Liberação imediata.
            </p>
          </div>
        </div>

        {/* Back */}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Voltar para a garagem
        </button>
      </div>
    </div>
  );
}
