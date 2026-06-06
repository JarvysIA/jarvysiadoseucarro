import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Shield, Loader2, LogOut, Crown, Star, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/jarvys-logo.png";
import {
  listAdminUsersFn,
  setPlanTierFn,
  type AdminUserRow,
  type PlanTier,
} from "@/lib/admin-users.functions";

export const Route = createFileRoute("/master-admin")({
  head: () => ({
    meta: [
      { title: "Painel Master — Jarvys" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: MasterAdminPage,
});

const TIER_OPTIONS: { value: PlanTier; label: string; icon: React.ReactNode }[] = [
  { value: "free", label: "Normal", icon: <UserIcon className="h-3 w-3" /> },
  { value: "vip", label: "VIP", icon: <Star className="h-3 w-3" /> },
  { value: "super_vip", label: "Super VIP", icon: <Crown className="h-3 w-3" /> },
];

function MasterAdminPage() {
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<"checking" | "denied" | "ok">("checking");
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const listUsers = useServerFn(listAdminUsersFn);
  const setTier = useServerFn(setPlanTierFn);

  useEffect(() => {
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        navigate({ to: "/login", replace: true });
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("is_super_admin")
        .eq("id", session.session.user.id)
        .maybeSingle();
      const isSuper = Boolean((prof as { is_super_admin?: boolean } | null)?.is_super_admin);
      if (!isSuper) {
        setAuthState("denied");
        // redireciona para Home (com pequeno delay para o usuário ver — opcional)
        navigate({ to: "/app", replace: true });
        return;
      }
      setAuthState("ok");
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const { rows } = await listUsers();
      setRows(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar usuários.");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (p) =>
        p.nome.toLowerCase().includes(q) ||
        (p.whatsapp ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const handleChangeTier = async (userId: string, planTier: PlanTier) => {
    setUpdatingId(userId);
    try {
      await setTier({ data: { userId, planTier } });
      setRows((prev) =>
        prev.map((r) => (r.id === userId ? { ...r, plan_tier: planTier } : r)),
      );
      const label = TIER_OPTIONS.find((t) => t.value === planTier)?.label ?? planTier;
      toast.success(`Plano atualizado para ${label}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar plano.");
    } finally {
      setUpdatingId(null);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/welcome", replace: true });
  };

  if (authState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (authState === "denied") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <Shield className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground">
          Esta área é exclusiva para o CEO.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-5 pb-16 pt-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={logo} alt="Jarvys" className="h-8 w-8" />
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Master Admin
            </p>
            <h1 className="font-tech text-base font-bold text-primary">CONTROLE TOTAL</h1>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground"
          aria-label="Sair"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      <div className="mt-6 flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3">
        <Search className="h-4 w-4 text-primary" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome ou WhatsApp..."
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      <p className="mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">
        {filtered.length} usuário{filtered.length === 1 ? "" : "s"}
      </p>

      <ul className="mt-3 space-y-3">
        {loading && (
          <li className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </li>
        )}
        {!loading &&
          filtered.map((p) => {
            return (
              <li key={p.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.nome}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {p.whatsapp}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {p.vehicle_count} veículo{p.vehicle_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  {updatingId === p.id && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  )}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {TIER_OPTIONS.map((opt) => {
                    const active = p.plan_tier === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => !active && handleChangeTier(p.id, opt.value)}
                        disabled={updatingId === p.id}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[11px] font-semibold transition-all disabled:opacity-50 ${
                          active
                            ? opt.value === "super_vip"
                              ? "border-amber-400/60 bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgba(255,213,107,0.65)]"
                              : opt.value === "vip"
                                ? "glow-neon border-primary/60 bg-primary/10 text-primary"
                                : "border-foreground/30 bg-secondary text-foreground"
                            : "border-border bg-background/40 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt.icon}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        {!loading && filtered.length === 0 && (
          <li className="rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
            Nenhum usuário encontrado.
          </li>
        )}
      </ul>
    </div>
  );
}
