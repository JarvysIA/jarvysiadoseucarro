import logo from "@/assets/jarvys-logo.png";
import { BottomNav } from "@/components/BottomNav";

export function PlaceholderPage({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="relative min-h-screen bg-black pb-32">
      <header className="flex items-center justify-center px-6 pt-10">
        <img src={logo} alt="Jarvys" width={40} height={40} className="h-10 w-10 object-contain" />
      </header>
      <main className="mt-16 flex flex-col items-center px-6 text-center">
        <h1
          className="font-tech text-3xl uppercase"
          style={{
            color: "#38BDF8",
            textShadow:
              "0 0 8px rgba(56,189,248,0.9), 0 0 22px rgba(56,189,248,0.55), 0 0 44px rgba(56,189,248,0.35)",
          }}
        >
          {title}
        </h1>
        <p className="mt-6 max-w-xs text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-12 h-px w-40 bg-[rgba(56,189,248,0.4)]" />
        <p className="mt-6 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
          Em breve
        </p>
      </main>
      <BottomNav />
    </div>
  );
}
