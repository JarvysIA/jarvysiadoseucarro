import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PlanContext } from "@/lib/plan-capabilities";
import type { ProfileStatus } from "@/lib/profile-status";

/**
 * Hook leve para montar o PlanContext do usuário autenticado.
 *
 * Build 3: usado pelos gates de OCR (ReceiptScanFab, MaintenancePanel).
 * Faz um único SELECT mínimo em `profiles` e devolve `null` enquanto carrega.
 *
 * vehicleCount/activatedVehicleCount são fixados em 0 porque os consumidores
 * atuais (OCR) não dependem dessas contagens — elas só afetam canAddVehicle /
 * canHaveUnlimitedVehicles. Quando um futuro consumidor precisar delas,
 * estender este hook.
 */
export function useCurrentPlan(): PlanContext | null {
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
      const { data, error } = await supabase
        .from("profiles")
        .select("status_usuario, trial_inicio")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setPlan(null);
        return;
      }
      setPlan({
        status_usuario: (data.status_usuario as ProfileStatus) ?? "trial",
        trial_inicio: (data.trial_inicio as string | null) ?? null,
        vehicleCount: 0,
        activatedVehicleCount: 0,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return plan;
}
