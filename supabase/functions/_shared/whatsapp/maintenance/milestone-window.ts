// PORTA de src/lib/predictive-maintenance.ts — cópia deliberada, não
// reimportar de src/lib (Edge Functions rodam em Deno; src/lib usa
// resolução de módulos de bundler/Node). Mesma lógica dos dois lados.
// Se a janela do app mudar, este arquivo precisa ser atualizado
// manualmente em par.

// Motor preditivo de manutenção (frontend/puro).
// Calcula o próximo marco redondo de revisão preventiva com base no KM atual.
// Sem I/O, sem dependências, sem gate de plano.

export const MILESTONE_STEP = 10_000;
export const ALERT_WINDOW = 2_000;

/**
 * Retorna o próximo marco redondo de revisão (múltiplo de MILESTONE_STEP).
 * - km <= 0 → MILESTONE_STEP
 * - km exatamente em cima de um marco → próximo marco (mira o seguinte)
 * - caso contrário → ceil(km / step) * step
 */
export function nextMilestone(km: number): number {
  if (!Number.isFinite(km) || km <= 0) return MILESTONE_STEP;
  const k = Math.floor(km);
  if (k % MILESTONE_STEP === 0) return k + MILESTONE_STEP;
  return Math.ceil(k / MILESTONE_STEP) * MILESTONE_STEP;
}

export function kmUntilMilestone(km: number): number {
  return nextMilestone(km) - (Number.isFinite(km) ? Math.floor(km) : 0);
}

export function isApproachingMilestone(km: number, window: number = ALERT_WINDOW): boolean {
  if (!Number.isFinite(km) || km <= 0) return false;
  return kmUntilMilestone(km) <= window;
}

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
