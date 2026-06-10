import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Gauge,
  FileCheck2,
  Award,
  MessageCircle,
  Mic,
  Bot,
  Check,
  AlertTriangle,
  Coffee,
  Wrench,
  Camera,
  Bell,
  Calendar,
} from "lucide-react";
import logo from "@/assets/jarvys-logo.png";
import carImg from "@/assets/jeep-renegade.jpg";
import onixImg from "@/assets/chevrolet-onix.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Jarvys — A IA que cuida do seu carro" },
      {
        name: "description",
        content:
          "Monitore a saúde do seu veículo, antecipe manutenções e valorize seu carro na revenda. Grátis para sempre.",
      },
      { property: "og:title", content: "Jarvys — A IA que cuida do seu carro" },
      {
        property: "og:description",
        content:
          "Monitore a saúde do seu veículo, antecipe manutenções e valorize seu carro na revenda.",
      },
    ],
  }),
  component: LandingPage,
});

/* ---------------- helpers ---------------- */

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, shown } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ---------------- page ---------------- */

function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* ambient */}
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-[0.15]" />
      <div
        className="pointer-events-none absolute -top-48 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--neon) 30%, transparent), transparent 70%)",
        }}
      />

      <Header />

      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <Hero />
        <Garagem />
        <Timeline />
        <DrJarvys />
        <Pricing />
        <Footer />
      </main>
    </div>
  );
}

/* ---------------- header ---------------- */

function Header() {
  return (
    <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-5 pt-6 sm:px-8">
      <div className="flex items-center gap-2">
        <img
          src={logo}
          alt="Jarvys"
          className="h-9 w-9 drop-shadow-[0_0_12px_rgba(56,189,248,0.55)]"
        />
        <span className="font-tech text-[13px] font-bold">JARVYS</span>
      </div>
      <nav className="flex items-center gap-5 text-xs text-muted-foreground">
        <Link to="/login" className="hover:text-foreground transition-colors">
          Entrar
        </Link>
        <Link
          to="/signup"
          className="rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          Criar conta
        </Link>
      </nav>
    </header>
  );
}

/* ---------------- hero ---------------- */

function Hero() {
  return (
    <section className="pt-10 pb-12 text-center sm:pt-16 sm:pb-16">
      <Reveal>
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          1ª IA automotiva do Brasil
        </div>
      </Reveal>

      <Reveal delay={80}>
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
          A <span className="text-primary text-glow">IA que cuida</span> do seu carro
          <br className="hidden sm:block" /> para você nunca mais{" "}
          <span className="text-primary text-glow">tomar um prejuízo.</span>
        </h1>
      </Reveal>

      <Reveal delay={160}>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          Monitore a saúde do seu veículo, antecipe manutenções e valorize seu veículo na revenda
          de forma 100% integrada.
        </p>
      </Reveal>

      <Reveal delay={240}>
        <div className="mt-7 flex flex-col items-center gap-3">
          <Link
            to="/signup"
            className="glow-neon group inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-7 py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            Criar minha Garagem Grátis
            <span className="ml-1 rounded-full bg-primary-foreground/15 px-2 py-0.5 text-[11px] font-semibold">
              Grátis para sempre
            </span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Brinde 30 dias de Inteligência Artificial liberada. Sem pegadinhas.
          </p>
        </div>
      </Reveal>

    </section>
  );
}

/* ---------------- section: garagem ---------------- */

function Garagem() {
  return (
    <section className="py-10 sm:py-14">
      <SectionLabel>Minha Garagem</SectionLabel>
      <Reveal delay={80}>
        <h2 className="mt-3 max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Sua garagem digital, <span className="text-primary">inteligente desde o cadastro.</span>
        </h2>
      </Reveal>
      <Reveal delay={160}>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Basta digitar a placa. O Jarvys lê o modelo, ano e cor do seu carro e monta sua garagem
          personalizada. Cada peça vital recebe um <strong className="text-foreground">Status de Saúde</strong>{" "}
          calculado em tempo real pela sua quilometragem.
        </p>
      </Reveal>

      <div className="mt-8 grid gap-6 lg:grid-cols-2 lg:items-center">
        <Reveal delay={120}>
          <DashboardMock />
        </Reveal>

        <Reveal delay={200}>
          <ul className="space-y-3">
            <StatusLegend color="status-ok" label="Verde · Dirija tranquilo." desc="Componente saudável." />
            <StatusLegend color="status-warn" label="Amarelo · Alerta" desc="Faltam poucos km. Hora de se programar." />
            <StatusLegend color="status-bad" label="Vermelho · Risco real de quebra." desc="Revisão imediata." />
            <li className="mt-4 rounded-2xl border border-border bg-card/60 p-4 text-[13px] text-muted-foreground">
              <span className="text-foreground font-semibold">Antecipação inteligente.</span> O app
              alerta antes que o problema vire prejuízo no seu bolso.
            </li>
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

function StatusLegend({
  color,
  label,
  desc,
}: {
  color: "status-ok" | "status-warn" | "status-bad";
  label: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-card/60 p-4">
      <span
        className="mt-1 h-3 w-3 shrink-0 rounded-full"
        style={{
          backgroundColor: `var(--${color})`,
          boxShadow: `0 0 14px color-mix(in oklab, var(--${color}) 70%, transparent)`,
        }}
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{desc}</p>
      </div>
    </li>
  );
}

/* ---------------- section: timeline + certificado ---------------- */

function Timeline() {
  return (
    <section className="py-10 sm:py-14">
      <SectionLabel>Timeline & Certificado</SectionLabel>
      <Reveal delay={80}>
        <h2 className="mt-3 max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Cada revisão <span className="text-primary">valoriza seu carro.</span>
        </h2>
      </Reveal>
      <Reveal delay={160}>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Envie a foto da nota fiscal do mecânico. Nossa IA audita o serviço, valida a revisão e
          monta uma <strong className="text-foreground">linha do tempo viva</strong> do seu carro.
          Na hora de vender, você apresenta o <strong className="text-foreground">Certificado de Revisão Jarvys</strong>{" "}
          e valoriza seu veículo em milhares de reais.
        </p>
      </Reveal>

      <div className="mt-8 grid gap-6 lg:grid-cols-5 lg:items-center">
        <Reveal delay={120} className="lg:col-span-3">
          <TimelineMock />
        </Reveal>
        <Reveal delay={220} className="lg:col-span-2">
          <CertificateMock />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- section: dr. jarvys ---------------- */

function DrJarvys() {
  return (
    <section className="py-10 sm:py-14">
      <SectionLabel>Dr. Jarvys</SectionLabel>
      <Reveal delay={80}>
        <h2 className="mt-3 max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Um mecânico de bolso, <span className="text-primary">24 horas por dia.</span>
        </h2>
      </Reveal>
      <Reveal delay={160}>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Converse por texto ou áudio. Descreva aquele barulho estranho, fotografe uma luz acesa no
          painel ou cole o orçamento do mecânico — o Dr. Jarvys responde na hora se o preço está
          justo e o que pode estar acontecendo.
        </p>
      </Reveal>

      <div className="mt-8 grid gap-6 lg:grid-cols-2 lg:items-center">
        <Reveal delay={120}>
          <ChatMock />
        </Reveal>
        <Reveal delay={200}>
          <ul className="space-y-3">
            <Feature icon={<MessageCircle className="h-5 w-5" />} title="Chat por texto" desc="Tire dúvidas técnicas em linguagem humana, sem tecniquês." />
            <Feature icon={<Mic className="h-5 w-5" />} title="Áudio em tempo real" desc='Mande "alô" para o Dr. Jarvys como se fosse um amigo no Whats.' />
            <Feature icon={<Wrench className="h-5 w-5" />} title="Cotação justa" desc="Cole o orçamento e descubra se o mecânico está te cobrando demais." />
            <Feature icon={<Bell className="h-5 w-5" />} title="Alertas proativos" desc="Receba avisos antes da peça falhar — direto no Whats." />
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-card/60 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{desc}</p>
      </div>
    </li>
  );
}

/* ---------------- section: pricing ---------------- */

function Pricing() {
  return (
    <section className="py-10 sm:py-14">
      <SectionLabel>Preço</SectionLabel>
      <Reveal delay={80}>
        <h2 className="mx-auto mt-3 max-w-3xl text-balance text-center text-3xl font-bold tracking-tight sm:text-4xl">
          Mais barato que um lanche para{" "}
          <span className="text-primary">proteger seu carro.</span>
        </h2>
      </Reveal>

      <div className="mx-auto mt-8 grid max-w-4xl gap-6 lg:grid-cols-5">
        {/* price card */}
        <Reveal delay={120} className="lg:col-span-3">
          <div className="glow-neon relative overflow-hidden rounded-3xl border border-primary/40 bg-card p-7">
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{
                background:
                  "radial-gradient(circle at top right, color-mix(in oklab, var(--neon) 18%, transparent), transparent 60%)",
              }}
            />
            <div className="relative">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-primary">
                <Award className="h-4 w-4" />
                LICENÇA ÚNICA • POR VEÍCULO
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-5xl font-extrabold tracking-tight">R$ 29,90</span>
              </div>
              <p className="mt-2 text-[13px] text-muted-foreground">
                Um veículo sem mensalidade. Sem pegadinha. Sem cartão.
              </p>

              <ul className="mt-6 space-y-2.5 text-sm">
                {[
                  "Garagem inteligente com Status de Saúde",
                  "Timeline de revisões auditadas",
                  "Certificado Jarvys para revenda",
                  "Dr. Jarvys — chat e áudio ilimitados",
                  "Alertas proativos no WhatsApp",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-foreground/90">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/signup"
                className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
              >
                Experimentar grátis por 30 dias
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Após o teste, ative por R$ 29,90.
              </p>
            </div>
          </div>
        </Reveal>

        {/* objection box */}
        <Reveal delay={200} className="lg:col-span-2">
          <div className="flex h-full flex-col gap-4">
            <div className="rounded-3xl border border-destructive/40 bg-destructive/5 p-5">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Conta de quem não cuida
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-foreground/90">
                Esquecer de trocar o óleo =
              </p>
              <p className="mt-1 text-3xl font-extrabold tracking-tight text-destructive">
                R$ 5.000
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">de motor batido.</p>
            </div>
            <div className="rounded-3xl border border-primary/40 bg-primary/5 p-5">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-primary">
                <Coffee className="h-4 w-4" />
                Conta de quem assina
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-foreground/90">
                Jarvys =
              </p>
              <p className="mt-1 text-3xl font-extrabold tracking-tight text-primary text-glow">
                R$ 29,90
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- footer ---------------- */

function Footer() {
  return (
    <footer className="mt-16 border-t border-border/60 pt-8 text-center text-[11px] text-muted-foreground">
      © {new Date().getFullYear()} Jarvys · A IA do seu carro
    </footer>
  );
}

/* ---------------- shared mini components ---------------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Reveal>
      <div className="font-tech text-[11px] font-bold uppercase text-primary">{children}</div>
    </Reveal>
  );
}

/* ---------------- visual mockups ---------------- */

function DashboardMock() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-card/80 p-5 shadow-[0_30px_80px_-30px_rgba(56,189,248,0.45)] backdrop-blur">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(circle at 80% -10%, color-mix(in oklab, var(--neon) 25%, transparent), transparent 60%)",
        }}
      />
      <div className="relative">
        {/* status bar fake */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-tech tracking-widest">JARVYS · MINHA GARAGEM</span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-status-ok" />
            online
          </span>
        </div>

        {/* car hero */}
        <div className="relative mt-3 overflow-hidden rounded-2xl border border-border/70">
          <img
            src={carImg}
            alt="Carro do usuário em ângulo de estúdio"
            className="aspect-[16/9] w-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-primary">Jeep Renegade</p>
                <p className="text-sm font-semibold text-white">2022 · Preto Carbon</p>
              </div>
              <p className="font-tech text-[11px] text-white/80">ABC1D23</p>
            </div>
          </div>
        </div>

        {/* status cards */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatusCard label="Óleo" status="ok" sub="4.200 km" />
          <StatusCard label="Filtros" status="warn" sub="1.500 km" />
          <StatusCard label="Pastilhas" status="bad" sub="-300 km" />
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5 text-primary" />
            48.230 km
          </span>
          <span>próx. revisão · ago/26</span>
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  label,
  status,
  sub,
}: {
  label: string;
  status: "ok" | "warn" | "bad";
  sub: string;
}) {
  const map = {
    ok: { v: "--status-ok", t: "Em dia" },
    warn: { v: "--status-warn", t: "Alerta" },
    bad: { v: "--status-bad", t: "Atrasado" },
  } as const;
  const cfg = map[status];
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: `var(${cfg.v})`,
            boxShadow: `0 0 10px color-mix(in oklab, var(${cfg.v}) 80%, transparent)`,
          }}
        />
      </div>
      <p className="mt-1.5 text-sm font-semibold">{cfg.t}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function TimelineMock() {
  const items = [
    { date: "Mai · 2026", title: "Troca de óleo + filtro", km: "46.000 km", ok: true, icon: <Wrench className="h-3.5 w-3.5" /> },
    { date: "Jan · 2026", title: "Pastilhas dianteiras", km: "42.300 km", ok: true, icon: <Wrench className="h-3.5 w-3.5" /> },
    { date: "Set · 2025", title: "Revisão 40 mil km", km: "40.000 km", ok: true, icon: <Calendar className="h-3.5 w-3.5" /> },
    { date: "Mar · 2025", title: "Nota fiscal enviada", km: "35.800 km", pending: true, icon: <Camera className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border bg-card/70 p-6 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="font-tech text-[11px] uppercase tracking-widest text-primary">
          Linha do tempo · auditada
        </div>
        <FileCheck2 className="h-4 w-4 text-primary" />
      </div>





      <div className="relative mt-5 pl-5">
        <span className="absolute left-1.5 top-2 bottom-2 w-px bg-gradient-to-b from-primary/60 via-border to-transparent" />
        <ul className="space-y-4">
          {items.map((it, i) => (
            <li key={i} className="relative">
              <span
                className="absolute -left-[18px] top-1.5 flex h-3 w-3 items-center justify-center rounded-full"
                style={{
                  backgroundColor: it.pending
                    ? "var(--status-warn)"
                    : "var(--status-ok)",
                  boxShadow: `0 0 10px color-mix(in oklab, var(${
                    it.pending ? "--status-warn" : "--status-ok"
                  }) 80%, transparent)`,
                }}
              />
              <div className="rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{it.date}</span>
                  <span>{it.km}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-primary">{it.icon}</span>
                  <p className="text-sm font-semibold">{it.title}</p>
                  {it.pending ? (
                    <span className="ml-auto rounded-full bg-status-warn/15 px-2 py-0.5 text-[10px] font-medium text-status-warn">
                      em análise
                    </span>
                  ) : (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-status-ok/15 px-2 py-0.5 text-[10px] font-medium text-status-ok">
                      <Check className="h-3 w-3" />
                      auditada
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CertificateMock() {
  return (
    <div
      className="relative overflow-hidden rounded-3xl border p-6 text-center"
      style={{
        borderColor: "color-mix(in oklab, var(--neon) 50%, transparent)",
        background:
          "linear-gradient(160deg, color-mix(in oklab, var(--neon) 10%, transparent), color-mix(in oklab, var(--card) 95%, transparent) 60%)",
        boxShadow:
          "0 30px 80px -30px color-mix(in oklab, var(--neon) 55%, transparent), inset 0 0 0 1px color-mix(in oklab, var(--neon) 20%, transparent)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, color-mix(in oklab, var(--neon) 40%, transparent), transparent 60%)",
        }}
      />
      <div className="relative">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-primary/50 bg-background/60 text-primary animate-breathing-glow">
          <Award className="h-9 w-9" />
        </div>
        <div className="relative mx-auto mt-5 max-w-[260px] overflow-hidden rounded-2xl border border-border/70">
          <img
            src={onixImg}
            alt="Chevrolet Onix em ângulo de estúdio"
            loading="lazy"
            className="aspect-[16/9] w-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2.5 text-left">
            <p className="text-[9px] uppercase tracking-widest text-primary">Chevrolet Onix</p>
            <p className="text-[11px] font-semibold text-white">2023 · Prata</p>
          </div>
        </div>
        <p className="mt-4 font-tech text-[11px] uppercase tracking-widest text-primary">
          Certificado oficial
        </p>
        <h3 className="mt-2 text-xl font-extrabold tracking-tight">
          Revisões Auditadas <span className="text-primary text-glow">Jarvys</span>
        </h3>
        <p className="mx-auto mt-2 max-w-[34ch] text-balance text-[12px] leading-relaxed text-muted-foreground">
          Documento verificável que comprova o histórico de manutenção e valoriza seu veículo na revenda.
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Stat n="12" l="revisões" />
          <Stat n="100%" l="auditadas" />
          <Stat n="+R$ 4k" l="revenda" highlight />
        </div>

        <p className="mt-5 font-tech text-[10px] uppercase tracking-widest text-muted-foreground">
          #JRV-2026-ABC1D23
        </p>
      </div>
    </div>
  );
}

function Stat({ n, l, highlight }: { n: string; l: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-xl border px-1 py-2 ${
        highlight ? "border-primary/50 bg-primary/10" : "border-border bg-background/40"
      }`}
    >
      <p
        className={`text-base font-extrabold ${
          highlight ? "text-primary text-glow" : "text-foreground"
        }`}
      >
        {n}
      </p>
      <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{l}</p>
    </div>
  );
}

function ChatMock() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border bg-card/80 p-5 backdrop-blur">
      <div className="flex items-center gap-3 border-b border-border/60 pb-3">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Bot className="h-5 w-5" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-status-ok" />
        </div>
        <div>
          <p className="text-sm font-semibold">Dr. Jarvys</p>
          <p className="text-[11px] text-muted-foreground">online · responde em segundos</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <Bubble side="user">
          Tô ouvindo um barulho de "tic tic" no motor quando acelero a frio. É grave?
        </Bubble>
        <Bubble side="bot">
          Quase sempre é folga de tucho ou nível de óleo abaixo do recomendado. Antes de qualquer
          coisa, abra o capô com o motor frio e veja a vareta. Me manda uma foto?
        </Bubble>
        <Bubble side="user" audio />
        <Bubble side="bot">
          Pelo áudio, parece ruído mecânico do lado direito. Recomendo levar pra escutar. Cotação
          justa para esse serviço no seu Renegade: <strong>R$ 180 a R$ 280</strong>. Acima disso,
          peça desconto.
        </Bubble>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border/60 bg-background/40 px-3 py-2.5">
        <input
          disabled
          placeholder="Pergunte qualquer coisa sobre seu carro…"
          className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
          aria-label="Gravar áudio"
        >
          <Mic className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Bubble({
  side,
  children,
  audio,
}: {
  side: "user" | "bot";
  children?: React.ReactNode;
  audio?: boolean;
}) {
  const isUser = side === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser
            ? "bg-primary/15 text-foreground rounded-br-sm"
            : "bg-background/60 border border-border/60 text-foreground/90 rounded-bl-sm"
        }`}
      >
        {audio ? (
          <div className="flex items-center gap-2">
            <Mic className="h-3.5 w-3.5 text-primary" />
            <div className="flex items-end gap-0.5">
              {[6, 12, 8, 16, 10, 14, 7, 11, 5].map((h, i) => (
                <span
                  key={i}
                  className="w-0.5 rounded-full bg-primary/70"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">0:08</span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
