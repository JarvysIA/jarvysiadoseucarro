import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PROFILE_STATUS_VALUES, type ProfileStatus } from "@/lib/profile-status";
import { recordAuditEvent } from "@/lib/audit-log";

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
