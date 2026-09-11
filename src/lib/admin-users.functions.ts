import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PROFILE_STATUS_VALUES, type ProfileStatus } from "@/lib/profile-status";
import { recordAuditEvent } from "@/lib/audit-log";
import {
  aggregateAiUsageByType,
  aggregateRevenueByType,
  currentMonthCompetencia,
  nextMonthStart,
  todayStartUTC,
} from "@/lib/financial-aggregation";
import type { Json } from "@/integrations/supabase/types";

export type AdminVehicle = {
  id: string;
  modelo: string | null;
  marca: string | null;
  placa: string;
};

export type PlanStatus = ProfileStatus;

export type AdminUserRow = {
  id: string;
  nome: string;
  whatsapp: string;
  email: string | null;
  placa: string | null;
  is_super_admin: boolean;
  status_usuario: PlanStatus;
  vehicles: AdminVehicle[];
  created_at: string;
};

export async function assertSuperAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("Falha ao verificar permissões.");
  if (!data?.is_super_admin) throw new Error("Acesso negado.");
}

export const listAdminUsersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id,nome,whatsapp,email,placa,is_super_admin,status_usuario,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: veics } = await supabaseAdmin
      .from("veiculos")
      .select("id,user_id,modelo,marca,placa")
      .order("created_at", { ascending: true });

    const byUser = new Map<string, AdminVehicle[]>();
    (veics ?? []).forEach((v) => {
      if (!v.user_id) return;
      const arr = byUser.get(v.user_id) ?? [];
      arr.push({ id: v.id, modelo: v.modelo, marca: v.marca, placa: v.placa });
      byUser.set(v.user_id, arr);
    });

    const rows: AdminUserRow[] = (profiles ?? []).map((p) => ({
      id: p.id,
      nome: p.nome,
      whatsapp: p.whatsapp,
      email: p.email,
      placa: p.placa,
      is_super_admin: Boolean(p.is_super_admin),
      status_usuario: ((p.status_usuario as PlanStatus) ?? "trial"),
      vehicles: byUser.get(p.id) ?? [],
      created_at: p.created_at,
    }));
    return { rows };
  });

export type AuditLogRow = {
  id: string;
  action: string;
  actorId: string;
  actorNome: string | null;
  targetId: string | null;
  targetNome: string | null;
  details: Record<string, Json>;
  createdAt: string;
};

type AuditLogDbRow = {
  id: string;
  action: string;
  actor_id: string;
  target_id: string | null;
  details: Json;
  created_at: string;
};

export const listAuditLogFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: AuditLogRow[] }> => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: logs, error } = await supabaseAdmin
      .from("audit_log")
      .select("id, action, actor_id, target_id, details, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    // Junta com profiles pra nome legível de actor/target — 1 SELECT só
    // com .in() pros ids únicos envolvidos, depois monta id->nome (evita
    // N+1 queries).
    const ids = Array.from(
      new Set(
        (logs ?? []).flatMap((l: AuditLogDbRow) =>
          [l.actor_id, l.target_id].filter((x): x is string => Boolean(x)),
        ),
      ),
    );
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, nome").in("id", ids)
      : { data: [] as { id: string; nome: string }[] };
    const nameById = new Map(
      (profs ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome]),
    );

    const rows: AuditLogRow[] = (logs ?? []).map((l: AuditLogDbRow) => ({
      id: l.id,
      action: l.action,
      actorId: l.actor_id,
      actorNome: nameById.get(l.actor_id) ?? null,
      targetId: l.target_id,
      targetNome: l.target_id ? (nameById.get(l.target_id) ?? null) : null,
      details: (l.details as Record<string, Json>) ?? {},
      createdAt: l.created_at,
    }));

    return { rows };
  });

export type ManualCostEntry = {
  id: string;
  category: string;
  amount: number;
  note: string | null;
  createdAt: string;
};

export type FinancialSummary = {
  competencia: string;
  revenueByType: { tipo: string; valor: number }[];
  totalRevenue: number;
  costs: ManualCostEntry[];
  totalCosts: number;
  result: number;
  aiUsageByType: { tipo: string; count: number }[];
};

export const getFinancialSummaryFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { competencia?: string }) => input ?? {})
  .handler(async ({ context, data }): Promise<FinancialSummary> => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const competencia = data.competencia ?? currentMonthCompetencia();
    const monthEnd = nextMonthStart(competencia);

    const { data: pagamentos, error: pagError } = await supabaseAdmin
      .from("pagamentos_pix")
      .select("tipo_produto, valor")
      .eq("status", "pago")
      .gte("data_pagamento", competencia)
      .lt("data_pagamento", monthEnd);
    if (pagError) throw new Error(pagError.message);

    const { data: costsRaw, error: costsError } = await supabaseAdmin
      .from("manual_cost_entries")
      .select("id, category, amount, note, created_at")
      .eq("competencia", competencia)
      .order("created_at", { ascending: false });
    if (costsError) throw new Error(costsError.message);

    const { data: aiEvents, error: aiError } = await supabaseAdmin
      .from("ai_usage_events")
      .select("event_type")
      .gte("created_at", competencia)
      .lt("created_at", monthEnd);
    if (aiError) throw new Error(aiError.message);

    const revenueByType = aggregateRevenueByType(
      (pagamentos ?? []).map((p: { tipo_produto: string; valor: number }) => ({
        tipo_produto: p.tipo_produto,
        valor: p.valor,
      })),
    );
    const totalRevenue = revenueByType.reduce((sum, r) => sum + r.valor, 0);

    const costs: ManualCostEntry[] = (costsRaw ?? []).map(
      (c: { id: string; category: string; amount: number; note: string | null; created_at: string }) => ({
        id: c.id,
        category: c.category,
        amount: c.amount,
        note: c.note,
        createdAt: c.created_at,
      }),
    );
    const totalCosts = costs.reduce((sum, c) => sum + c.amount, 0);

    const aiUsageByType = aggregateAiUsageByType(
      (aiEvents ?? []).map((e: { event_type: string }) => ({ event_type: e.event_type })),
    );

    return {
      competencia,
      revenueByType,
      totalRevenue,
      costs,
      totalCosts,
      result: totalRevenue - totalCosts,
      aiUsageByType,
    };
  });

export const createManualCostEntryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { category: string; amount: number; competencia: string; note?: string }) => {
    if (!input?.category?.trim() || !input?.competencia || !(input?.amount > 0)) {
      throw new Error("Parâmetros inválidos.");
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("manual_cost_entries").insert({
      category: data.category.trim(),
      amount: data.amount,
      competencia: data.competencia,
      note: data.note?.trim() || null,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const deleteManualCostEntryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("Parâmetros inválidos.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("manual_cost_entries")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export type PlateApiUsage = {
  todayCount: number;
  monthCount: number;
  todayByType: { tipo: string; count: number }[];
};

export const getPlateApiUsageFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlateApiUsage> => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const todayStart = todayStartUTC();
    const monthStart = currentMonthCompetencia();
    const monthEnd = nextMonthStart(monthStart);

    const { count: todayCount, error: todayError } = await supabaseAdmin
      .from("plate_api_calls")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart);
    if (todayError) throw new Error(todayError.message);

    const { count: monthCount, error: monthError } = await supabaseAdmin
      .from("plate_api_calls")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd);
    if (monthError) throw new Error(monthError.message);

    const { data: todayRows, error: todayRowsError } = await supabaseAdmin
      .from("plate_api_calls")
      .select("call_type")
      .gte("created_at", todayStart);
    if (todayRowsError) throw new Error(todayRowsError.message);

    const todayByType = aggregateAiUsageByType(
      (todayRows ?? []).map((r: { call_type: string }) => ({ event_type: r.call_type })),
    );

    return {
      todayCount: todayCount ?? 0,
      monthCount: monthCount ?? 0,
      todayByType,
    };
  });

export const updateUserStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; status: PlanStatus }) => {
    if (!input?.userId || !PROFILE_STATUS_VALUES.includes(input.status)) {
      throw new Error("Parâmetros inválidos.");
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("status_usuario")
      .eq("id", data.userId)
      .maybeSingle();

    const permite_indicacao = data.status !== "trial";
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ status_usuario: data.status, permite_indicacao })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);

    void recordAuditEvent(supabaseAdmin, {
      actorId: context.userId,
      action: "user_status_updated",
      targetId: data.userId,
      details: { from: before?.status_usuario ?? null, to: data.status },
    });

    return { ok: true };
  });
