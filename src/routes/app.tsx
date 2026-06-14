import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Droplet, Thermometer, Gauge, Lock, Copy, Check, Sparkles, Car, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/jarvys-logo.png";
import fallbackCarImg from "@/assets/car-fallback.jpg";
import { supabase } from "@/integrations/supabase/client";
import { generateVehicleImageFn } from "@/lib/vehicle-image.functions";
import { ChatFab } from "@/components/ChatFab";
import { BottomNav } from "@/components/BottomNav";
import { AddVehicleModal, type AddedVehicle } from "@/components/AddVehicleModal";
import { DeleteVehicleModal } from "@/components/DeleteVehicleModal";
import { PaywallModal } from "@/components/PaywallModal";
import { ProfileSettingsModal } from "@/components/ProfileSettingsModal";
import { FipeCard } from "@/components/FipeCard";
import { MaintenancePanel, type MaintExpense, type MaintSaveInput } from "@/components/MaintenancePanel";
import { uploadReceiptImage } from "@/lib/despesas";
import {
  AirFilterIcon,
  BrakeDiscIcon,
} from "@/components/automotive-icons";
import {
  buildMaintenanceItems,
  computeStatus,
  formatRemainingKm,
  ITEM_TO_CATEGORIA,
  STATUS_LABEL_PT,
  type MaintItemKey,
  type MaintStatus,
  type VehicleMaintOverrides,
} from "@/lib/maintenance";
import { getActiveVehicleId, setActiveVehicleId } from "@/lib/active-vehicle";
import type { ProfileStatus } from "@/lib/profile-status";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Minha Garagem — Jarvys" }] }),
  component: AppPage,
});

const STATUS_CLASS: Record<MaintStatus, string> = {
  ok: "bg-[var(--status-ok)]",
  warn: "bg-[var(--status-warn)]",
  bad: "bg-[var(--status-bad)]",
};
const STATUS_RING: Record<MaintStatus, string> = {
  ok: "shadow-[0_0_18px_-2px_var(--status-ok)]",
  warn: "shadow-[0_0_18px_-2px_var(--status-warn)]",
  bad: "shadow-[0_0_18px_-2px_var(--status-bad)]",
};

type ItemDef = {
  key: MaintItemKey;
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
};

const ITEMS: ItemDef[] = [
  { key: "oleo", label: "Óleo do Motor", icon: (p) => <Droplet className={p.className} /> },
  { key: "filtros", label: "Filtros", icon: (p) => <AirFilterIcon className={p.className} /> },
  { key: "pastilhas", label: "Pastilhas", icon: (p) => <BrakeDiscIcon className={p.className} /> },
  { key: "arrefecimento", label: "Arrefecimento", icon: (p) => <Thermometer className={p.className} /> },
];

type Profile = {
  id: string;
  nome: string;
  status_usuario: ProfileStatus;
  permite_indicacao: boolean;
  trial_inicio: string;
  referrer_id: string | null;
  is_super_admin: boolean;
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
  km_ultima_troca_oleo: number | null;
  km_ultima_troca_filtros: number | null;
  km_ultima_troca_pastilhas: number | null;
  km_ultima_troca_arrefecimento: number | null;
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
  kmUltimaTrocaOleo: number | null;
  kmUltimaTrocaFiltros: number | null;
  kmUltimaTrocaPastilhas: number | null;
  kmUltimaTrocaArrefecimento: number | null;
};

// Cache em memória para renderização instantânea ao voltar para a Home
let cachedVehicles: UserVehicle[] | null = null;
let cachedProfile: Profile | null = null;

function AppPage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  const [loadingProfile, setLoadingProfile] = useState(!cachedProfile);
  const [vehicles, setVehicles] = useState<UserVehicle[]>(cachedVehicles ?? []);
  const initialSelectedId = useMemo(() => {
    const list = cachedVehicles ?? [];
    if (!list.length) return "";
    const saved = getActiveVehicleId();
    const found = saved ? list.find((v) => v.id === saved) : null;
    return found?.id ?? list[0].id;
  }, []);
  const [selectedId, setSelectedId] = useState<string>(initialSelectedId);
  const [addOpen, setAddOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const didInitialScrollRef = useRef(false);

  const handleAddClick = () => {
    // App é gratuito. O usuário pode cadastrar quantos veículos quiser;
    // o status VIP/ativação é por placa via PaywallModal.
    setAddOpen(true);
  };

  const handleAdded = (v: AddedVehicle) => {
    const newVehicle: UserVehicle = {
      id: v.id,
      marca: v.marca,
      modelo: v.modelo,
      year: v.ano || "—",
      color: v.cor || "—",
      plate: v.placa,
      km: v.km_atual ?? 0,
      chassi: v.chassi,
      fotoUrl: v.foto_url ?? null,
      kmUltimaTrocaOleo: null,
      kmUltimaTrocaFiltros: null,
      kmUltimaTrocaPastilhas: null,
      kmUltimaTrocaArrefecimento: null,
    };
    setVehicles((prev) => [...prev, newVehicle]);
    setSelectedId(v.id);
    // Rola para o novo card no próximo tick
    setTimeout(() => {
      const el = scrollerRef.current?.querySelector<HTMLElement>(
        `[data-vehicle-id="${v.id}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }, 50);
  };

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
          .select("id,nome,status_usuario,permite_indicacao,trial_inicio,referrer_id,is_super_admin")
          .eq("id", userId)
          .maybeSingle(),
        supabase
          .from("veiculos")
          .select("id,placa,marca,modelo,ano,cor,km_atual,chassi,foto_url,km_ultima_troca_oleo,km_ultima_troca_filtros,km_ultima_troca_pastilhas,km_ultima_troca_arrefecimento")
          .eq("user_id", userId)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
      ]);
      setProfile(prof as Profile | null);
      cachedProfile = (prof as Profile | null) ?? null;
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
          kmUltimaTrocaOleo: v.km_ultima_troca_oleo,
          kmUltimaTrocaFiltros: v.km_ultima_troca_filtros,
          kmUltimaTrocaPastilhas: v.km_ultima_troca_pastilhas,
          kmUltimaTrocaArrefecimento: v.km_ultima_troca_arrefecimento,
        };
      });
      setVehicles(mapped);
      cachedVehicles = mapped;
      if (mapped.length) {
        const saved = getActiveVehicleId();
        const idx = saved ? mapped.findIndex((v) => v.id === saved) : -1;
        setSelectedId((prev) => prev || (idx >= 0 ? mapped[idx].id : mapped[0].id));
      }
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

  // Centraliza o veículo ativo ANTES do paint (zero flicker).
  // Salto inicial usa useLayoutEffect; trocas posteriores de selectedId
  // são geralmente disparadas pelo scroll do usuário e não precisam reposicionar.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || vehicles.length === 0 || !selectedId) return;
    if (didInitialScrollRef.current) return;
    const node = el.querySelector<HTMLElement>(`[data-vehicle-id="${selectedId}"]`);
    if (!node) return;
    const target = node.offsetLeft - (el.clientWidth - node.offsetWidth) / 2;
    el.scrollLeft = Math.max(0, target);
    didInitialScrollRef.current = true;
  }, [vehicles, selectedId]);

  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? vehicles[0],
    [selectedId, vehicles],
  );

  // Sincroniza o veículo selecionado com o store global (usado por Despesas/Revisões)
  useEffect(() => {
    setActiveVehicleId(selected?.id ?? null);
  }, [selected?.id]);

  // Trial = único status bloqueado; ativo/vip/enterprise têm acesso liberado.
  const isTrial = !profile || profile.status_usuario === "trial";
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
      {!loadingProfile && isTrial && (() => {
        const expired = daysLeft <= 0;
        return (
          <button
            type="button"
            onClick={() => setActivateOpen(true)}
            className={
              "sticky top-0 z-20 flex w-full flex-col items-center justify-center gap-0.5 border-b px-4 py-2 text-center text-[11px] font-medium transition-colors " +
              (expired
                ? "border-destructive/50 text-destructive hover:bg-destructive/15"
                : "border-primary/30 text-primary hover:bg-primary/15")
            }
            style={{
              background: expired
                ? "rgba(220,38,38,0.12)"
                : "rgba(56,189,248,0.08)",
              backdropFilter: "blur(8px)",
            }}
          >
            <div className="flex items-center gap-2">
              {expired ? (
                <>
                  <span aria-hidden>🤖</span>
                  Reative sua IA por apenas R$ 29,90 (Pagamento Único)
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  ✨ {daysLeft} dias grátis · Ative por apenas R$ 29,90 (Pagamento Único)
                </>
              )}
            </div>
            {!expired && hasReferrer && (
              <span className="text-[10px] font-semibold text-primary/90">
                Desconto de indicado aplicado 🎉
              </span>
            )}
          </button>
        );
      })()}

      {/* Header */}
      <header className="flex items-center justify-between px-6 pt-8">
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="flex items-center gap-3 rounded-2xl text-left transition-opacity active:opacity-80"
          aria-label="Abrir configurações do perfil"
        >
          <img src={logo} alt="Jarvys" width={40} height={40} className="h-10 w-10 object-contain" />
          <div>
            <p className="text-xs text-muted-foreground">Olá,</p>
            <h1 className="flex items-center gap-2 text-lg font-semibold leading-tight">
              {profile?.nome?.split(" ")[0] || "Motorista"}
            </h1>
          </div>
        </button>
        <div className="h-11 w-11" />
      </header>

      <section className="mt-8 px-6">
        <h2 className="text-base font-semibold">Minha Garagem</h2>
      </section>

      <section className="mt-4">
        {loadingProfile && vehicles.length === 0 ? (
          <div className="px-6">
            <div className="h-64 w-[82%] animate-pulse rounded-3xl border border-border bg-card/40" />
          </div>
        ) : vehicles.length === 0 ? (
          <div className="mx-6">
            <button
              type="button"
              onClick={handleAddClick}
              className="glow-neon flex w-full flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-primary/40 bg-card/40 p-10 text-center transition-colors hover:border-primary/70"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Plus className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Adicionar meu primeiro veículo
              </p>
              <p className="text-[11px] text-muted-foreground">
                Cadastre pela placa em segundos.
              </p>
            </button>
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
                    className={`w-full w-[82%] shrink-0 snap-center flex flex-col md:flex-row overflow-hidden rounded-3xl border bg-card transition-all ${
                      active ? "glow-neon border-primary/40" : "border-border opacity-70"
                    }`}
                  >
                    <div className="relative w-full h-56 md:w-[45%] md:h-full overflow-hidden bg-card md:bg-transparent flex-shrink-0">
                      <VehicleImage
                        vehicleId={v.id}
                        cachedUrl={v.fotoUrl}
                        marca={v.marca}
                        modelo={v.modelo}
                        ano={v.year}
                        cor={v.color}
                        alt={`${v.marca} ${v.modelo} ${v.color}`}
                        onResolved={(url) =>
                          setVehicles((prev) =>
                            prev.map((x) => (x.id === v.id ? { ...x, fotoUrl: url } : x)),
                          )
                        }
                      />

                      <span className="absolute top-3 left-3 z-[3] rounded-full bg-background/70 px-2.5 py-1 text-[10px] font-medium tracking-wider text-primary backdrop-blur">
                        {v.plate}
                      </span>
                    </div>
                    <div className="w-full md:w-[55%] flex flex-col justify-center p-4 md:p-6">
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

              {/* Card "+" para adicionar novo veículo */}
              <button
                type="button"
                onClick={handleAddClick}
                aria-label="Adicionar veículo"
                className="group flex w-[82%] shrink-0 snap-center flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-primary/40 bg-card/40 p-6 text-center transition-colors hover:border-primary/70 hover:bg-card/60"
                style={{ minHeight: "16rem" }}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                  <Plus className="h-7 w-7" />
                </div>
                <p className="text-sm font-semibold text-foreground">
                  Adicionar Veículo
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Cadastre pela placa em segundos
                </p>
              </button>
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

      <AddVehicleModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={handleAdded}
      />


      <PaywallModal open={activateOpen} onClose={() => setActivateOpen(false)} vehicleId={selectedId} />

      <ProfileSettingsModal open={profileOpen} onClose={() => setProfileOpen(false)} />


      {selected && (
        <VehicleStatusSection
          vehicleId={selected.id}
          placa={selected.plate}
          ano={selected.year}
          kmAtual={selected.km}
          overrides={{
            km_ultima_troca_oleo: selected.kmUltimaTrocaOleo,
            km_ultima_troca_filtros: selected.kmUltimaTrocaFiltros,
            km_ultima_troca_pastilhas: selected.kmUltimaTrocaPastilhas,
            km_ultima_troca_arrefecimento: selected.kmUltimaTrocaArrefecimento,
          }}
          onKmChange={(km) =>
            setVehicles((prev) =>
              prev.map((x) => (x.id === selected.id ? { ...x, km } : x)),
            )
          }
          onMaintenanceSaved={(key, kmRegistrada) =>
            setVehicles((prev) =>
              prev.map((x) => {
                if (x.id !== selected.id) return x;
                if (key === "oleo") return { ...x, kmUltimaTrocaOleo: kmRegistrada };
                if (key === "filtros") return { ...x, kmUltimaTrocaFiltros: kmRegistrada };
                if (key === "pastilhas") return { ...x, kmUltimaTrocaPastilhas: kmRegistrada };
                if (key === "arrefecimento") return { ...x, kmUltimaTrocaArrefecimento: kmRegistrada };
                return x;
              }),
            )
          }
          onDeleted={() => {
            const removedId = selected.id;
            setVehicles((prev) => {
              const next = prev.filter((x) => x.id !== removedId);
              cachedVehicles = next;
              const nextId = next[0]?.id ?? "";
              setSelectedId(nextId);
              setActiveVehicleId(nextId || null);
              return next;
            });
            navigate({ to: "/app", replace: true });
          }}
        />
      )}

      {/* Indicações */}
      <section className="mt-8 px-6">
        <h2 className="text-base font-semibold">Indicações</h2>
        <div className="mt-3">
          {profile?.permite_indicacao ? (
            <ReferralUnlocked userId={profile?.id ?? ""} />
          ) : (
            <ReferralLocked price={activationPrice} hasReferrer={hasReferrer} onActivate={() => setActivateOpen(true)} />
          )}
        </div>
      </section>

      <ChatFab />
      <BottomNav />
    </div>
  );
}

function ReferralLocked({
  price,
  hasReferrer,
  onActivate,
}: {
  price: string;
  hasReferrer: boolean;
  onActivate: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <Lock className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Seu link de indicação está bloqueado</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Ative sua garagem por{" "}
            <span className="font-semibold text-primary">R$ 29,90</span>{" "}
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
            onClick={onActivate}
            className="glow-neon mt-3 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Ativar por R$ 29,90
          </button>
        </div>
      </div>
    </div>
  );
}

function ReferralUnlocked({ userId }: { userId: string }) {
  const [codigo, setCodigo] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!userId) return;
      const { data } = await supabase
        .from("profiles")
        .select("codigo_indicacao")
        .eq("id", userId)
        .maybeSingle();
      if (!cancel) setCodigo((data?.codigo_indicacao as string | null) ?? null);
    })();
    return () => {
      cancel = true;
    };
  }, [userId]);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://jarvys.app";
  const link = codigo ? `${origin}/?ref=${codigo}` : "";

  const copy = async (text: string, which: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === "code") {
        setCopiedCode(true);
        toast.success("Código copiado!");
        setTimeout(() => setCopiedCode(false), 1800);
      } else {
        setCopiedLink(true);
        toast.success("Link copiado!");
        setTimeout(() => setCopiedLink(false), 1800);
      }
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <div className="rounded-2xl border border-primary/40 bg-card p-5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Seu código de indicação
      </p>
      <div className="mt-2 rounded-xl border border-primary/50 bg-gradient-to-br from-primary/10 to-transparent p-4">
        <div className="flex items-center justify-between gap-3">
          <code className="flex-1 truncate text-lg font-bold tracking-wider text-primary">
            {codigo ?? "..."}
          </code>
          <button
            type="button"
            onClick={() => codigo && copy(codigo, "code")}
            disabled={!codigo}
            className="glow-neon inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {copiedCode ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedCode ? "Copiado" : "Copiar Código"}
          </button>
        </div>
      </div>

      <p className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        Ou compartilhe o link
      </p>
      <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2">
        <code className="flex-1 truncate text-xs text-foreground">{link || "..."}</code>
        <button
          onClick={() => link && copy(link, "link")}
          disabled={!link}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground disabled:opacity-50"
          aria-label="Copiar link"
        >
          {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Ganhe R$ 5,00 no Pix por cada amigo que ativar pela sua indicação.
      </p>
    </div>
  );
}

function Legend({ status }: { status: MaintStatus }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${STATUS_CLASS[status]}`} />
      {STATUS_LABEL_PT[status]}
    </span>
  );
}

type ItemOverride = {
  ultima_troca_km: number;
  ultima_troca_data: string;
};

function VehicleStatusSection({
  vehicleId,
  placa,
  ano,
  kmAtual,
  overrides: dbOverrides,
  onKmChange,
  onMaintenanceSaved,
  onDeleted,
}: {
  vehicleId: string;
  placa: string;
  ano: string;
  kmAtual: number;
  overrides: VehicleMaintOverrides;
  onKmChange: (km: number) => void;
  onMaintenanceSaved: (key: MaintItemKey, kmRegistrada: number) => void;
  onDeleted: () => void;
}) {
  const [editingKm, setEditingKm] = useState(false);
  const [draftKm, setDraftKm] = useState(String(kmAtual));
  const [openItemKey, setOpenItemKey] = useState<MaintItemKey | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Histórico de despesas por veículo + item — preenchido após salvar.
  const [expenses, setExpenses] = useState<
    Record<string, Partial<Record<MaintItemKey, MaintExpense[]>>>
  >({});

  // Itens reais — consomem as colunas km_ultima_troca_* da tabela veiculos.
  const items = useMemo(
    () => buildMaintenanceItems(vehicleId, kmAtual, dbOverrides),
    [vehicleId, kmAtual, dbOverrides],
  );

  const computed = useMemo(
    () => items.map((it) => computeStatus(it, kmAtual)),
    [items, kmAtual],
  );

  const openComputed = openItemKey
    ? computed.find((c) => c.item.key === openItemKey) ?? null
    : null;
  const openExpenses = openItemKey
    ? expenses[vehicleId]?.[openItemKey] ?? []
    : [];

  const saveKm = async () => {
    const n = parseInt(draftKm.replace(/\D/g, ""), 10);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("KM inválida");
      return;
    }
    // Anti-fraude: nova KM não pode ser menor que a atual registrada,
    // exceto quando o veículo ainda não tem KM (primeiro cadastro).
    if (kmAtual > 0 && n < kmAtual) {
      toast.error("Atenção: A nova quilometragem não pode ser menor que a atual registrada.");
      return;
    }
    const { error } = await supabase
      .from("veiculos")
      .update({ km_atual: n })
      .eq("id", vehicleId);
    if (error) {
      console.error("[saveKm]", error);
      toast.error("Não foi possível atualizar a KM.");
      return;
    }
    onKmChange(n);
    setEditingKm(false);
    toast.success("KM atualizada!");
  };

  const handleSaveMaintenance = async (key: MaintItemKey, payload: MaintSaveInput) => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user.id;
    if (!userId) {
      toast.error("Sessão expirada.");
      return;
    }

    // 1) Upload da nota (se houver) → bucket privado 'receipts'
    let receiptPath: string | null = null;
    if (payload.file) {
      receiptPath = await uploadReceiptImage(userId, vehicleId, payload.file);
    }

    // Sobrescreve a categoria de acordo com o item selecionado para que a
    // trigger `atualizar_revisao_veiculo` no banco consiga identificar e
    // atualizar a coluna km_ultima_troca_* correspondente.
    const categoriaFinal =
      (ITEM_TO_CATEGORIA[key] as typeof payload.categoria | undefined) ?? payload.categoria;

    // 2) Insere a despesa no banco
    const { error: insErr } = await supabase.from("despesas").insert({
      user_id: userId,
      vehicle_id: vehicleId,
      data: payload.data_servico,
      valor: payload.valor_total,
      categoria: categoriaFinal,
      descricao: payload.descricao,
      km_registro: payload.km_registrada,
      receipt_image_url: receiptPath,
    });
    if (insErr) {
      console.error("[despesas insert]", insErr);
      throw new Error("Não foi possível salvar a despesa.");
    }

    // 3) Atualiza a KM do veículo no banco se a nota tem KM maior
    if (payload.km_registrada > kmAtual) {
      await supabase
        .from("veiculos")
        .update({ km_atual: payload.km_registrada })
        .eq("id", vehicleId);
      onKmChange(payload.km_registrada);
    }

    // 4) Notifica o pai para atualizar o estado do veículo (km_ultima_troca_*)
    //    — a trigger no banco já persistiu o valor; aqui só refletimos na UI.
    onMaintenanceSaved(key, payload.km_registrada);

    // 5) Injeta a despesa no histórico do item — UI imediata no painel.
    setExpenses((prev) => {
      const veh = prev[vehicleId] || {};
      const list = veh[key] || [];
      const next: MaintExpense = {
        id: `${Date.now()}`,
        data_servico: payload.data_servico,
        valor_total: payload.valor_total,
        descricao: payload.descricao,
      };
      return {
        ...prev,
        [vehicleId]: { ...veh, [key]: [next, ...list] },
      };
    });
  };

  return (
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

        {/* KM atual — editável para testar o semáforo */}
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2">
          <Gauge className="h-4 w-4 text-primary" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            KM Atual
          </span>
          {editingKm ? (
            <>
              <input
                autoFocus
                inputMode="numeric"
                value={draftKm}
                onChange={(e) => setDraftKm(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveKm();
                  if (e.key === "Escape") {
                    setDraftKm(String(kmAtual));
                    setEditingKm(false);
                  }
                }}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={saveKm}
                className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
              >
                Salvar
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 text-sm font-semibold text-foreground">
                {kmAtual.toLocaleString("pt-BR")} km
              </span>
              <button
                type="button"
                onClick={() => {
                  setDraftKm(String(kmAtual));
                  setEditingKm(true);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
                Editar
              </button>
            </>
          )}
        </div>
      </section>

      <section className="mt-4 px-6">
        <div className="grid grid-cols-2 gap-3">
          {ITEMS.map((it) => {
            const data = computed.find((c) => c.item.key === it.key);
            if (!data) return null;
            return (
              <button
                type="button"
                key={it.key}
                onClick={() => setOpenItemKey(it.key)}
                className="relative rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 active:scale-[0.99]"
              >
                <div className="flex items-start justify-between">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary transition-colors"
                    style={{ color: `var(--status-${data.status})` }}
                  >
                    {it.icon({ className: "h-5 w-5" })}
                  </div>
                  <span
                    className={`h-3 w-3 rounded-full ${STATUS_CLASS[data.status]} ${STATUS_RING[data.status]}`}
                    aria-label={STATUS_LABEL_PT[data.status]}
                  />
                </div>
                <p className="mt-4 text-sm font-medium text-foreground">{it.label}</p>
                <p
                  className="mt-1 text-[11px]"
                  style={{ color: `var(--status-${data.status})` }}
                >
                  {formatRemainingKm(data.remainingKm)}
                </p>
                <p
                  className="mt-2 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: `var(--status-${data.status})` }}
                >
                  {STATUS_LABEL_PT[data.status]}
                </p>
              </button>
            );
          })}
        </div>

        <FipeCard vehicleId={vehicleId} placa={placa} ano={ano} />
      </section>

      {/* Zona perigosa — Soft delete do veículo */}
      <section className="mt-8 px-6">
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15"
        >
          <Trash2 className="h-4 w-4" />
          Excluir Veículo
        </button>
      </section>

      <DeleteVehicleModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        vehicleId={vehicleId}
        placa={placa}
        onDeleted={onDeleted}
      />

      <MaintenancePanel
        open={!!openItemKey}
        onClose={() => setOpenItemKey(null)}
        computed={openComputed}
        kmAtual={kmAtual}
        expenses={openExpenses}
        onSave={(payload) => {
          if (openItemKey) handleSaveMaintenance(openItemKey, payload);
        }}
      />
    </>
  );
}

function VehicleImage({
  vehicleId,
  cachedUrl,
  marca,
  modelo,
  ano,
  cor,
  alt,
  onResolved,
}: {
  vehicleId: string;
  cachedUrl: string | null;
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  alt: string;
  onResolved: (url: string) => void;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "fallback">("loading");
  const [url, setUrl] = useState<string | null>(cachedUrl);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancel = false;
    // Cache hit (e não é uma tentativa de retry): usa imagem do banco.
    if (cachedUrl && retryTick === 0) {
      setUrl(cachedUrl);
      setState("loading"); // aguarda onLoad da <img>
      return;
    }
    setState("loading");
    setUrl(null);
    if (!marca && !modelo) {
      setState("fallback");
      return;
    }
    generateVehicleImageFn({ data: { vehicleId, marca, modelo, ano, cor } })
      .then(async (res) => {
        if (cancel) return;
        if (res.ok && res.url) {
          setUrl(res.url);
          onResolved(res.url);
          try {
            await supabase
              .from("veiculos")
              .update({ foto_url: res.url })
              .eq("id", vehicleId);
          } catch {
            /* falha silenciosa */
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, retryTick]);

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Limpa foto_url no banco e refaz o pedido à IA.
    try {
      await supabase.from("veiculos").update({ foto_url: null }).eq("id", vehicleId);
    } catch {
      /* segue mesmo se falhar */
    }
    toast.info("Gerando nova imagem do veículo...");
    onResolved("");
    setRetryTick((t) => t + 1);
  };

  return (
    <>
      {state === "loading" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-pulse"
          style={{
            background:
              "radial-gradient(ellipse 60% 55% at 50% 78%, rgba(56,189,248,0.45) 0%, rgba(56,189,248,0.18) 35%, transparent 70%)",
          }}
        />
      )}

      {state === "loading" && (
        <div className="absolute inset-0 z-[2] flex items-center justify-center">
          <div className="h-20 w-40 animate-pulse rounded-2xl bg-primary/10" />
        </div>
      )}

      {state === "fallback" && (
        <>
          <img
            src={fallbackCarImg}
            alt={alt}
            width={1024}
            height={768}
            loading="lazy"
            className="relative z-[1] w-full h-full object-cover md:object-contain p-0 md:p-4 mix-blend-screen animate-in fade-in duration-500"
            style={{ filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.6))" }}
          />
          {/* Botão Inteligente de Retry: visível apenas no fallback */}
          <button
            type="button"
            onClick={handleRetry}
            aria-label="Atualizar imagem do veículo"
            className="glow-neon absolute bottom-3 right-3 z-[3] inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-background/80 px-3 py-1.5 text-[11px] font-semibold text-primary backdrop-blur transition-colors hover:bg-background"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar Imagem
          </button>
        </>
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
          className={`relative z-[1] w-full h-full object-cover md:object-contain p-0 md:p-4 mix-blend-lighten transition-opacity duration-500 ${
            state === "loaded" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </>
  );
}
