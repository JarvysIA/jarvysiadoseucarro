// Build Maintenance-Alert — cópia deliberada de src/lib/predictive-maintenance.ts
// (2026-09-02), adaptada pro runtime Deno de supabase/functions/_shared/.
// Mesmo padrão de duplicação de arquivo puro já estabelecido no repo (ex:
// receipt-ocr/parse-receipt.ts entre src/lib e supabase/functions/_shared).
// Sem import cruzado entre os dois runtimes — cópia fiel, sem lógica
// alterada. Só o subconjunto usado por este build (nearestMilestone +
// getMilestoneWindowStatus); nextMilestone/kmUntilMilestone/
// isApproachingMilestone não são necessários aqui e foram omitidos.
//
// Motor preditivo de manutenção (frontend/puro).
// Calcula o próximo marco redondo de revisão preventiva com base no KM atual.
// Sem I/O, sem dependências, sem gate de plano.

export const MILESTONE_STEP = 10_000;
export const ALERT_WINDOW = 2_000;

export type MilestoneWindowStatus = {
  milestone: number;
  distanceKm: number;
  isPast: boolean;
  withinWindow: boolean;
};

/**
 * Marco de 10k mais próximo do km atual (antes OU depois), nunca abaixo
 * de MILESTONE_STEP (não existe marco "0 km").
 */
export function nearestMilestone(km: number): number {
  if (!Number.isFinite(km) || km <= 0) return MILESTONE_STEP;
  const k = Math.floor(km);
  const lower = Math.floor(k / MILESTONE_STEP) * MILESTONE_STEP;
  if (lower < MILESTONE_STEP) return MILESTONE_STEP;
  const upper = lower + MILESTONE_STEP;
  const distLower = k - lower;
  const distUpper = upper - k;
  return distLower <= distUpper ? lower : upper;
}

/**
 * Status completo em relação ao marco mais próximo: distância absoluta,
 * se já foi ultrapassado (isPast, true também quando km === milestone),
 * e se está dentro da janela de alerta simétrica.
 */
export function getMilestoneWindowStatus(
  km: number,
  window: number = ALERT_WINDOW,
): MilestoneWindowStatus {
  const k = !Number.isFinite(km) || km <= 0 ? 0 : Math.floor(km);
  const milestone = nearestMilestone(k);
  const distanceKm = Math.abs(k - milestone);
  return {
    milestone,
    distanceKm,
    isPast: k >= milestone,
    withinWindow: distanceKm <= window,
  };
}
