// Motor preditivo de manutenção (frontend/puro).
// Calcula o próximo marco redondo de revisão preventiva com base no KM atual.
// Sem I/O, sem dependências, sem gate de plano.

export const MILESTONE_STEP = 10_000;
export const ALERT_WINDOW = 3_000;

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
