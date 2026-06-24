import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PlanContext } from "@/lib/plan-capabilities";
import type { ProfileStatus } from "@/lib/profile-status";

/**
 * Hook leve para montar o PlanContext do usuário autenticado.
 *
 * Build 4A: vehicleCount e activatedVehicleCount agora são reais.
 * - vehicleCount = veiculos do usuário com status='ativo' (archived NÃO conta).
 * - activatedVehicleCount = veículos cujo veiculo_id possui pagamento
 *   confirmado em pagamentos_pix (status='pago', tipo_produto='ativacao').
 *   Histórico premium (tipo_produto='historico') NÃO conta.
 *   assinaturas não é usada porque não é alimentada pelo fluxo atual.
 */
export function useCurrentPlan(refreshKey: number = 0): PlanContext | null {
  const [plan, setPlan] = useState<PlanContext | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) {
        if (!cancelled) setPlan(null);
        return;
      }

      const [profileRes, vehiclesRes, activationsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("status_usuario, trial_inicio")
          .eq("id", userId)
          .maybeSingle(),
        supabase
          .from("veiculos")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "ativo"),
        supabase
          .from("pagamentos_pix")
          .select("veiculo_id")
          .eq("user_id", userId)
          .eq("status", "pago")
          .eq("tipo_produto", "ativacao")
          .not("veiculo_id", "is", null),
      ]);

      if (cancelled) return;
      if (profileRes.error || !profileRes.data) {
        setPlan(null);
        return;
      }

      const activeVehicleIds = new Set<string>(
        ((vehiclesRes.data ?? []) as { id: string }[]).map((v) => v.id),
      );
      const activatedIds = new Set<string>();
      for (const row of (activationsRes.data ?? []) as { veiculo_id: string | null }[]) {
        if (row.veiculo_id && activeVehicleIds.has(row.veiculo_id)) {
          activatedIds.add(row.veiculo_id);
        }
      }

      setPlan({
        status_usuario:
          (profileRes.data.status_usuario as ProfileStatus) ?? "trial",
        trial_inicio:
          (profileRes.data.trial_inicio as string | null) ?? null,
        vehicleCount: activeVehicleIds.size,
        activatedVehicleCount: activatedIds.size,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return plan;
}
