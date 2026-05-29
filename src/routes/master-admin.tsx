import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Shield, Loader2, Check, LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/jarvys-logo.png";

export const Route = createFileRoute("/master-admin")({
  head: () => ({
    meta: [
      { title: "Painel Master — Jarvys" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: MasterAdminPage,
});

type Profile = {
  id: string;
  nome: string;
  whatsapp: string;
  email: string | null;
  placa: string | null;
  status_usuario: "trial" | "ativo";
  permite_indicacao: boolean;
  created_at: string;
};

function MasterAdminPage() {
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<"checking" | "denied" | "ok">("checking");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        navigate({ to: "/login", replace: true });
        return;
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.session.user.id);
      const isAdmin = (roles ?? []).some((r) => r.role === "admin");
      if (!isAdmin) {
        setAuthState("denied");
        return;
      }
      setAuthState("ok");
      await refresh();
    })();
  }, [navigate]);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id,nome,whatsapp,email,placa,status_usuario,permite_indicacao,created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setProfiles((data as Profile[]) ?? []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.nome.toLowerCase().includes(q) ||
        (p.whatsapp ?? "").toLowerCase().includes(q),
    );
  }, [profiles, query]);

  const makeVip = async (id: string) => {
    setUpdating(id);
    const { error } = await supabase
      .from("profiles")
      .update({ status_usuario: "ativo", permite_indicacao: true })
      .eq("id", id);
    setUpdating(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Usuário promovido a VIP.");
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status_usuario: "ativo", permite_indicacao: true } : p,
      ),
    );
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
          Esta área é exclusiva para administradores.
        </p>
        <button
          onClick={() => navigate({ to: "/app" })}
          className="rounded-xl border border-border bg-card px-4 py-2 text-sm"
        >
          Voltar ao app
        </button>
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
            const isVip = p.status_usuario === "ativo";
            return (
              <li
                key={p.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.nome}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {p.whatsapp} {p.placa ? `· ${p.placa}` : ""}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                          isVip
                            ? "bg-primary/15 text-primary"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {isVip ? "VIP" : "Trial"}
                      </span>
                      {p.permite_indicacao && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                          Indicação ON
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => makeVip(p.id)}
                    disabled={isVip || updating === p.id}
                    className="glow-neon flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    {updating === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isVip ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : null}
                    {isVip ? "Já é VIP" : "Tornar VIP"}
                  </button>
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
