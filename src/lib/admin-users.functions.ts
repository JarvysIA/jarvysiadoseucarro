import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminUserRow = {
  id: string;
  nome: string;
  whatsapp: string;
  email: string | null;
  placa: string | null;
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
      .select("id,nome,whatsapp,email,placa,is_super_admin,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: veics } = await supabaseAdmin
      .from("veiculos")
      .select("user_id");
    const counts = new Map<string, number>();
    (veics ?? []).forEach((v) => {
      if (!v.user_id) return;
      counts.set(v.user_id, (counts.get(v.user_id) ?? 0) + 1);
    });

    const rows: AdminUserRow[] = (profiles ?? []).map((p) => ({
      id: p.id,
      nome: p.nome,
      whatsapp: p.whatsapp,
      email: p.email,
      placa: p.placa,
      is_super_admin: Boolean(p.is_super_admin),
      vehicle_count: counts.get(p.id) ?? 0,
      created_at: p.created_at,
    }));
    return { rows };
  });
