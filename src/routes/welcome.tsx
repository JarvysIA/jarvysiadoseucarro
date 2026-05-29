import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import logo from "@/assets/jarvys-logo.png";

export const Route = createFileRoute("/welcome")({
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
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--neon) 30%, transparent), transparent 70%)" }}
      />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center">
        <img
          src={logo}
          alt="Jarvys"
          width={520}
          height={520}
          className="w-72 max-w-[80vw] drop-shadow-[0_0_40px_rgba(56,189,248,0.35)]"
        />
        <p className="font-tech text-neon-white mt-3 text-center text-sm font-semibold uppercase">
          A IA do seu carro
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
          to="/login"
          className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Já tenho uma conta
        </Link>
      </div>
    </div>
  );
}
