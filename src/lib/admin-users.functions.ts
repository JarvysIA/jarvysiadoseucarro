import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PlanTier = "free" | "vip" | "super_vip";

export type AdminUserRow = {
  id: string;
  nome: string;
  whatsapp: string;
  email: string | null;
  placa: string | null;
  plan_tier: PlanTier;
  is_super_admin: boolean;
  vehicle_count: number;
  created_at: string;
};

async function assertSuperAdmin(userId: string) {
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
      .select("id,nome,whatsapp,email,placa,plan_tier,is_super_admin,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: veics } = await supabaseAdmin
      .from("veiculos")
      .select("user_id");
    const counts = new Map<string, number>();
    (veics ?? []).forEach((v) => {
      counts.set(v.user_id, (counts.get(v.user_id) ?? 0) + 1);
    });

    const rows: AdminUserRow[] = (profiles ?? []).map((p) => ({
      id: p.id,
      nome: p.nome,
      whatsapp: p.whatsapp,
      email: p.email,
      placa: p.placa,
      plan_tier: ((p as { plan_tier?: PlanTier }).plan_tier ?? "free") as PlanTier,
      is_super_admin: Boolean((p as { is_super_admin?: boolean }).is_super_admin),
      vehicle_count: counts.get(p.id) ?? 0,
      created_at: p.created_at,
    }));
    return { rows };
  });

export const setPlanTierFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; planTier: PlanTier }) => {
    if (!["free", "vip", "super_vip"].includes(data.planTier)) {
      throw new Error("plan_tier inválido.");
    }
    if (!data.userId || typeof data.userId !== "string") {
      throw new Error("userId obrigatório.");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ plan_tier: data.planTier })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
