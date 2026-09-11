import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Shield, Loader2, LogOut, Car, Trash2 } from "lucide-react";
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
  createManualCostEntryFn,
  deleteManualCostEntryFn,
  getFinancialSummaryFn,
  getOperationalHealthFn,
  getPlateApiUsageFn,
  listAdminUsersFn,
  listAuditLogFn,
  updateUserStatusFn,
  type AdminUserRow,
  type AuditLogRow,
  type FinancialSummary,
  type OperationalHealth,
  type PlanStatus,
  type PlateApiUsage,
} from "@/lib/admin-users.functions";
import { useEnforceAccountActive } from "@/lib/use-enforce-account-active";

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

const AUDIT_ACTION_LABELS: Record<string, string> = {
  user_status_updated: "Alteração de plano",
  account_deactivated: "Conta desativada",
};

const REVENUE_TYPE_LABELS: Record<string, string> = {
  ativacao: "Ativação de veículo",
  historico: "Histórico FIPE",
};

const AI_USAGE_TYPE_LABELS: Record<string, string> = {
  ocr_receipt: "OCR de nota",
  dr_jarvys_chat: "Dr. Jarvys (chat)",
  classify_expense_text: "Classificação de despesa",
};

const CRON_JOB_LABELS: Record<string, string> = {
  "fipe-monthly-refresh": "Atualização FIPE mensal",
  whatsapp_process_inbound_every_minute: "WhatsApp — recebimento",
  whatsapp_send_outbound_every_minute: "WhatsApp — envio",
  "verificar-pagamentos-pix-5min": "Verificação de pagamentos",
  whatsapp_process_orchestrator_every_minute: "WhatsApp — orquestrador",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pago: "Pago",
  expirado: "Expirado",
  pendente: "Pendente",
};

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function cronStatusColor(job: { active: boolean; lastStatus: string | null }): string {
  if (!job.active || job.lastStatus === "failed") return "text-destructive";
  if (job.lastStatus === "succeeded") return "text-emerald-500";
  return "text-muted-foreground";
}

function MasterAdminPage() {
  useEnforceAccountActive();
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<"checking" | "denied" | "ok">("checking");
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "usuarios" | "auditoria" | "financeiro" | "monitoramento"
  >("usuarios");
  const [auditRows, setAuditRows] = useState<AuditLogRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [financial, setFinancial] = useState<FinancialSummary | null>(null);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [financialLoaded, setFinancialLoaded] = useState(false);
  const [plateUsage, setPlateUsage] = useState<PlateApiUsage | null>(null);
  const [operational, setOperational] = useState<OperationalHealth | null>(null);
  const [operationalLoading, setOperationalLoading] = useState(false);
  const [operationalLoaded, setOperationalLoaded] = useState(false);
  const [newCostCategory, setNewCostCategory] = useState("");
  const [newCostAmount, setNewCostAmount] = useState("");
  const [newCostNote, setNewCostNote] = useState("");
  const [addingCost, setAddingCost] = useState(false);
  const [deletingCostId, setDeletingCostId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const listUsers = useServerFn(listAdminUsersFn);
  const updateStatus = useServerFn(updateUserStatusFn);
  const listAudit = useServerFn(listAuditLogFn);
  const getFinancialSummary = useServerFn(getFinancialSummaryFn);
  const createManualCostEntry = useServerFn(createManualCostEntryFn);
  const deleteManualCostEntry = useServerFn(deleteManualCostEntryFn);
  const getPlateApiUsage = useServerFn(getPlateApiUsageFn);
  const getOperationalHealth = useServerFn(getOperationalHealthFn);

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

  const refreshAudit = async () => {
    setAuditLoading(true);
    try {
      const { rows } = await listAudit();
      setAuditRows(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar auditoria.");
    } finally {
      setAuditLoading(false);
      setAuditLoaded(true);
    }
  };

  useEffect(() => {
    if (activeTab === "auditoria" && !auditLoaded) {
      void refreshAudit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, auditLoaded]);

  const refreshFinancial = async () => {
    setFinancialLoading(true);
    try {
      const [summary, usage] = await Promise.all([
        getFinancialSummary({ data: {} }),
        getPlateApiUsage(),
      ]);
      setFinancial(summary);
      setPlateUsage(usage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar dados financeiros.");
    } finally {
      setFinancialLoading(false);
      setFinancialLoaded(true);
    }
  };

  useEffect(() => {
    if (activeTab === "financeiro" && !financialLoaded) {
      void refreshFinancial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, financialLoaded]);

  const refreshOperational = async () => {
    setOperationalLoading(true);
    try {
      const health = await getOperationalHealth();
      setOperational(health);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar monitoramento.");
    } finally {
      setOperationalLoading(false);
      setOperationalLoaded(true);
    }
  };

  useEffect(() => {
    if (activeTab === "monitoramento" && !operationalLoaded) {
      void refreshOperational();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, operationalLoaded]);

  const addCost = async () => {
    const amount = Number(newCostAmount.replace(",", "."));
    if (!newCostCategory.trim() || !(amount > 0) || !financial) {
      toast.error("Preencha categoria e valor (maior que zero).");
      return;
    }
    setAddingCost(true);
    try {
      await createManualCostEntry({
        data: {
          category: newCostCategory.trim(),
          amount,
          competencia: financial.competencia,
          note: newCostNote.trim() || undefined,
        },
      });
      setNewCostCategory("");
      setNewCostAmount("");
      setNewCostNote("");
      toast.success("Custo adicionado.");
      await refreshFinancial();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao adicionar custo.");
    } finally {
      setAddingCost(false);
    }
  };

  const removeCost = async (id: string) => {
    setDeletingCostId(id);
    try {
      await deleteManualCostEntry({ data: { id } });
      setConfirmDeleteId(null);
      toast.success("Custo removido.");
      await refreshFinancial();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover custo.");
    } finally {
      setDeletingCostId(null);
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

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("usuarios")}
          className={
            activeTab === "usuarios"
              ? "glow-neon flex-1 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-2.5 text-sm font-semibold text-primary-foreground"
              : "flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-muted-foreground"
          }
        >
          Usuários
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("auditoria")}
          className={
            activeTab === "auditoria"
              ? "glow-neon flex-1 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-2.5 text-sm font-semibold text-primary-foreground"
              : "flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-muted-foreground"
          }
        >
          Auditoria
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("financeiro")}
          className={
            activeTab === "financeiro"
              ? "glow-neon flex-1 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-2.5 text-sm font-semibold text-primary-foreground"
              : "flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-muted-foreground"
          }
        >
          Financeiro
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("monitoramento")}
          className={
            activeTab === "monitoramento"
              ? "glow-neon flex-1 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-2.5 text-sm font-semibold text-primary-foreground"
              : "flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-muted-foreground"
          }
        >
          Monitoramento
        </button>
      </div>

      {activeTab === "monitoramento" ? (
        <div className="mt-4 space-y-5">
          {operationalLoading || !operational ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <section>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Saúde dos crons
                </p>
                <ul className="space-y-2">
                  {operational.crons.map((job) => (
                    <li
                      key={job.jobid}
                      className="rounded-2xl border border-border bg-card p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">
                          {CRON_JOB_LABELS[job.jobname] ?? job.jobname}
                        </p>
                        <span className={`shrink-0 text-xs font-semibold ${cronStatusColor(job)}`}>
                          {!job.active
                            ? "Inativo"
                            : job.lastStatus === "succeeded"
                              ? "OK"
                              : job.lastStatus === "failed"
                                ? "Falhou"
                                : "Nunca rodou"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {job.lastRun
                          ? `Última execução: ${new Date(job.lastRun).toLocaleString("pt-BR")}`
                          : "Sem execuções registradas."}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Pagamentos
                </p>
                <div className="rounded-2xl border border-border bg-card p-4">
                  {operational.payments.byStatus.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum pagamento registrado.</p>
                  ) : (
                    <ul className="space-y-1">
                      {operational.payments.byStatus.map((s) => (
                        <li
                          key={s.status}
                          className="flex items-center justify-between text-xs text-muted-foreground"
                        >
                          <span>{PAYMENT_STATUS_LABELS[s.status] ?? s.status}</span>
                          <span className="text-foreground">{s.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {operational.payments.stuckPendingCount > 0 && (
                    <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2">
                      <p className="text-[11px] text-destructive">
                        {operational.payments.stuckPendingCount} pagamento
                        {operational.payments.stuckPendingCount === 1 ? "" : "s"} pendente
                        {operational.payments.stuckPendingCount === 1 ? "" : "s"} há mais de 1h —
                        possível travamento no fluxo de confirmação.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Atividade WhatsApp
                </p>
                <div className="rounded-2xl border border-border bg-card p-4">
                  <ul className="space-y-1">
                    <li className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Fila de recebimento</span>
                      <span className="text-foreground">{operational.whatsappActivity.queuedInbound}</span>
                    </li>
                    <li className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Fila de envio</span>
                      <span className="text-foreground">{operational.whatsappActivity.queuedOutbound}</span>
                    </li>
                    <li className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Mensagens (últimas 24h)</span>
                      <span className="text-foreground">{operational.whatsappActivity.last24hMessages}</span>
                    </li>
                  </ul>
                  <p className="mt-3 text-[10px] text-muted-foreground">
                    Sem atividade significativa até a instância Z-API ser conectada.
                  </p>
                </div>
              </section>
            </>
          )}
        </div>
      ) : activeTab === "financeiro" ? (
        <div className="mt-4 space-y-5">
          {financialLoading || !financial ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <section>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Receita do mês
                </p>
                <div className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-lg font-bold text-foreground">
                    {formatBRL(financial.totalRevenue)}
                  </p>
                  {financial.revenueByType.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Nenhuma receita registrada neste mês.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {financial.revenueByType.map((r) => (
                        <li
                          key={r.tipo}
                          className="flex items-center justify-between text-xs text-muted-foreground"
                        >
                          <span>{REVENUE_TYPE_LABELS[r.tipo] ?? r.tipo}</span>
                          <span className="text-foreground">{formatBRL(r.valor)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Custos do mês
                </p>
                <div className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-lg font-bold text-foreground">
                    {formatBRL(financial.totalCosts)}
                  </p>
                  {financial.costs.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Nenhum custo lançado neste mês.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {financial.costs.map((c) => (
                        <li
                          key={c.id}
                          className="rounded-xl border border-border/60 bg-background/40 px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-foreground">
                                {c.category}
                              </p>
                              {c.note && (
                                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                  {c.note}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-xs font-semibold text-foreground">
                                {formatBRL(c.amount)}
                              </span>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(c.id)}
                                className="text-muted-foreground hover:text-destructive"
                                aria-label="Excluir custo"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          {confirmDeleteId === c.id && (
                            <div className="mt-2 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2">
                              <p className="flex-1 text-[11px] text-foreground">Excluir este custo?</p>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={deletingCostId === c.id}
                                className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground disabled:opacity-50"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => removeCost(c.id)}
                                disabled={deletingCostId === c.id}
                                className="flex items-center gap-1 rounded-lg bg-destructive px-2 py-1 text-[11px] font-semibold text-destructive-foreground disabled:opacity-60"
                              >
                                {deletingCostId === c.id && (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                )}
                                Confirmar
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                    <input
                      type="text"
                      value={newCostCategory}
                      onChange={(e) => setNewCostCategory(e.target.value)}
                      placeholder="Categoria (ex: Hostinger)"
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      value={newCostAmount}
                      onChange={(e) => setNewCostAmount(e.target.value)}
                      placeholder="Valor (R$)"
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                    />
                    <input
                      type="text"
                      value={newCostNote}
                      onChange={(e) => setNewCostNote(e.target.value)}
                      placeholder="Nota (opcional)"
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={addCost}
                      disabled={addingCost}
                      className="glow-neon flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {addingCost && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Adicionar
                    </button>
                  </div>
                </div>
              </section>

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Resultado do mês
                </p>
                <div
                  className={`rounded-2xl border p-4 text-lg font-bold ${
                    financial.result >= 0
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                      : "border-destructive/40 bg-destructive/10 text-destructive"
                  }`}
                >
                  {formatBRL(financial.result)}
                </div>
              </section>

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Consultas de Placa/FIPE
                </p>
                <div className="rounded-2xl border border-border bg-card p-4">
                  {plateUsage ? (
                    <>
                      <p
                        className={`text-lg font-bold ${
                          plateUsage.todayCount >= 45
                            ? "text-destructive"
                            : plateUsage.todayCount >= 35
                              ? "text-amber-500"
                              : "text-foreground"
                        }`}
                      >
                        Hoje: {plateUsage.todayCount} / 50
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Este mês: {plateUsage.monthCount} consulta
                        {plateUsage.monthCount === 1 ? "" : "s"}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sem dados.</p>
                  )}
                  <p className="mt-3 text-[10px] text-muted-foreground">
                    Sem conversão para R$ — o custo depende do plano contratado.
                  </p>
                </div>
              </section>

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Uso de IA este mês
                </p>
                <div className="rounded-2xl border border-border bg-card p-4">
                  {financial.aiUsageByType.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum uso de IA registrado neste mês.</p>
                  ) : (
                    <ul className="space-y-1">
                      {financial.aiUsageByType.map((u) => (
                        <li
                          key={u.tipo}
                          className="flex items-center justify-between text-xs text-muted-foreground"
                        >
                          <span>{AI_USAGE_TYPE_LABELS[u.tipo] ?? u.tipo}</span>
                          <span className="text-foreground">{u.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 text-[10px] text-muted-foreground">
                    Contagem informativa — sem conversão para R$ (não há preço por chamada da
                    Lovable AI Gateway).
                  </p>
                </div>
              </section>
            </>
          )}
        </div>
      ) : activeTab === "auditoria" ? (
        <div className="mt-4">
          {auditLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : auditRows.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              Nenhum evento de auditoria registrado ainda.
            </div>
          ) : (
            <ul className="space-y-2">
              {auditRows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-2xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">
                      {AUDIT_ACTION_LABELS[row.action] ?? row.action}
                    </p>
                    <p className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <p className="mt-1.5 text-[12px] text-muted-foreground">
                    Quem fez: <span className="text-foreground">{row.actorNome ?? "—"}</span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    Em quem: <span className="text-foreground">{row.targetNome ?? "—"}</span>
                  </p>
                  {row.action === "user_status_updated" && (
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      Mudança:{" "}
                      <span className="text-foreground">
                        de {String(row.details.from ?? "—")} para {String(row.details.to ?? "—")}
                      </span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3">
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
        </>
      )}
    </div>
  );
}
