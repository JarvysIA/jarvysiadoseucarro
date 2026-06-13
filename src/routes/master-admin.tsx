import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Shield, Loader2, LogOut, Car } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/jarvys-logo.png";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listAdminUsersFn,
  updateUserStatusFn,
  type AdminUserRow,
  type PlanStatus,
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

const STATUS_OPTIONS: { value: PlanStatus; label: string }[] = [
  { value: "trial", label: "Trial" },
  { value: "ativo", label: "Ativo" },
  { value: "vip", label: "VIP" },
  { value: "enterprise", label: "Enterprise" },
];

function MasterAdminPage() {
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<"checking" | "denied" | "ok">("checking");
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const listUsers = useServerFn(listAdminUsersFn);
  const updateStatus = useServerFn(updateUserStatusFn);

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

  const handleStatusChange = async (row: AdminUserRow, status: PlanStatus) => {
    if (status === row.status_usuario) return;
    setSavingId(row.id);
    // Optimistic
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status_usuario: status } : r)));
    try {
      await updateStatus({ data: { userId: row.id, status } });
      toast.success(`Plano atualizado para ${status.toUpperCase()}.`);
    } catch (err) {
      // Rollback
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status_usuario: row.status_usuario } : r)),
      );
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar plano.");
    } finally {
      setSavingId(null);
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
        <p className="text-sm text-muted-foreground">Esta área é exclusiva para o CEO.</p>
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

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          Nenhum usuário encontrado.
        </div>
      ) : (
        <Accordion type="multiple" className="mt-3 space-y-3">
          {filtered.map((p) => (
            <AccordionItem
              key={p.id}
              value={p.id}
              className="rounded-2xl border border-border bg-card px-4 [&_[data-state]]:border-0"
            >
              <AccordionTrigger className="py-3 hover:no-underline">
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pr-3 text-left">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.nome}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {p.whatsapp}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {p.vehicles.length} veículo{p.vehicles.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      p.status_usuario === "trial"
                        ? "border-border text-muted-foreground"
                        : "border-primary/40 bg-primary/10 text-primary"
                    }`}
                  >
                    {p.status_usuario}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="space-y-4">
                  <section>
                    <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                      Veículos
                    </p>
                    {p.vehicles.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Nenhum veículo cadastrado.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {p.vehicles.map((v) => (
                          <li
                            key={v.id}
                            className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs"
                          >
                            <Car className="h-3.5 w-3.5 text-primary" />
                            <span className="flex-1 truncate">
                              {[v.marca, v.modelo].filter(Boolean).join(" ") || "Veículo"}
                            </span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {v.placa}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                      Controle de Plano
                    </p>
                    <Select
                      value={p.status_usuario}
                      onValueChange={(v) => handleStatusChange(p, v as PlanStatus)}
                      disabled={savingId === p.id}
                    >
                      <SelectTrigger className="h-10 bg-background/40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {savingId === p.id && (
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
                      </p>
                    )}
                  </section>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
