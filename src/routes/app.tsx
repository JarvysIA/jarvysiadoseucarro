import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Droplet, Thermometer, Gauge, Lock, Copy, Check, Sparkles, Car } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/jarvys-logo.png";
import fallbackCarImg from "@/assets/car-fallback.jpg";
import { supabase } from "@/integrations/supabase/client";
import { fetchVehicleImageFn } from "@/lib/vehicle-image.functions";
import { ChatFab } from "@/components/ChatFab";
import { BottomNav } from "@/components/BottomNav";
import {
  AirFilterIcon,
  TireStackIcon,
  BrakeDiscIcon,
} from "@/components/automotive-icons";
import {
  STATUS_LABEL,
  formatRemaining,
  predictChangeDate,
  type ItemKey,
  type Status,
  type StatusItem,
} from "@/lib/vehicles";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Minha Garagem — Jarvys" }] }),
  component: AppPage,
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

type Profile = {
  id: string;
  nome: string;
  status_usuario: "trial" | "ativo";
  permite_indicacao: boolean;
  trial_inicio: string;
  referrer_id: string | null;
};

type DbVehicle = {
  id: string;
  placa: string;
  marca: string | null;
  modelo: string | null;
  ano: string | null;
  cor: string | null;
  km_atual: number | null;
  chassi: string | null;
  foto_url: string | null;
};

type UserVehicle = {
  id: string;
  marca: string;
  modelo: string;
  year: string;
  color: string;
  plate: string;
  km: number;
  chassi: string;
  fotoUrl: string | null;
  status: Record<ItemKey, StatusItem>;
};

function buildStatus(ano: string): Record<ItemKey, StatusItem> {
  const yearNum = parseInt(ano, 10) || 0;
  const allOk: Record<ItemKey, StatusItem> = {
    oleo: { status: "ok", remainingKm: 4200 },
    filtros: { status: "ok", remainingKm: 5200 },
    pneus: { status: "ok", remainingKm: 12000 },
    pastilhas: { status: "ok", remainingKm: 9000 },
    arrefecimento: { status: "ok", remainingKm: 8000 },
  };
  if (yearNum > 2023) return allOk;
  const keys: ItemKey[] = ["oleo", "filtros", "pneus", "pastilhas", "arrefecimento"];
  const pick = keys[Math.floor(Math.random() * keys.length)];
  const bad = Math.random() < 0.5;
  allOk[pick] = bad
    ? { status: "bad", remainingKm: -Math.floor(300 + Math.random() * 800) }
    : { status: "warn", remainingKm: Math.floor(500 + Math.random() * 1500) };
  return allOk;
}

function AppPage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [vehicles, setVehicles] = useState<UserVehicle[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        navigate({ to: "/welcome", replace: true });
        return;
      }
      const userId = session.session.user.id;
      const [{ data: prof }, { data: veics }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,nome,status_usuario,permite_indicacao,trial_inicio,referrer_id")
          .eq("id", userId)
          .maybeSingle(),
        supabase
          .from("veiculos")
          .select("id,placa,marca,modelo,ano,cor,km_atual,chassi,foto_url")
          .eq("user_id", userId)
          .order("created_at", { ascending: true }),
      ]);
      setProfile(prof as Profile | null);
      const mapped: UserVehicle[] = ((veics ?? []) as DbVehicle[]).map((v) => {
        const marca = v.marca?.trim() || "";
        const modelo = v.modelo?.trim() || "";
        const ano = v.ano?.trim() || "";
        const cor = v.cor?.trim() || "—";
        return {
          id: v.id,
          marca,
          modelo,
          year: ano || "—",
          color: cor,
          plate: v.placa,
          km: v.km_atual ?? 0,
          chassi: (v.chassi || "").trim(),
          fotoUrl: v.foto_url || null,
          status: buildStatus(ano),
        };
      });
      setVehicles(mapped);
      if (mapped.length) setSelectedId(mapped[0].id);
      setLoadingProfile(false);
    })();
  }, [navigate]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || vehicles.length === 0) return;
    const onScroll = () => {
      const center = el.scrollLeft + el.clientWidth / 2;
      let bestId = vehicles[0].id;
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
  }, [vehicles]);

  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? vehicles[0],
    [selectedId, vehicles],
  );

  const isTrial = profile?.status_usuario !== "ativo";
  const hasReferrer = !!profile?.referrer_id;
  const activationPrice = hasReferrer ? "9,90" : "14,90";
  const daysLeft = useMemo(() => {
    if (!profile?.trial_inicio) return 30;
    const ms = Date.now() - new Date(profile.trial_inicio).getTime();
    const used = Math.floor(ms / (1000 * 60 * 60 * 24));
    return Math.max(0, 30 - used);
  }, [profile?.trial_inicio]);

  return (
    <div className="relative min-h-screen bg-background pb-56">
      {/* Banner trial */}
      {!loadingProfile && isTrial && (
        <a
          href="https://jarvys.com.br/assinar"
          target="_blank"
          rel="noopener noreferrer"
          className="sticky top-0 z-20 flex flex-col items-center justify-center gap-0.5 border-b border-primary/30 px-4 py-2 text-center text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
          style={{
            background: "rgba(56,189,248,0.08)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            {daysLeft} dias grátis · Ative vitalício por R$ {activationPrice}
          </div>
          {hasReferrer && (
            <span className="text-[10px] font-semibold text-primary/90">
              Desconto de indicado aplicado 🎉
            </span>
          )}
        </a>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-6 pt-8">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Jarvys" width={40} height={40} className="h-10 w-10 object-contain" />
          <div>
            <p className="text-xs text-muted-foreground">Olá,</p>
            <h1 className="text-lg font-semibold leading-tight">
              {profile?.nome?.split(" ")[0] || "Motorista"}
            </h1>
          </div>
        </div>
        <button className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card">
          <Bell className="h-5 w-5 text-foreground" />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[var(--status-bad)]" />
        </button>
      </header>

      <section className="mt-8 px-6">
        <h2 className="text-base font-semibold">Minha Garagem</h2>
      </section>

      <section className="mt-4">
        {vehicles.length === 0 && !loadingProfile ? (
          <div className="mx-6 rounded-3xl border border-dashed border-border bg-card/40 p-8 text-center">
            <Car className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum veículo cadastrado ainda.
            </p>
          </div>
        ) : (
          <>
            <div
              ref={scrollerRef}
              className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {vehicles.map((v) => {
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
                    <div className="relative h-44 w-full overflow-hidden bg-card">
                      <VehicleImage
                        marca={v.marca}
                        modelo={v.modelo}
                        ano={v.year}
                        cor={v.color}
                        alt={`${v.marca} ${v.modelo} ${v.color}`}
                      />

                      <span className="absolute top-3 left-3 z-[3] rounded-full bg-background/70 px-2.5 py-1 text-[10px] font-medium tracking-wider text-primary backdrop-blur">
                        {v.plate}
                      </span>
                    </div>
                    <div className="p-4">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {v.year} · {v.color}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold">
                        {[v.marca, v.modelo].filter(Boolean).join(" ") || "Veículo"}
                      </h3>
                      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                        <Gauge className="h-4 w-4 text-primary" />
                        {v.km.toLocaleString("pt-BR")} km
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-center gap-2">
              {vehicles.map((v) => (
                <span
                  key={v.id}
                  className={`h-1.5 rounded-full transition-all ${
                    v.id === selectedId ? "w-6 bg-primary" : "w-1.5 bg-border"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {selected && (
        <>
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
        </>
      )}

      {/* Indicações */}
      <section className="mt-8 px-6">
        <h2 className="text-base font-semibold">Indicações</h2>
        <div className="mt-3">
          {profile?.permite_indicacao ? (
            <ReferralUnlocked userId={profile.id} />
          ) : (
            <ReferralLocked price={activationPrice} hasReferrer={hasReferrer} />
          )}
        </div>
      </section>

      <ChatFab />
      <BottomNav />
    </div>
  );
}

function ReferralLocked({ price, hasReferrer }: { price: string; hasReferrer: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <Lock className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Seu link de indicação está bloqueado</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Ative sua garagem vitalícia por{" "}
            <span className="font-semibold text-primary">R$ {price}</span>{" "}
            para liberar seu link exclusivo e ganhar{" "}
            <span className="font-semibold text-primary">R$ 5,00 no Pix</span>{" "}
            por cada amigo indicado que se cadastrar e também ativar a conta!
          </p>
          {hasReferrer && (
            <p className="mt-2 text-[11px] font-semibold text-primary">
              Desconto de indicado aplicado 🎉
            </p>
          )}
          <button
            type="button"
            onClick={() => toast.info("Em breve: ativação via Pix.")}
            className="glow-neon mt-3 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Ativar por R$ {price}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReferralUnlocked({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${typeof window !== "undefined" ? window.location.origin : "https://jarvys.app"}/?ref=${userId.slice(0, 8)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copiado!");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };
  return (
    <div className="rounded-2xl border border-primary/40 bg-card p-5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Seu link VIP</p>
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2">
        <code className="flex-1 truncate text-xs text-foreground">{link}</code>
        <button
          onClick={copy}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          aria-label="Copiar link"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Ganhe R$ 5,00 no Pix por cada amigo que ativar pela sua indicação.
      </p>
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

function VehicleImage({
  marca,
  modelo,
  ano,
  cor,
  alt,
}: {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  alt: string;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "fallback">("loading");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setState("loading");
    setUrl(null);
    if (!marca && !modelo) {
      setState("fallback");
      return;
    }
    fetchVehicleImageFn({ data: { marca, modelo, ano, cor } })
      .then((res) => {
        if (cancel) return;
        if (res.ok && res.url) {
          setUrl(res.url);
        } else {
          setState("fallback");
        }
      })
      .catch(() => {
        if (!cancel) setState("fallback");
      });
    return () => {
      cancel = true;
    };
  }, [marca, modelo, ano, cor]);


  return (
    <>
      {/* Spotlight neon azul (pulsa durante o loading) */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${
          state === "loading" ? "animate-pulse" : ""
        }`}
        style={{
          background:
            "radial-gradient(ellipse 60% 55% at 50% 78%, rgba(56,189,248,0.45) 0%, rgba(56,189,248,0.18) 35%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, transparent 30%, transparent 70%, hsl(var(--card)) 100%)",
        }}
      />

      {state === "loading" && (
        <div className="absolute inset-0 z-[2] flex items-center justify-center">
          <div className="h-20 w-40 animate-pulse rounded-2xl bg-primary/10" />
        </div>
      )}

      {state === "fallback" && (
        <img
          src={fallbackCarImg}
          alt={alt}
          width={1024}
          height={768}
          loading="lazy"
          className="relative z-[1] h-full w-full object-cover mix-blend-screen animate-in fade-in duration-500"
          style={{ filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.6))" }}
        />
      )}

      {url && state !== "fallback" && (
        <img
          src={url}
          alt={alt}
          width={1024}
          height={768}
          loading="lazy"
          onLoad={() => setState("loaded")}
          onError={() => setState("fallback")}
          className={`relative z-[1] h-full w-full rounded-2xl object-cover transition-opacity duration-500 ${
            state === "loaded" ? "opacity-100" : "opacity-0"
          }`}
          style={{
            filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.6))",
            WebkitMaskImage:
              "radial-gradient(ellipse 78% 78% at 50% 50%, #000 55%, rgba(0,0,0,0.65) 75%, transparent 100%)",
            maskImage:
              "radial-gradient(ellipse 78% 78% at 50% 50%, #000 55%, rgba(0,0,0,0.65) 75%, transparent 100%)",
          }}
        />
      )}
    </>
  );
}
