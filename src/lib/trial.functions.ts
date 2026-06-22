import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { capabilityStartsTrial, type Capability } from "@/lib/plan-capabilities";

const ALLOWED_CAPS: Capability[] = [
  "canUseReceiptScanner",
  "canUseWhatsapp",
  "canUseWhatsappJarvys",
  "canUseWhatsappOCR",
  "canUseFipeAutoRefresh",
  "canUseFipeHistoryRefresh",
];

type EnsureTrialResult = {
  started: boolean;
  trial_inicio: string | null;
};

/**
 * Inicia o trial sob demanda (Build 3 / Fase 2.2).
 *
 * Regras:
 * - Só pode ser disparado por capabilities triggerizadoras
 *   (canUseReceiptScanner, WhatsApp futuro, FIPE auto/history refresh).
 * - Nunca inicia trial para Dr. Jarvys app, FIPE atual, histórico premium
 *   ou limites de veículo.
 * - Idempotente: só grava se profiles.trial_inicio IS NULL.
 * - Só inicia para usuário com status_usuario = 'trial'.
 * - Não toca status_usuario, planos, carteira, Asaas, RLS, histórico
 *   premium ou limite de veículos.
 */
export const ensureTrialStartedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { capability: Capability }) => {
    if (!input || !ALLOWED_CAPS.includes(input.capability)) {
      throw new Error("capability_not_allowed");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<EnsureTrialResult> => {
    // Defesa em camadas: revalida que a capability dispara trial.
    if (!capabilityStartsTrial(data.capability)) {
      return { started: false, trial_inicio: null };
    }

    const { supabase, userId } = context;

    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("status_usuario, trial_inicio")
      .eq("id", userId)
      .maybeSingle();

    if (profErr || !prof) {
      return { started: false, trial_inicio: null };
    }

    if (prof.status_usuario !== "trial") {
      return { started: false, trial_inicio: prof.trial_inicio ?? null };
    }

    if (prof.trial_inicio !== null) {
      return { started: false, trial_inicio: prof.trial_inicio };
    }

    const nowIso = new Date().toISOString();
    const { data: updated } = await supabase
      .from("profiles")
      .update({ trial_inicio: nowIso })
      .eq("id", userId)
      .is("trial_inicio", null)
      .select("trial_inicio")
      .maybeSingle();

    // Só reportar started=true se o banco realmente devolveu o valor gravado.
    if (updated?.trial_inicio) {
      return { started: true, trial_inicio: updated.trial_inicio };
    }

    // UPDATE não persistiu (provável race com outra requisição concorrente).
    // Reler para reportar o valor real atualmente no banco, sem fingir start.
    const { data: reread } = await supabase
      .from("profiles")
      .select("trial_inicio")
      .eq("id", userId)
      .maybeSingle();

    return { started: false, trial_inicio: reread?.trial_inicio ?? null };
  });
