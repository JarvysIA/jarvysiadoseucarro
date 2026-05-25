import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Droplet, Thermometer, Gauge } from "lucide-react";
import logo from "@/assets/jarvys-logo.png";
import { loadUser, type JarvysUser } from "@/lib/jarvys-store";
import { ChatFab } from "@/components/ChatFab";
import {
  AirFilterIcon,
  TireStackIcon,
  BrakeDiscIcon,
} from "@/components/automotive-icons";
import {
  VEHICLES,
  STATUS_LABEL,
  formatRemaining,
  predictChangeDate,
  type ItemKey,
  type Status,
  type Vehicle,
} from "@/lib/vehicles";

export const Route = createFileRoute("/home")({
  head: () => ({ meta: [{ title: "Status do Veículo — Jarvys" }] }),
  component: HomePage,
});

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

type ItemDef = {
  key: ItemKey;
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
};

const ITEMS: ItemDef[] = [
  { key: "oleo", label: "Óleo do Motor", icon: (p) => <Droplet className={p.className} /> },
  { key: "filtros", label: "Filtros", icon: (p) => <AirFilterIcon className={p.className} /> },
  { key: "pneus", label: "Pneus", icon: (p) => <TireStackIcon className={p.className} /> },
  { key: "pastilhas", label: "Pastilhas", icon: (p) => <BrakeDiscIcon className={p.className} /> },
  { key: "arrefecimento", label: "Arrefecimento", icon: (p) => <Thermometer className={p.className} /> },
];

function HomePage() {
  const [user, setUser] = useState<JarvysUser | null>(null);
  const [selectedId, setSelectedId] = useState<string>(VEHICLES[0].id);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setUser(loadUser());
  }, []);

  // Detecta o card mais centralizado no scroll horizontal.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const center = el.scrollLeft + el.clientWidth / 2;
      let bestId = VEHICLES[0].id;
      let bestDist = Infinity;
      el.querySelectorAll<HTMLElement>("[data-vehicle-id]").forEach((node) => {
        const cardCenter = node.offsetLeft + node.offsetWidth / 2;
        const dist = Math.abs(cardCenter - center);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = node.dataset.vehicleId || bestId;
        }
      });
      setSelectedId((prev) => (prev === bestId ? prev : bestId));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const selected: Vehicle = useMemo(
    () => VEHICLES.find((v) => v.id === selectedId) ?? VEHICLES[0],
    [selectedId],
  );

  return (
    <div className="relative min-h-screen bg-background pb-40">
      {/* Header */}
      <header className="flex items-center justify-between px-6 pt-10">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Jarvys" width={40} height={40} className="h-10 w-10 object-contain" />
          <div>
            <p className="text-xs text-muted-foreground">Olá,</p>
            <h1 className="text-lg font-semibold leading-tight">
              {user?.name?.split(" ")[0] || "Motorista"}
            </h1>
          </div>
        </div>
        <button className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card">
          <Bell className="h-5 w-5 text-foreground" />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[var(--status-bad)]" />
        </button>
      </header>

      {/* Título Minha Garagem */}
      <section className="mt-8 px-6">
        <h2 className="text-base font-semibold">Minha Garagem</h2>
      </section>

      {/* Carrossel de veículos */}
      <section className="mt-4">
        <div
          ref={scrollerRef}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {VEHICLES.map((v) => {
            const active = v.id === selectedId;
            return (
              <article
                key={v.id}
                data-vehicle-id={v.id}
                onClick={() => setSelectedId(v.id)}
                className={`w-[82%] shrink-0 snap-center overflow-hidden rounded-3xl border bg-card transition-all ${
                  active ? "glow-neon border-primary/40" : "border-border opacity-70"
                }`}
              >
                <div className="relative h-44 w-full bg-gradient-to-b from-secondary to-card">
                  <img
                    src={v.image}
                    alt={`${v.model} ${v.color}`}
                    width={1024}
                    height={768}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute top-3 left-3 rounded-full bg-background/70 px-2.5 py-1 text-[10px] font-medium tracking-wider text-primary backdrop-blur">
                    {v.plate}
                  </span>
                </div>
                <div className="p-4">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {v.year} · {v.color}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">{v.model}</h3>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Gauge className="h-4 w-4 text-primary" />
                    {v.km.toLocaleString("pt-BR")} km
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {/* Indicadores */}
        <div className="mt-2 flex items-center justify-center gap-2">
          {VEHICLES.map((v) => (
            <span
              key={v.id}
              className={`h-1.5 rounded-full transition-all ${
                v.id === selectedId ? "w-6 bg-primary" : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>
      </section>

      {/* Cabeçalho Status do Veículo + Legenda */}
      <section className="mt-10 px-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Status do Veículo</h2>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <Legend status="ok" />
            <Legend status="warn" />
            <Legend status="bad" />
          </div>
        </div>
      </section>

      {/* Grade dinâmica de status */}
      <section className="mt-4 px-6">
        <div className="grid grid-cols-2 gap-3">
          {ITEMS.map((it, idx) => {
            const data = selected.status[it.key];
            const isOil = it.key === "oleo";
            const fullSpan = idx === ITEMS.length - 1 && ITEMS.length % 2 === 1;
            return (
              <div
                key={it.key}
                className={`relative rounded-2xl border border-border bg-card p-4 ${
                  fullSpan ? "col-span-2" : ""
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
                    {it.icon({ className: "h-5 w-5" })}
                  </div>
                  <span
                    className={`h-3 w-3 rounded-full ${STATUS_CLASS[data.status]} ${STATUS_RING[data.status]}`}
                    aria-label={STATUS_LABEL[data.status]}
                  />
                </div>
                <p className="mt-4 text-sm font-medium text-foreground">{it.label}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatRemaining(data.remainingKm)}
                </p>
                {isOil && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Previsão de troca:{" "}
                    <span className="font-medium text-foreground">
                      {predictChangeDate(data.remainingKm)}
                    </span>
                  </p>
                )}
                <p
                  className="mt-2 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: `var(--status-${data.status})` }}
                >
                  {STATUS_LABEL[data.status]}
                </p>
              </div>
            );
          })}
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
