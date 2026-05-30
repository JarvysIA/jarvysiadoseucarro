import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { captureRefFromUrl } from "@/lib/referral";
import {
  Bot,
  BarChart3,
  TrendingDown,
  Gift,
  Users,
  Sparkles,
  ArrowRight,
  Copy,
  Check,
  X,
  ShieldCheck,
} from "lucide-react";
import logo from "@/assets/jarvys-logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Jarvys — Ative sua Garagem por R$ 9,90" },
      {
        name: "description",
        content:
          "Oferta exclusiva por indicação: ative o Jarvys, a 1ª IA automotiva, por R$ 9,90 vitalício. Indique amigos e ganhe R$ 5 no Pix.",
      },
    ],
  }),
  component: LandingPage,
});

const PIX_CODE =
  "00020126580014BR.GOV.BCB.PIX0136jarvys-pix-indicacao-9b0c-4c2f5204000053039865802BR5913JARVYS PAY6009SAO PAULO62290525JARVYSGARAGEM9REAIS90LOOP6304A1B2";

function LandingPage() {
  const [openPix, setOpenPix] = useState(false);
  useEffect(() => {
    captureRefFromUrl();
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Background ambient */}
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-20" />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--neon) 28%, transparent), transparent 70%)",
        }}
      />

      <main className="relative z-10 mx-auto flex max-w-md flex-col px-5 pt-8 pb-[calc(env(safe-area-inset-bottom)+9rem)]">
        {/* Top bar */}
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Jarvys" className="h-9 w-9 drop-shadow-[0_0_12px_rgba(56,189,248,0.55)]" />
            <span className="font-tech text-[13px] font-bold text-foreground">JARVYS</span>
          </div>
          <Link
            to="/welcome"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Entrar
          </Link>
        </header>

        {/* HERO */}
        <section className="text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Oferta por indicação
          </div>

          <h1 className="text-balance text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
            Parabéns, você foi indicado e ganhou{" "}
            <span className="text-primary text-glow">uma super oferta!</span>
          </h1>

          <p className="mx-auto mt-4 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            Ative sua Garagem por apenas{" "}
            <span className="font-semibold text-foreground">R$ 9,90</span> e
            tenha acesso ao <span className="text-primary font-semibold">Jarvys</span>, a 1ª IA
            automotiva que te ajuda a cuidar do seu carro.
          </p>

          <button
            onClick={() => setOpenPix(true)}
            className="glow-neon mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            Ativar minha Garagem via Pix
            <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Pagamento único · Acesso vitalício
          </p>
        </section>

        {/* DISCOUNT CARD */}
        <section className="mt-10">
          <div className="relative overflow-hidden rounded-2xl border border-primary/40 bg-card p-5 shadow-[0_10px_40px_-15px_rgba(56,189,248,0.5)]">
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in oklab, var(--neon) 12%, transparent), transparent 60%)",
              }}
            />
            <div className="relative">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-primary">
                <Gift className="h-4 w-4" />
                Você economiza R$ 5,00
              </div>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-muted-foreground text-sm line-through">R$ 14,90</span>
                <span className="text-3xl font-extrabold text-foreground">R$ 9,90</span>
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  vitalício
                </span>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                O preço padrão nas lojas de aplicativos é{" "}
                <span className="text-foreground">R$ 14,90</span>. Como você foi indicado, paga
                apenas <span className="text-primary font-semibold">R$ 9,90</span> — uma única vez.
              </p>
            </div>
          </div>
        </section>

        {/* MOTOR DE GANHO */}
        <section className="mt-12">
          <h2 className="font-tech text-center text-xs font-bold uppercase text-primary">
            O Motor de Ganho
          </h2>
          <p className="mt-2 text-center text-xl font-bold tracking-tight text-foreground">
            Recupere seu investimento rápido
          </p>

          <div className="mt-5 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[14px] leading-relaxed text-foreground">
                  Ganhe <span className="text-primary font-semibold">R$ 5,00</span> na hora via Pix
                  por cada amigo que você indicar e se cadastrar!
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-1.5 text-center">
              <LoopStep n="1+" label="Reduz custo" />
              <LoopStep n="2" label="App de graça" highlight />
              <LoopStep n="3+" label="Você lucra" />
            </div>
          </div>
        </section>

        {/* BENEFÍCIOS */}
        <section className="mt-12">
          <h2 className="font-tech text-center text-xs font-bold uppercase text-primary">
            O que você ganha
          </h2>
          <p className="mt-2 text-center text-xl font-bold tracking-tight text-foreground">
            Inteligência automotiva no seu bolso
          </p>

          <div className="mt-5 space-y-3">
            <Benefit
              icon={<Bot className="h-5 w-5" />}
              title="Dr. Jarvys no WhatsApp"
              desc="Alertas proativos e suporte técnico sobre o seu carro direto no Whats."
            />
            <Benefit
              icon={<BarChart3 className="h-5 w-5" />}
              title="Histórico e Tabela FIPE"
              desc="Controle total de gastos, abastecimentos e valorização do veículo."
            />
            <Benefit
              icon={<TrendingDown className="h-5 w-5" />}
              title="Previsibilidade"
              desc="Saiba exatamente o desgaste das suas peças e faça a troca antes de quebrarem."
            />
          </div>
        </section>

        {/* CTA FINAL */}
        <section className="mt-12">
          <div className="rounded-2xl border border-primary/40 bg-card p-5 text-center">
            <p className="text-[13px] uppercase tracking-widest text-muted-foreground">
              Pronto para começar?
            </p>
            <p className="mt-2 text-lg font-bold text-foreground">
              R$ 9,90 vitalício · zero mensalidade
            </p>
            <button
              onClick={() => setOpenPix(true)}
              className="glow-neon mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              Ativar minha Garagem via Pix
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>

        <footer className="mt-10 text-center text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} Jarvys · A IA do seu carro
        </footer>
      </main>

      {openPix && <PixModal onClose={() => setOpenPix(false)} />}
    </div>
  );
}

function LoopStep({ n, label, highlight }: { n: string; label: string; highlight?: boolean }) {
  return (
    <div
      className={`min-w-0 rounded-xl border px-1.5 py-3 ${
        highlight
          ? "border-primary/60 bg-primary/10"
          : "border-border bg-background/40"
      }`}
    >
      <div
        className={`font-tech text-lg font-extrabold leading-none ${
          highlight ? "text-primary text-glow" : "text-foreground"
        }`}
      >
        {n}
      </div>
      <div className="mt-1.5 text-[9px] leading-tight uppercase tracking-wider text-muted-foreground break-words">
        {label}
      </div>
    </div>
  );
}

function Benefit({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function PixModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(PIX_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md rounded-t-3xl border border-primary/40 bg-card p-6 shadow-[0_-10px_60px_-10px_rgba(56,189,248,0.5)] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/60 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="text-center">
          <div className="font-tech text-[11px] font-bold uppercase tracking-widest text-primary">
            Pagamento via Pix
          </div>
          <h3 className="mt-2 text-xl font-bold text-foreground">R$ 9,90 · vitalício</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Escaneie o QR Code ou copie o código abaixo
          </p>
        </div>

        {/* QR Code fictício */}
        <div className="mx-auto mt-5 flex h-52 w-52 items-center justify-center rounded-2xl bg-white p-3">
          <FakeQR />
        </div>

        {/* Pix Copia e Cola */}
        <div className="mt-5">
          <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Pix Copia e Cola
          </label>
          <div className="mt-2 flex items-stretch gap-2">
            <div className="flex-1 truncate rounded-xl border border-border bg-background/60 px-3 py-3 font-mono text-[12px] text-foreground">
              {PIX_CODE}
            </div>
            <button
              onClick={copy}
              className="glow-neon inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-[12px] font-semibold text-primary-foreground"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>

        <p className="mt-5 rounded-xl border border-primary/30 bg-primary/10 p-3 text-center text-[12px] leading-relaxed text-foreground">
          Após o pagamento, seu acesso premium será liberado{" "}
          <span className="text-primary font-semibold">instantaneamente</span> no app.
        </p>

        <Link
          to="/welcome"
          className="mt-4 block text-center text-[11px] text-muted-foreground hover:text-foreground"
        >
          Já paguei — continuar
        </Link>
      </div>
    </div>
  );
}

function FakeQR() {
  // Deterministic 21x21 fake QR pattern
  const size = 21;
  const cells: boolean[] = [];
  for (let i = 0; i < size * size; i++) {
    // pseudo-random but stable
    cells.push(((i * 73856093) ^ (i * 19349663)) % 7 < 3);
  }
  // Position markers (corners)
  const setMarker = (r: number, c: number) => {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= size || cc >= size) continue;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const innerDot = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        cells[rr * size + cc] = onBorder || innerDot;
      }
    }
    // clear inner ring
    for (let dr = 1; dr <= 5; dr++) {
      for (let dc = 1; dc <= 5; dc++) {
        if (dr === 1 || dr === 5 || dc === 1 || dc === 5) {
          cells[(r + dr) * size + (c + dc)] = false;
        }
      }
    }
  };
  setMarker(0, 0);
  setMarker(0, size - 7);
  setMarker(size - 7, 0);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" aria-hidden="true">
      <rect width={size} height={size} fill="#ffffff" />
      {cells.map((on, i) =>
        on ? (
          <rect
            key={i}
            x={i % size}
            y={Math.floor(i / size)}
            width={1}
            height={1}
            fill="#0F172A"
          />
        ) : null,
      )}
    </svg>
  );
}
