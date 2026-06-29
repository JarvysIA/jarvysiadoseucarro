// Build 6.40 — Helper puro de próxima revisão.
//
// Calcula a próxima revisão alvo do veículo a partir de um
// maintenance_plan_json já validado, com janelas:
//   - pré-revisão  (upcoming):  faltam <= alertThresholdKm
//   - exata        (due):       km = múltiplo do intervalo
//   - pós-revisão  (due_grace): passou da revisão há <= postDueReminderKm
//
// Suporta km ilimitado: acima do maior milestone do plano,
// projeta o ciclo recorrente 10k–200k (modo "recurring").
//
// Zero I/O. Zero IA. Zero persistência. Não muta o plano.
// Termo "atrasado" NÃO é usado nesta versão.

export type NextMaintenanceMode = "base_plan" | "recurring";

export type NextMaintenanceStatus =
  | "ok"
  | "recurring"
  | "invalid_plan"
  | "invalid_km";

export type NextMaintenanceAlertStatus =
  | "none"
  | "upcoming"
  | "due"
  | "due_grace";

export type NextMilestoneResult = {
  kmAtual: number;
  status: NextMaintenanceStatus;
  mode: NextMaintenanceMode | null;

  nextMilestone: Record<string, unknown> | null;
  nextKm: number | null;
  nextRevisionNumber: number | null;

  currentCycleKm: number | null;
  kmSinceCurrentCycle: number | null;
  targetKm: number | null;
  isDismissed: boolean;

  previousKm: number | null;
  distanceKm: number | null;
  // Mantidos por compat; sempre false/null neste build (termo "atrasado" não é usado).
  isOverdue: boolean;
  overdueByKm: number | null;

  alertThresholdKm: number;
  postDueReminderKm: number;
  alertStatus: NextMaintenanceAlertStatus;
  isInAlertWindow: boolean;

  baseReferenceKm: number | null;
  baseReferenceMilestone: Record<string, unknown> | null;

  items: unknown[];

  completedMilestones: number;
  totalMilestones: number;

  warnings: string[];
};

type GetNextOptions = {
  alertThresholdKm?: number;
  postDueReminderKm?: number;
  intervalKm?: number;
  dismissedRevisionKms?: number[];
};

const DEFAULT_ALERT_THRESHOLD_KM = 3000;
const DEFAULT_POST_DUE_REMINDER_KM = 3000;
const DEFAULT_INTERVAL_KM = 10000;
const RECURRING_CYCLE_MIN_KM = 10000;
const RECURRING_CYCLE_MAX_KM = 200000;
const RECURRING_CYCLE_SPAN_KM = RECURRING_CYCLE_MAX_KM - RECURRING_CYCLE_MIN_KM; // 190_000? não: usamos 200_000 como passo cíclico
// Conforme especificação: baseReferenceKm = ((targetKm - 10000) % 200000) + 10000
const RECURRING_MODULUS_KM = 200000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function toPositiveInt(v: unknown, fallback: number): number {
  const n = toFiniteNumber(v);
  if (n === null) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
}

type ValidMilestone = {
  km: number;
  items: unknown[];
  raw: Record<string, unknown>;
};

function extractMilestones(
  plan: unknown,
  warnings: string[],
): ValidMilestone[] {
  if (!isRecord(plan)) return [];
  const arr = plan["milestones"];
  if (!Array.isArray(arr)) return [];
  const out: ValidMilestone[] = [];
  for (const raw of arr) {
    if (!isRecord(raw)) {
      warnings.push("milestone_invalida_ignorada");
      continue;
    }
    const km = toFiniteNumber(raw["km"]);
    if (km === null || km <= 0 || !Number.isInteger(km)) {
      warnings.push("milestone_invalida_ignorada");
      continue;
    }
    const items = Array.isArray(raw["items"]) ? (raw["items"] as unknown[]) : [];
    out.push({ km, items, raw });
  }
  // ordenar por km crescente
  out.sort((a, b) => a.km - b.km);
  return out;
}

function emptyResult(
  kmAtual: number,
  status: NextMaintenanceStatus,
  alertThresholdKm: number,
  postDueReminderKm: number,
  warnings: string[],
  totalMilestones: number,
): NextMilestoneResult {
  return {
    kmAtual,
    status,
    mode: null,
    nextMilestone: null,
    nextKm: null,
    nextRevisionNumber: null,
    currentCycleKm: null,
    kmSinceCurrentCycle: null,
    targetKm: null,
    isDismissed: false,
    previousKm: null,
    distanceKm: null,
    isOverdue: false,
    overdueByKm: null,
    alertThresholdKm,
    postDueReminderKm,
    alertStatus: "none",
    isInAlertWindow: false,
    baseReferenceKm: null,
    baseReferenceMilestone: null,
    items: [],
    completedMilestones: 0,
    totalMilestones,
    warnings,
  };
}

export function getNextMilestone(
  plan: unknown,
  kmAtualInput: unknown,
  options?: GetNextOptions,
): NextMilestoneResult {
  const warnings: string[] = [];

  const alertThresholdKm = toPositiveInt(
    options?.alertThresholdKm,
    DEFAULT_ALERT_THRESHOLD_KM,
  );
  const postDueReminderKm = toPositiveInt(
    options?.postDueReminderKm,
    DEFAULT_POST_DUE_REMINDER_KM,
  );
  const intervalKm = toPositiveInt(options?.intervalKm, DEFAULT_INTERVAL_KM);

  // Normaliza dismissedRevisionKms: inteiros positivos múltiplos do intervalo.
  const dismissedSet = new Set<number>();
  if (Array.isArray(options?.dismissedRevisionKms)) {
    for (const raw of options!.dismissedRevisionKms!) {
      const n = toFiniteNumber(raw);
      if (
        n !== null &&
        n > 0 &&
        Number.isInteger(n) &&
        n % intervalKm === 0
      ) {
        dismissedSet.add(n);
      } else {
        warnings.push("dismissed_km_invalido");
      }
    }
  }

  // Validação de km atual.
  const kmRaw = toFiniteNumber(kmAtualInput);
  if (kmRaw === null || kmRaw < 0) {
    warnings.push("km_atual_invalido");
    return emptyResult(
      Number.isFinite(kmRaw as number) ? (kmRaw as number) : 0,
      "invalid_km",
      alertThresholdKm,
      postDueReminderKm,
      warnings,
      0,
    );
  }
  const kmAtual = Math.floor(kmRaw);

  // Extrai milestones do plano.
  const milestones = extractMilestones(plan, warnings);
  if (milestones.length === 0) {
    warnings.push("plano_sem_milestones_validas");
    return emptyResult(
      kmAtual,
      "invalid_plan",
      alertThresholdKm,
      postDueReminderKm,
      warnings,
      0,
    );
  }
  const totalMilestones = milestones.length;
  const maxMilestoneKm = milestones[milestones.length - 1]!.km;
  const byKm = new Map<number, ValidMilestone>();
  for (const m of milestones) byKm.set(m.km, m);

  if (kmAtual >= 300000) warnings.push("alta_quilometragem_extrema");
  else if (kmAtual >= 200000) warnings.push("alta_quilometragem");

  // Cálculo de ciclo.
  const currentCycleKm = Math.floor(kmAtual / intervalKm) * intervalKm;
  const kmSinceCurrentCycle = kmAtual - currentCycleKm;
  const nextCycleKm = currentCycleKm + intervalKm;
  const isDismissed = dismissedSet.has(currentCycleKm);
  if (isDismissed) warnings.push("revisao_dispensada_pelo_usuario");

  // Decisão de alertStatus / targetKm.
  let alertStatus: NextMaintenanceAlertStatus;
  let targetKm: number;
  let distanceKm: number;
  let isInAlertWindow: boolean;

  if (kmAtual > 0 && kmSinceCurrentCycle === 0) {
    alertStatus = "due";
    targetKm = currentCycleKm;
    distanceKm = 0;
    isInAlertWindow = true;
  } else if (
    kmSinceCurrentCycle > 0 &&
    kmSinceCurrentCycle <= postDueReminderKm &&
    !isDismissed
  ) {
    alertStatus = "due_grace";
    targetKm = currentCycleKm;
    distanceKm = 0;
    isInAlertWindow = true;
    if (kmSinceCurrentCycle === postDueReminderKm) {
      warnings.push("ultimo_aviso_da_revisao");
    }
  } else {
    const distToNext = nextCycleKm - kmAtual;
    if (distToNext > 0 && distToNext <= alertThresholdKm) {
      alertStatus = "upcoming";
      targetKm = nextCycleKm;
      distanceKm = distToNext;
      isInAlertWindow = true;
    } else {
      alertStatus = "none";
      targetKm = nextCycleKm;
      distanceKm = distToNext;
      isInAlertWindow = false;
    }
  }

  // Resolução da milestone alvo.
  if (targetKm <= maxMilestoneKm) {
    const real = byKm.get(targetKm) ?? null;
    if (real === null) {
      // Plano base obrigatório 10k–200k está incompleto.
      warnings.push("targetKm_sem_milestone_correspondente");
      return {
        kmAtual,
        status: "invalid_plan",
        mode: "base_plan",
        nextMilestone: null,
        nextKm: targetKm,
        nextRevisionNumber: targetKm / intervalKm,
        currentCycleKm,
        kmSinceCurrentCycle,
        targetKm,
        isDismissed,
        previousKm: currentCycleKm,
        distanceKm,
        isOverdue: false,
        overdueByKm: null,
        alertThresholdKm,
        postDueReminderKm,
        alertStatus,
        isInAlertWindow,
        baseReferenceKm: targetKm,
        baseReferenceMilestone: null,
        items: [],
        completedMilestones: milestones.filter(
          (m) => m.km <= currentCycleKm,
        ).length,
        totalMilestones,
        warnings,
      };
    }
    return {
      kmAtual,
      status: "ok",
      mode: "base_plan",
      nextMilestone: real.raw,
      nextKm: targetKm,
      nextRevisionNumber: targetKm / intervalKm,
      currentCycleKm,
      kmSinceCurrentCycle,
      targetKm,
      isDismissed,
      previousKm: currentCycleKm,
      distanceKm,
      isOverdue: false,
      overdueByKm: null,
      alertThresholdKm,
      postDueReminderKm,
      alertStatus,
      isInAlertWindow,
      baseReferenceKm: targetKm,
      baseReferenceMilestone: real.raw,
      items: real.items,
      completedMilestones: milestones.filter(
        (m) => m.km <= currentCycleKm,
      ).length,
      totalMilestones,
      warnings,
    };
  }

  // Modo recurring: targetKm > maxMilestoneKm.
  warnings.push("km_acima_do_plano_base");
  warnings.push("proxima_revisao_recorrente");
  warnings.push("itens_baseados_em_ciclo_10k_200k");

  const baseReferenceKm =
    ((targetKm - RECURRING_CYCLE_MIN_KM) % RECURRING_MODULUS_KM) +
    RECURRING_CYCLE_MIN_KM;
  const ref = byKm.get(baseReferenceKm) ?? null;

  if (ref === null) {
    warnings.push("referencia_recorrente_nao_encontrada");
    return {
      kmAtual,
      status: "invalid_plan",
      mode: "recurring",
      nextMilestone: null,
      nextKm: targetKm,
      nextRevisionNumber: targetKm / intervalKm,
      currentCycleKm,
      kmSinceCurrentCycle,
      targetKm,
      isDismissed,
      previousKm: currentCycleKm,
      distanceKm,
      isOverdue: false,
      overdueByKm: null,
      alertThresholdKm,
      postDueReminderKm,
      alertStatus,
      isInAlertWindow,
      baseReferenceKm,
      baseReferenceMilestone: null,
      items: [],
      completedMilestones: Math.floor(kmAtual / intervalKm),
      totalMilestones,
      warnings,
    };
  }

  // Milestone projetada em memória (não persiste, não muta o plano).
  const labelN = (targetKm / 1000).toLocaleString("pt-BR");
  const projectedMilestone: Record<string, unknown> = {
    km: targetKm,
    label: `Revisão de ${labelN}.000 km`,
    revision_number: targetKm / intervalKm,
    items: ref.items,
    projected: true,
    source_reference_km: baseReferenceKm,
  };

  return {
    kmAtual,
    status: "recurring",
    mode: "recurring",
    nextMilestone: projectedMilestone,
    nextKm: targetKm,
    nextRevisionNumber: targetKm / intervalKm,
    currentCycleKm,
    kmSinceCurrentCycle,
    targetKm,
    isDismissed,
    previousKm: currentCycleKm,
    distanceKm,
    isOverdue: false,
    overdueByKm: null,
    alertThresholdKm,
    postDueReminderKm,
    alertStatus,
    isInAlertWindow,
    baseReferenceKm,
    baseReferenceMilestone: ref.raw,
    items: ref.items,
    completedMilestones: Math.floor(kmAtual / intervalKm),
    totalMilestones,
    warnings,
  };
}

// Silenciador para evitar warning de constante não usada (futuro uso).
void RECURRING_CYCLE_SPAN_KM;
