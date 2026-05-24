import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bell,
  Droplet,
  Filter,
  Disc,
  CircleDot,
  Thermometer,
  Gauge,
  MapPin,
} from "lucide-react";
import jeepImg from "@/assets/jeep-renegade.jpg";
import logo from "@/assets/jarvys-logo.png";
import { loadUser, type JarvysUser } from "@/lib/jarvys-store";
import { ChatFab } from "@/components/ChatFab";

export const Route = createFileRoute("/home")({
  head: () => ({ meta: [{ title: "Minha Garagem — Jarvys" }] }),
  component: HomePage,
});

type Status = "ok" | "warn" | "bad";

const STATUS_LABEL: Record<Status, string> = {
  ok: "Em dia",
  warn: "Alerta",
  bad: "Atrasado",
};

const STATUS_CLASS: Record<Status, string> = {
  ok: "bg-[var(--status-ok)]",
  warn: "bg-[var(--status-warn)]",
  bad: "bg-[var(--status-bad)]",
};

const STATUS_RING: Record<Status, string> = {
  ok: "shadow-[0_0_18px_-2px_var(--status-ok)]",
  warn: "shadow-[0_0_18px_-2px_var(--status-warn)]",
  bad: "shadow-[0_0_18px_-2px_var(--status-bad)]",
};

const vehicles = [
  { id: 1, model: "Jeep Renegade", year: "2022", km: 48230, plate: "ABC-1D23", img: jeepImg },
  { id: 2, model: "Jeep Renegade", year: "2019", km: 92110, plate: "XYZ-4K56", img: jeepImg },
];

const items: { key: string; label: string; icon: React.ReactNode; status: Status; detail: string }[] = [
  { key: "oleo", label: "Óleo do Motor", icon: <Droplet className="h-5 w-5" />, status: "ok", detail: "Faltam 4.200 km" },
  { key: "filtros", label: "Filtros", icon: <Filter className="h-5 w-5" />, status: "warn", detail: "Trocar em breve" },
  { key: "pneus", label: "Pneus", icon: <CircleDot className="h-5 w-5" />, status: "ok", detail: "Pressão ok" },
  { key: "pastilhas", label: "Pastilhas", icon: <Disc className="h-5 w-5" />, status: "bad", detail: "Substituir agora" },
  { key: "arrefecimento", label: "Arrefecimento", icon: <Thermometer className="h-5 w-5" />, status: "ok", detail: "Nível ideal" },
];

function HomePage() {
  const [user, setUser] = useState<JarvysUser | null>(null);

  useEffect(() => {
    setUser(loadUser());
  }, []);

  return (
    <div className="relative min-h-screen bg-background pb-40">
      {/* Header */}
      <header className="flex items-center justify-between px-6 pt-10">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Jarvys" width={40} height={40} className="h-10 w-10 object-contain" />
          <div>
            <p className="text-xs text-muted-foreground">Olá,</p>
            <h1 className="text-lg font-semibold leading-tight">{user?.name?.split(" ")[0] || "Motorista"}</h1>
          </div>
        </div>
        <button className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card">
          <Bell className="h-5 w-5 text-foreground" />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[var(--status-bad)]" />
        </button>
      </header>

      {/* Minha Garagem */}
      <section className="mt-8">
        <div className="flex items-center justify-between px-6">
          <h2 className="text-base font-semibold">Minha Garagem</h2>
          <span className="text-xs text-muted-foreground">{vehicles.length} veículos</span>
        </div>

        <div className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {vehicles.map((v) => (
            <article
              key={v.id}
              className="glow-neon w-[78%] shrink-0 snap-center overflow-hidden rounded-3xl border border-border bg-card"
            >
              <div className="relative h-40 w-full bg-gradient-to-b from-secondary to-card">
                <img
                  src={v.img}
                  alt={v.model}
                  width={1024}
                  height={640}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <span className="absolute top-3 left-3 rounded-full bg-background/70 px-2.5 py-1 text-[10px] font-medium tracking-wider text-primary backdrop-blur">
                  {v.plate}
                </span>
              </div>
              <div className="p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{v.year}</p>
                <h3 className="mt-1 text-lg font-semibold">{v.model}</h3>

                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Gauge className="h-4 w-4 text-primary" />
                    {v.km.toLocaleString("pt-BR")} km
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="h-4 w-4 text-primary" />
                    São Paulo
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Status Grid */}
      <section className="mt-8 px-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Saúde do veículo</h2>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <Legend status="ok" />
            <Legend status="warn" />
            <Legend status="bad" />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {items.map((it, idx) => (
            <div
              key={it.key}
              className={`relative rounded-2xl border border-border bg-card p-4 ${
                idx === items.length - 1 && items.length % 2 === 1 ? "col-span-2" : ""
              }`}
            >
              <div className="flex items-start justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary`}>
                  {it.icon}
                </div>
                <span
                  className={`h-3 w-3 rounded-full ${STATUS_CLASS[it.status]} ${STATUS_RING[it.status]}`}
                  aria-label={STATUS_LABEL[it.status]}
                />
              </div>
              <p className="mt-4 text-sm font-medium text-foreground">{it.label}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{it.detail}</p>
              <p className={`mt-2 text-[10px] font-semibold uppercase tracking-wider`} style={{ color: `var(--status-${it.status})` }}>
                {STATUS_LABEL[it.status]}
              </p>
            </div>
          ))}
        </div>
      </section>

      <ChatFab />
    </div>
  );
}

function Legend({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${STATUS_CLASS[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}
