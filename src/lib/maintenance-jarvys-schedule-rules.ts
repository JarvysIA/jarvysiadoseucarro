// ─────────────────────────────────────────────────────────────
// Build 6.42D — Motor determinístico oficial Jarvys.
//
// Matriz oficial 10k–200k (ciclo-base) com suporte a CICLO INFINITO
// acima de 200.000 km via mapeamento:
//   baseKm = ((realKm − 10000) % 200000) + 10000
//
// Helper puro: zero I/O, zero IA, zero Supabase. Não depende de banco,
// rede ou React. Pode ser reusado por dry-run, cards de saúde futuros
// e payload de próxima revisão.
//
// IMPORTANTE — schema estrito:
// O `MaintenancePlanJson.milestones[].items[]` (schema Zod `.strict()`)
// não aceita campos extras. Tipos internos como `group_key`,
// `requires_confirmation`, `revisionKmReal`, `revisionKmBase`,
// `cycleIndex`, `isHighMileage` SÓ existem aqui. Antes de emitir como
// `MaintenancePlanItem`, a função `toMaintenancePlanItem` descarta os
// campos internos (e preserva auditoria em `notes`).
// ─────────────────────────────────────────────────────────────

import type {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePlanItem,
  MaintenancePlanJson,
  MaintenanceRecommendationType,
  ShoppingClassification,
  TimingSystem,
  TransmissionType,
} from "./maintenance-plan-schema";

// ─────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────

export type JarvysFuelKind =
  | "combustao"
  | "hibrido_combustao"
  | "eletrico_puro";

export type JarvysTransmissionKind =
  | "manual"
  | "automatico"
  | "cvt"
  | "automatizado"
  | "dupla_embreagem"
  | "e_cvt"
  | "desconhecido";

export type JarvysSteeringKind = "hidraulica" | "eletrica" | "desconhecida";

export type JarvysVehicleProfile = {
  fuelKind: JarvysFuelKind;
  timingSystem: TimingSystem;
  transmissionKind: JarvysTransmissionKind;
  steeringKind: JarvysSteeringKind;
};

export type JarvysItemGroupKey =
  | "oleo_motor_kit"
  | "filtros_kit"
  | "freios_kit"
  | "ignicao_kit"
  | "sincronismo_kit"
  | "poly_v_kit"
  | "cambio_automatico_kit"
  | "cambio_manual_kit"
  | "arrefecimento_kit"
  | null;

export type JarvysItem = {
  // Núcleo compatível com MaintenancePlanItem
  item_key: string;
  label: string;
  category: MaintenanceCategory;
  action: MaintenanceAction;
  recommendation_type: MaintenanceRecommendationType;
  shopping_classification: ShoppingClassification;
  applies: boolean;
  confidence: number;
  source_type: "experiencia_preventiva";
  notes?: string[];
  // Internos — NUNCA emitir cru no MaintenancePlanJson
  group_key: JarvysItemGroupKey;
  requires_confirmation: boolean;
};

export type JarvysMilestone = {
  revisionKmReal: number;
  revisionKmBase: number;
  revisionNumber: number;
  cycleIndex: number;
  isHighMileage: boolean;
  label: string;
  items: JarvysItem[];
  notes: string[];
};

// ─────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────

export const JARVYS_BASE_CYCLE_STEP_KM = 10000;
export const JARVYS_BASE_CYCLE_MIN_KM = 10000;
export const JARVYS_BASE_CYCLE_MAX_KM = 200000;
const RECURRING_MODULUS_KM = 200000;

export const HIGH_MILEAGE_NOTE =
  "Alta quilometragem. Esta revisão foi calculada pelo ciclo preventivo Jarvys, pois o veículo está acima do plano fornecido pela montadora. Confira os itens e confirme a aplicação antes da compra ou serviço.";

export const WET_BELT_CONFIRM_NOTE =
  "Confirme a aplicação exata pelo motor/chassi antes da compra. A substituição da correia banhada deve ser feita por oficina especializada.";

export const AUTO_TRANSMISSION_FULL_SERVICE_NOTE =
  "Troca completa com equipamento especializado, fluido correto e filtro quando aplicável. Nunca troca parcial. Evite flush químico/agressivo. Em alta km/histórico desconhecido, oriente diagnóstico prévio.";

// ─────────────────────────────────────────────────────────────
// Mapeamento km real → km base (ciclo infinito)
// ─────────────────────────────────────────────────────────────

/**
 * Mapeia um km real (múltiplo de 10.000, >= 10.000) para o marco base
 * dentro do ciclo-base 10k–200k.
 *
 * Fórmula: baseKm = ((realKm − 10000) % 200000) + 10000.
 *
 * Exemplos:
 *   10000 → base 10000 (cycle 0)
 *  200000 → base 200000 (cycle 0)
 *  210000 → base 10000 (cycle 1)
 *  220000 → base 20000 (cycle 1)
 *  260000 → base 60000 (cycle 1)
 *  300000 → base 100000 (cycle 1)
 *  320000 → base 120000 (cycle 1)
 *  400000 → base 200000 (cycle 1)
 *  410000 → base 10000 (cycle 2)
 *  430000 → base 30000 (cycle 2)
 */
export function mapRealKmToBaseKm(realKm: number): {
  baseKm: number;
  cycleIndex: number;
} {
  if (!Number.isFinite(realKm) || realKm < JARVYS_BASE_CYCLE_MIN_KM) {
    return { baseKm: JARVYS_BASE_CYCLE_MIN_KM, cycleIndex: 0 };
  }
  const normalized =
    Math.round(realKm / JARVYS_BASE_CYCLE_STEP_KM) *
    JARVYS_BASE_CYCLE_STEP_KM;
  const offset = normalized - JARVYS_BASE_CYCLE_MIN_KM;
  const baseOffset = offset % RECURRING_MODULUS_KM;
  const baseKm = baseOffset + JARVYS_BASE_CYCLE_MIN_KM;
  const cycleIndex = Math.floor(offset / RECURRING_MODULUS_KM);
  return { baseKm, cycleIndex };
}

// ─────────────────────────────────────────────────────────────
// Detecção de perfil a partir do plano IA validado
// ─────────────────────────────────────────────────────────────

function normalize(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_\s]+/g, " ")
    .trim();
}

function detectFuelKind(plan: MaintenancePlanJson): JarvysFuelKind {
  const fuel = normalize(plan.vehicle_summary.combustivel);
  const motor = normalize(plan.vehicle_summary.motor_textual);
  const hay = `${fuel} ${motor}`;
  const isElectricMarker = /(\beletrico\b|\belectric\b|\bev\b|\bbev\b)/.test(
    hay,
  );
  const combustionMarker =
    /(flex|gasolina|etanol|alcool|diesel|combustao|otto|tsi|firefly|turbo|aspirado)/.test(
      hay,
    );
  const hybridMarker =
    /(hibrid|hybrid|hev|phev|mhev|dm i|dmi|hsd|hybrid synergy)/.test(hay);
  if (isElectricMarker && !combustionMarker && !hybridMarker) {
    return "eletrico_puro";
  }
  if (hybridMarker) return "hibrido_combustao";
  if (combustionMarker) return "combustao";
  const cc = plan.vehicle_summary.cilindradas;
  if (typeof cc === "number" && cc > 0) return "combustao";
  if (isElectricMarker) return "eletrico_puro";
  return "combustao";
}

function detectTransmissionKind(
  plan: MaintenancePlanJson,
): JarvysTransmissionKind {
  const transmissao = normalize(plan.vehicle_summary.transmissao);
  const motor = normalize(plan.vehicle_summary.motor_textual);
  const hay = `${transmissao} ${motor}`;
  if (/(ecvt|e cvt|hybrid synergy|hsd|dm i|dmi)/.test(hay)) return "e_cvt";
  const t: TransmissionType = plan.system_profile.transmission_type;
  if (t === "automatico") return "automatico";
  if (t === "cvt") return "cvt";
  if (t === "automatizado") return "automatizado";
  if (t === "dupla_embreagem") return "dupla_embreagem";
  if (t === "manual") return "manual";
  return "desconhecido";
}

function detectSteeringKind(plan: MaintenancePlanJson): JarvysSteeringKind {
  // O schema atual não tem campo dedicado; heurística por motor_textual / general_notes.
  const haystack = [
    normalize(plan.vehicle_summary.motor_textual),
    ...(plan.general_notes ?? []).map((n) => normalize(n)),
  ].join(" ");
  if (/direcao eletrica|eps\b|epas\b|assistencia eletrica/.test(haystack)) {
    return "eletrica";
  }
  if (/direcao hidraulica|hidraulica/.test(haystack)) return "hidraulica";
  return "desconhecida";
}

export function inferJarvysProfileFromPlan(
  plan: MaintenancePlanJson,
): JarvysVehicleProfile {
  return {
    fuelKind: detectFuelKind(plan),
    timingSystem: plan.system_profile.timing_system,
    transmissionKind: detectTransmissionKind(plan),
    steeringKind: detectSteeringKind(plan),
  };
}

// ─────────────────────────────────────────────────────────────
// Catálogo de itens (factory helpers)
// ─────────────────────────────────────────────────────────────

function mk(
  partial: Omit<JarvysItem, "source_type" | "confidence" | "applies"> &
    Partial<Pick<JarvysItem, "confidence" | "applies" | "notes">>,
): JarvysItem {
  return {
    applies: true,
    confidence: 90,
    source_type: "experiencia_preventiva",
    ...partial,
  };
}

const ITEMS = {
  oleo_motor: (): JarvysItem =>
    mk({
      item_key: "oleo_motor",
      label: "Óleo do motor — especificação conforme manual",
      category: "motor",
      action: "trocar",
      recommendation_type: "required",
      shopping_classification: "inspect_before_buy",
      group_key: "oleo_motor_kit",
      requires_confirmation: true,
    }),
  filtro_oleo: (): JarvysItem =>
    mk({
      item_key: "filtro_oleo",
      label: "Filtro de óleo",
      category: "filtros",
      action: "trocar",
      recommendation_type: "required",
      shopping_classification: "bundle_preferred",
      group_key: "oleo_motor_kit",
      requires_confirmation: false,
    }),
  filtro_ar_motor: (): JarvysItem =>
    mk({
      item_key: "filtro_ar_motor",
      label: "Filtro de ar do motor",
      category: "filtros",
      action: "trocar",
      recommendation_type: "required",
      shopping_classification: "safe_to_buy",
      group_key: "filtros_kit",
      requires_confirmation: false,
    }),
  filtro_cabine: (): JarvysItem =>
    mk({
      item_key: "filtro_cabine",
      label: "Filtro de cabine (ar-condicionado)",
      category: "filtros",
      action: "trocar",
      recommendation_type: "required",
      shopping_classification: "safe_to_buy",
      group_key: "filtros_kit",
      requires_confirmation: false,
    }),
  filtro_combustivel: (): JarvysItem =>
    mk({
      item_key: "filtro_combustivel",
      label: "Filtro de combustível — confirmar aplicação conforme versão",
      category: "filtros",
      action: "trocar",
      recommendation_type: "required",
      shopping_classification: "inspect_before_buy",
      group_key: "filtros_kit",
      requires_confirmation: true,
    }),
  fluido_freio: (): JarvysItem =>
    mk({
      item_key: "fluido_freio",
      label: "Fluido de freio (DOT conforme manual)",
      category: "freios",
      action: "trocar",
      recommendation_type: "required",
      shopping_classification: "safe_to_buy",
      group_key: null,
      requires_confirmation: false,
    }),
  sangria_freio: (): JarvysItem =>
    mk({
      item_key: "sangria_freio",
      label: "Sangria do sistema de freio (serviço)",
      category: "freios",
      action: "verificar",
      recommendation_type: "required",
      shopping_classification: "service_only",
      group_key: null,
      requires_confirmation: false,
    }),
  pastilhas_freio: (): JarvysItem =>
    mk({
      item_key: "pastilhas_freio",
      label: "Pastilhas de freio",
      category: "freios",
      action: "trocar",
      recommendation_type: "preventive_recommended",
      shopping_classification: "inspect_before_buy",
      group_key: "freios_kit",
      requires_confirmation: true,
    }),
  discos_freio: (): JarvysItem =>
    mk({
      item_key: "discos_freio",
      label: "Discos de freio",
      category: "freios",
      action: "trocar",
      recommendation_type: "preventive_recommended",
      shopping_classification: "inspect_before_buy",
      group_key: "freios_kit",
      requires_confirmation: true,
    }),
  velas_ignicao: (): JarvysItem =>
    mk({
      item_key: "velas_ignicao",
      label: "Velas de ignição (cabos/bobinas conforme aplicação)",
      category: "ignicao",
      action: "trocar",
      recommendation_type: "required",
      shopping_classification: "inspect_before_buy",
      group_key: "ignicao_kit",
      requires_confirmation: true,
    }),
  limpeza_tbi_bicos: (): JarvysItem =>
    mk({
      item_key: "limpeza_tbi_bicos",
      label: "Limpeza de TBI e bicos injetores (serviço)",
      category: "motor",
      action: "limpar",
      recommendation_type: "preventive_recommended",
      shopping_classification: "service_only",
      group_key: null,
      requires_confirmation: false,
    }),
  aditivo_radiador: (): JarvysItem =>
    mk({
      item_key: "aditivo_radiador",
      label: "Aditivo do radiador (líquido de arrefecimento)",
      category: "arrefecimento",
      action: "trocar",
      recommendation_type: "required",
      shopping_classification: "inspect_before_buy",
      group_key: "arrefecimento_kit",
      requires_confirmation: true,
    }),
  limpeza_arrefecimento: (): JarvysItem =>
    mk({
      item_key: "limpeza_arrefecimento",
      label: "Limpeza do sistema de arrefecimento (serviço)",
      category: "arrefecimento",
      action: "limpar",
      recommendation_type: "preventive_recommended",
      shopping_classification: "service_only",
      group_key: null,
      requires_confirmation: false,
    }),
  inspecao_mangueiras: (): JarvysItem =>
    mk({
      item_key: "inspecao_mangueiras",
      label: "Inspeção de mangueiras (arrefecimento e vácuo)",
      category: "arrefecimento",
      action: "inspecionar",
      recommendation_type: "inspect_only",
      shopping_classification: "service_only",
      group_key: null,
      requires_confirmation: false,
    }),
  inspecao_suspensao: (): JarvysItem =>
    mk({
      item_key: "inspecao_suspensao",
      label: "Inspeção da suspensão (amortecedores, batentes, buchas)",
      category: "suspensao",
      action: "inspecionar",
      recommendation_type: "inspect_only",
      shopping_classification: "service_only",
      group_key: null,
      requires_confirmation: false,
    }),
  palhetas: (): JarvysItem =>
    mk({
      item_key: "palhetas",
      label: "Palhetas do limpador de para-brisa",
      category: "carroceria",
      action: "trocar",
      recommendation_type: "recommended",
      shopping_classification: "safe_to_buy",
      group_key: null,
      requires_confirmation: false,
    }),
  alinhamento_balanceamento: (): JarvysItem =>
    mk({
      item_key: "alinhamento_balanceamento",
      label: "Alinhamento e balanceamento (serviço)",
      category: "pneus",
      action: "regular",
      recommendation_type: "required",
      shopping_classification: "service_only",
      group_key: null,
      requires_confirmation: false,
    }),
  oleo_direcao_hidraulica: (): JarvysItem =>
    mk({
      item_key: "oleo_direcao_hidraulica",
      label: "Óleo da direção hidráulica",
      category: "direcao",
      action: "trocar",
      recommendation_type: "preventive_recommended",
      shopping_classification: "inspect_before_buy",
      group_key: null,
      requires_confirmation: true,
    }),
  oleo_direcao_unknown_service: (): JarvysItem =>
    mk({
      item_key: "oleo_direcao_hidraulica",
      label:
        "Direção: confirmar se é hidráulica antes de qualquer serviço (serviço/diagnóstico)",
      category: "direcao",
      action: "verificar",
      recommendation_type: "inspect_only",
      shopping_classification: "service_only",
      group_key: null,
      requires_confirmation: true,
    }),
  oleo_cambio_manual: (): JarvysItem =>
    mk({
      item_key: "oleo_cambio_manual",
      label: "Óleo do câmbio manual",
      category: "transmissao",
      action: "trocar",
      recommendation_type: "preventive_recommended",
      shopping_classification: "inspect_before_buy",
      group_key: "cambio_manual_kit",
      requires_confirmation: true,
    }),
  oleo_cambio_automatico: (): JarvysItem =>
    mk({
      item_key: "oleo_cambio_automatico",
      label:
        "Óleo e filtro do câmbio automático — troca completa com equipamento especializado",
      category: "transmissao",
      action: "troca_preventiva_recomendada",
      recommendation_type: "preventive_recommended",
      shopping_classification: "inspect_before_buy",
      group_key: "cambio_automatico_kit",
      requires_confirmation: true,
      notes: [AUTO_TRANSMISSION_FULL_SERVICE_NOTE],
    }),
  diagnostico_e_cvt: (): JarvysItem =>
    mk({
      item_key: "diagnostico_e_cvt",
      label:
        "Diagnóstico do sistema híbrido/e-CVT (scanner em oficina especializada)",
      category: "transmissao",
      action: "diagnosticar",
      recommendation_type: "condition_based",
      shopping_classification: "service_only",
      group_key: null,
      requires_confirmation: false,
    }),
  kit_sincronismo: (): JarvysItem =>
    mk({
      item_key: "kit_sincronismo",
      label: "Kit sincronismo (correia dentada + tensor/esticador)",
      category: "motor",
      action: "trocar",
      recommendation_type: "required",
      shopping_classification: "inspect_before_buy",
      group_key: "sincronismo_kit",
      requires_confirmation: true,
    }),
  inspecao_corrente: (): JarvysItem =>
    mk({
      item_key: "inspecao_corrente_comando",
      label:
        "Inspeção do sistema de corrente de comando em oficina especializada, quando aplicável",
      category: "motor",
      action: "inspecionar",
      recommendation_type: "inspect_only",
      shopping_classification: "service_only",
      group_key: null,
      requires_confirmation: false,
    }),
  inspecao_correia_banhada: (): JarvysItem =>
    mk({
      item_key: "inspecao_correia_banhada",
      label: "Inspeção da correia banhada a óleo (serviço especializado)",
      category: "motor",
      action: "diagnosticar",
      recommendation_type: "preventive_recommended",
      shopping_classification: "service_only",
      group_key: null,
      requires_confirmation: false,
      notes: [WET_BELT_CONFIRM_NOTE],
    }),
  correia_banhada_link: (): JarvysItem =>
    mk({
      item_key: "correia_banhada",
      label:
        "Correia banhada a óleo — troca conforme marco, com peça específica do motor",
      category: "motor",
      action: "trocar",
      recommendation_type: "preventive_recommended",
      shopping_classification: "inspect_before_buy",
      group_key: "sincronismo_kit",
      requires_confirmation: true,
      notes: [WET_BELT_CONFIRM_NOTE],
    }),
  correia_poly_v: (): JarvysItem =>
    mk({
      item_key: "correia_poly_v",
      label: "Correia Poly V dos acessórios",
      category: "motor",
      action: "trocar",
      recommendation_type: "preventive_recommended",
      shopping_classification: "inspect_before_buy",
      group_key: "poly_v_kit",
      requires_confirmation: true,
    }),
};

// ─────────────────────────────────────────────────────────────
// Matriz base (perfil aplica filtros)
// ─────────────────────────────────────────────────────────────

type ItemFactory = () => JarvysItem;

function timingFactoriesFor(
  km: number,
  profile: JarvysVehicleProfile,
): ItemFactory[] {
  const list: ItemFactory[] = [];
  const isBeltMilestone = km === 60000 || km === 120000 || km === 180000;
  const isWetLinkMilestone = km === 90000 || km === 180000;
  const isChainInspectMilestone =
    km === 60000 ||
    km === 120000 ||
    km === 140000 ||
    km === 150000 ||
    km === 160000 ||
    km === 180000 ||
    km === 200000;

  if (profile.timingSystem === "correia_dentada" && isBeltMilestone) {
    list.push(ITEMS.kit_sincronismo);
  }
  if (profile.timingSystem === "corrente" && isChainInspectMilestone) {
    list.push(ITEMS.inspecao_corrente);
  }
  if (profile.timingSystem === "correia_banhada") {
    if (isWetLinkMilestone) {
      list.push(ITEMS.correia_banhada_link);
    } else if (
      isBeltMilestone ||
      km === 100000 ||
      km === 150000 ||
      km === 200000
    ) {
      list.push(ITEMS.inspecao_correia_banhada);
    }
  }
  // timing_system "desconhecido" → não emite nada de sincronismo
  return list;
}

function transmissionFactoriesFor(
  km: number,
  profile: JarvysVehicleProfile,
): ItemFactory[] {
  const list: ItemFactory[] = [];
  const isAutoMilestone =
    km === 40000 ||
    km === 80000 ||
    km === 120000 ||
    km === 160000 ||
    km === 200000;
  const isManualMilestone = km === 80000 || km === 160000;
  const isECvtMilestone = km === 100000 || km === 200000;

  if (profile.transmissionKind === "manual" && isManualMilestone) {
    list.push(ITEMS.oleo_cambio_manual);
  }
  if (
    (profile.transmissionKind === "automatico" ||
      profile.transmissionKind === "cvt" ||
      profile.transmissionKind === "automatizado" ||
      profile.transmissionKind === "dupla_embreagem") &&
    isAutoMilestone
  ) {
    list.push(ITEMS.oleo_cambio_automatico);
  }
  if (profile.transmissionKind === "e_cvt" && isECvtMilestone) {
    list.push(ITEMS.diagnostico_e_cvt);
  }
  // "desconhecido" → não emite item de câmbio
  return list;
}

function steeringFactoriesFor(
  km: number,
  profile: JarvysVehicleProfile,
): ItemFactory[] {
  const isSteeringMilestone =
    km === 50000 || km === 100000 || km === 150000 || km === 200000;
  if (!isSteeringMilestone) return [];
  if (profile.steeringKind === "eletrica") return [];
  if (profile.steeringKind === "hidraulica") return [ITEMS.oleo_direcao_hidraulica];
  return [ITEMS.oleo_direcao_unknown_service];
}

function baseFactoriesForKm(km: number): ItemFactory[] {
  const base: ItemFactory[] = [ITEMS.oleo_motor, ITEMS.filtro_oleo];
  const filtros = (): ItemFactory[] => [
    ITEMS.filtro_ar_motor,
    ITEMS.filtro_cabine,
    ITEMS.filtro_combustivel,
  ];
  const fluidoFreioSet = (): ItemFactory[] => [
    ITEMS.fluido_freio,
    ITEMS.sangria_freio,
  ];
  const limpezaMotor = (): ItemFactory[] => [
    ITEMS.velas_ignicao,
    ITEMS.limpeza_tbi_bicos,
    ITEMS.aditivo_radiador,
    ITEMS.limpeza_arrefecimento,
  ];

  switch (km) {
    case 10000:
      base.push(ITEMS.alinhamento_balanceamento);
      return base;
    case 20000:
      base.push(
        ...filtros(),
        ...fluidoFreioSet(),
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 30000:
      base.push(ITEMS.pastilhas_freio, ITEMS.alinhamento_balanceamento);
      return base;
    case 40000:
      base.push(
        ...filtros(),
        ...fluidoFreioSet(),
        ...limpezaMotor(),
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 50000:
      base.push(ITEMS.palhetas, ITEMS.alinhamento_balanceamento);
      return base;
    case 60000:
      base.push(
        ...filtros(),
        ...fluidoFreioSet(),
        ITEMS.pastilhas_freio,
        ITEMS.discos_freio,
        ITEMS.correia_poly_v,
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 70000:
      base.push(ITEMS.inspecao_suspensao, ITEMS.alinhamento_balanceamento);
      return base;
    case 80000:
      base.push(
        ...filtros(),
        ...fluidoFreioSet(),
        ...limpezaMotor(),
        ITEMS.inspecao_mangueiras,
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 90000:
      base.push(
        ITEMS.pastilhas_freio,
        ITEMS.inspecao_suspensao,
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 100000:
      base.push(
        ...filtros(),
        ...fluidoFreioSet(),
        ITEMS.inspecao_mangueiras,
        ITEMS.palhetas,
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 110000:
      base.push(ITEMS.inspecao_suspensao, ITEMS.alinhamento_balanceamento);
      return base;
    case 120000:
      base.push(
        ...filtros(),
        ...fluidoFreioSet(),
        ITEMS.pastilhas_freio,
        ITEMS.discos_freio,
        ITEMS.limpeza_tbi_bicos,
        ITEMS.velas_ignicao,
        ITEMS.correia_poly_v,
        ITEMS.aditivo_radiador,
        ITEMS.limpeza_arrefecimento,
        ITEMS.inspecao_mangueiras,
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 130000:
      base.push(ITEMS.inspecao_suspensao, ITEMS.alinhamento_balanceamento);
      return base;
    case 140000:
      base.push(
        ...filtros(),
        ...fluidoFreioSet(),
        ITEMS.inspecao_mangueiras,
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 150000:
      base.push(
        ITEMS.pastilhas_freio,
        ITEMS.inspecao_suspensao,
        ITEMS.palhetas,
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 160000:
      base.push(
        ...filtros(),
        ...fluidoFreioSet(),
        ...limpezaMotor(),
        ITEMS.inspecao_mangueiras,
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 170000:
      base.push(ITEMS.inspecao_suspensao, ITEMS.alinhamento_balanceamento);
      return base;
    case 180000:
      base.push(
        ...filtros(),
        ...fluidoFreioSet(),
        ITEMS.pastilhas_freio,
        ITEMS.discos_freio,
        ITEMS.correia_poly_v,
        ITEMS.inspecao_mangueiras,
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    case 190000:
      base.push(ITEMS.inspecao_suspensao, ITEMS.alinhamento_balanceamento);
      return base;
    case 200000:
      base.push(
        ...filtros(),
        ...fluidoFreioSet(),
        ...limpezaMotor(),
        ITEMS.inspecao_mangueiras,
        ITEMS.palhetas,
        ITEMS.alinhamento_balanceamento,
      );
      return base;
    default:
      return base;
  }
}

// ─────────────────────────────────────────────────────────────
// Geração de milestones
// ─────────────────────────────────────────────────────────────

/**
 * Itens Jarvys para um marco-base, filtrados pelo perfil técnico.
 * Para elétrico puro retorna lista vazia (matriz de combustão bloqueada).
 */
export function getJarvysBaseMilestoneItems(
  baseKm: number,
  profile: JarvysVehicleProfile,
): JarvysItem[] {
  if (profile.fuelKind === "eletrico_puro") return [];

  const factories: ItemFactory[] = [
    ...baseFactoriesForKm(baseKm),
    ...timingFactoriesFor(baseKm, profile),
    ...transmissionFactoriesFor(baseKm, profile),
    ...steeringFactoriesFor(baseKm, profile),
  ];

  const seen = new Set<string>();
  const items: JarvysItem[] = [];
  for (const f of factories) {
    const item = f();
    if (seen.has(item.item_key)) continue;
    seen.add(item.item_key);
    items.push(item);
  }
  return items;
}

/**
 * Constrói uma milestone Jarvys para um km real qualquer (inclui ciclo
 * infinito acima de 200.000 km).
 */
export function buildJarvysMilestone(
  realKm: number,
  profile: JarvysVehicleProfile,
): JarvysMilestone {
  const { baseKm, cycleIndex } = mapRealKmToBaseKm(realKm);
  const items = getJarvysBaseMilestoneItems(baseKm, profile);
  const notes: string[] = [];
  if (cycleIndex >= 1) notes.push(HIGH_MILEAGE_NOTE);
  if (profile.fuelKind === "eletrico_puro") {
    notes.push(
      "Veículo 100% elétrico: motor determinístico Jarvys não emite itens de combustão. Plano elétrico completo será tratado em build futuro.",
    );
  }
  const revisionKmReal = Math.max(
    JARVYS_BASE_CYCLE_MIN_KM,
    Math.round(realKm / JARVYS_BASE_CYCLE_STEP_KM) * JARVYS_BASE_CYCLE_STEP_KM,
  );
  return {
    revisionKmReal,
    revisionKmBase: baseKm,
    revisionNumber: revisionKmReal / JARVYS_BASE_CYCLE_STEP_KM,
    cycleIndex,
    isHighMileage: cycleIndex >= 1,
    label: `Revisão de ${revisionKmReal.toLocaleString("pt-BR")} km`,
    items,
    notes,
  };
}

/**
 * Faixa contínua de milestones (passo 10k). Usado pelo dry-run para
 * construir o cronograma 10k–200k determinístico.
 */
export function buildJarvysScheduleRange(opts: {
  fromKm: number;
  toKm: number;
  profile: JarvysVehicleProfile;
}): JarvysMilestone[] {
  const { fromKm, toKm, profile } = opts;
  const result: JarvysMilestone[] = [];
  const start = Math.max(JARVYS_BASE_CYCLE_MIN_KM, fromKm);
  for (let km = start; km <= toKm; km += JARVYS_BASE_CYCLE_STEP_KM) {
    result.push(buildJarvysMilestone(km, profile));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// Adapter para o schema estrito (MaintenancePlanJson)
// ─────────────────────────────────────────────────────────────

/**
 * Converte um `JarvysItem` (com campos internos) para `MaintenancePlanItem`
 * compatível com o schema Zod `.strict()`. Campos internos (`group_key`,
 * `requires_confirmation`) são descartados; auditoria preservada em `notes`.
 */
export function toMaintenancePlanItem(item: JarvysItem): MaintenancePlanItem {
  const auditNotes: string[] = [];
  if (item.group_key) auditNotes.push(`[grupo:${item.group_key}]`);
  if (item.requires_confirmation) auditNotes.push("[confirmar_aplicacao]");
  const baseNotes = item.notes ?? [];
  const notes = [...baseNotes, ...auditNotes];
  return {
    item_key: item.item_key,
    label: item.label,
    category: item.category,
    action: item.action,
    recommendation_type: item.recommendation_type,
    shopping_classification: item.shopping_classification,
    applies: item.applies,
    confidence: item.confidence,
    source_type: item.source_type,
    notes: notes.length > 0 ? notes : undefined,
  };
}
