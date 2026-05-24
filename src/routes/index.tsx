import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Car } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Jarvys — A IA do seu carro" },
      { name: "description", content: "Jarvys: monitore a saúde do seu carro com inteligência artificial." },
    ],
  }),
  component: Welcome,
});

function Welcome() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-between overflow-hidden bg-background px-6 py-12">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" />
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--neon) 35%, transparent), transparent 70%)" }}
      />

      <div className="relative z-10 mt-10 flex flex-col items-center">
        <div className="glow-neon flex h-20 w-20 items-center justify-center rounded-2xl bg-card">
          <Sparkles className="h-9 w-9 text-primary" />
        </div>
        <h1 className="mt-6 text-5xl font-bold tracking-tight text-foreground">
          Jarv<span className="text-primary text-glow">ys</span>
        </h1>
        <p className="mt-3 text-center text-base text-muted-foreground">
          A IA do seu carro
        </p>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3 text-center">
        <Car className="h-24 w-24 text-primary/70" strokeWidth={1.2} />
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
          Tenha o controle total da saúde do seu veículo na palma da mão.
        </p>
      </div>

      <div className="relative z-10 w-full max-w-sm space-y-3">
        <Link
          to="/signup"
          className="glow-neon flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          Começar agora
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          to="/home"
          className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Já tenho uma conta
        </Link>
      </div>
    </div>
  );
}
