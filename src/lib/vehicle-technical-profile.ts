// Build 6.50D — Helper puro de normalização/resolução do perfil técnico Jarvys.
//
// Zero I/O: sem Supabase, sem React, sem fetch, sem IA, sem banco, sem side
// effects. Transforma DNA técnico (FIPE + corpus `vehicle_maintenance_profiles`)
// em um `JarvysVehicleProfile` normalizado + metadados de confiança/origem.
//
// Regra 6.50D:
// - Normalizadores retornam `null` quando não conseguem resolver (não mais
//   "desconhecido/desconhecida").
// - Perfil final salvo NUNCA contém valores desconhecidos: se qualquer campo
//   obrigatório faltar, `profile` = null e o resultado é low.
// - "desconhecido"/"desconhecida" permanecem nos enums TS apenas por
//   compatibilidade interna do motor determinístico; a IA fallback
//   (server-side) tenta completar antes de cair em low.

import type {
  JarvysFuelKind,
  JarvysSteeringKind,
  JarvysTransmissionKind,
  JarvysVehicleProfile,
} from "./maintenance-jarvys-schedule-rules";
import type { TimingSystem } from "./maintenance-plan-schema";

// ─────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────

export type JarvysTechnicalProfileConfidence = "high" | "medium" | "low";

export type JarvysTechnicalProfileSource =
  | "corpus_curado"
  | "corpus_ia"
  | "derivado_fipe"
  | "desconhecido"
  | "manual_admin"
  | "ia_resolvida";

export type VehicleMaintenanceCorpusProfile = {
  signature?: string | null;
  combustivel?: string | null;
  transmissao?: string | null;
  sistema_distribuicao?: string | null;
  confidence?: string | number | null;
  reviewed_by_admin?: boolean | null;
};

export type VehicleTechnicalProfileInput = {
  combustivelFipe?: string | null;
  vehicleSignature?: string | null;
  corpusProfile?: VehicleMaintenanceCorpusProfile | null;
};

export type ResolvedVehicleTechnicalProfile = {
  profile: JarvysVehicleProfile | null;
  confidence: JarvysTechnicalProfileConfidence;
  source: JarvysTechnicalProfileSource;
  reasons: string[];
  missingFields: Array<
    "fuelKind" | "timingSystem" | "transmissionKind" | "steeringKind"
  >;
  canUseFullSchedule: boolean;
  shouldBlockSensitiveShoppingLinks: boolean;
};

export const JARVYS_TECHNICAL_PROFILE_FALLBACK_MESSAGE =
  "Não conseguimos confirmar com segurança o perfil técnico deste veículo. Alguns itens de revisão podem variar conforme versão, motor, câmbio e configuração. Recomendamos validar as informações do veículo antes de montar o cronograma completo.";

// ─────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────

function normalize(input?: string | null): string {
  if (input === null || input === undefined) return "";
  const s = String(input).trim();
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ─────────────────────────────────────────────────────────────
// Normalizadores (retornam null quando não resolvem)
// ─────────────────────────────────────────────────────────────

export function normalizeFuelKind(
  input?: string | null,
): JarvysFuelKind | null {
  const s = normalize(input);
  if (!s) return null;

  // 1) Híbrido primeiro (cobre "híbrido flex", "plug-in hybrid", etc.)
  if (/hibrid|hybrid|\bhev\b|\bphev\b|plug[-\s]?in/.test(s)) {
    return "hibrido_combustao";
  }

  // 2) Elétrico puro
  if (/\bev\b|\bbev\b|eletric|electric/.test(s)) {
    return "eletrico_puro";
  }

  // 3) Combustão
  if (/gasolin|etanol|alcool|flex|diesel|gnv/.test(s)) {
    return "combustao";
  }

  return null;
}

export function normalizeTransmissionKind(
  input?: string | null,
): JarvysTransmissionKind | null {
  const s = normalize(input);
  if (!s) return null;

  if (/caixa[-\s]?de[-\s]?reducao|caixa[-\s]?reducao|reduction[-\s]?gear|\breducao\b/.test(s)) {
    return "caixa_reducao";
  }
  if (/\bdsg\b|powershift|\bdct\b|dupla[-\s]?embreagem|dupla/.test(s)) {
    return "dupla_embreagem";
  }
  if (/\becvt\b|e[-\s]?cvt/.test(s)) {
    return "e_cvt";
  }
  if (/\bcvt\b/.test(s)) {
    return "cvt";
  }
  if (/dualogic|imotion|easytronic|automatizad/.test(s)) {
    return "automatizado";
  }
  if (/automatic|\bat\b|tiptronic/.test(s)) {
    return "automatico";
  }
  if (/manual|mecanic/.test(s)) {
    return "manual";
  }

  return null;
}

export function normalizeTimingSystem(
  input?: string | null,
): TimingSystem | null {
  const s = normalize(input);
  if (!s) return null;

  if (/nao[-\s]?aplicavel|not[-\s]?applicable|n\/a/.test(s)) {
    return "nao_aplicavel";
  }
  if (/banhad|wet[-\s]?belt/.test(s)) {
    return "correia_banhada";
  }
  if (/corrente/.test(s)) {
    return "corrente";
  }
  if (/correia|dentad|\bseca\b/.test(s)) {
    return "correia_dentada";
  }

  return null;
}

export function normalizeSteeringKind(
  input?: string | null,
): JarvysSteeringKind | null {
  const s = normalize(input);
  if (!s) return null;

  if (/eletric|eletroassist/.test(s)) {
    return "eletrica";
  }
  if (/hidraulic/.test(s)) {
    return "hidraulica";
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Resolver principal
// ─────────────────────────────────────────────────────────────

export function resolveVehicleTechnicalProfile(
  input: VehicleTechnicalProfileInput,
): ResolvedVehicleTechnicalProfile {
  const corpus = input.corpusProfile ?? null;

  const fuelKind: JarvysFuelKind | null =
    normalizeFuelKind(corpus?.combustivel) ??
    normalizeFuelKind(input.combustivelFipe);

  // fuel desconhecido → nada a fazer localmente.
  if (fuelKind === null) {
    const reasons: string[] = [
      "Combustível não identificado a partir de FIPE nem do corpus técnico.",
    ];
    if (!corpus) reasons.push("Sem corpus técnico associado à assinatura.");
    return {
      profile: null,
      confidence: "low",
      source: "desconhecido",
      reasons,
      missingFields: [
        "fuelKind",
        "timingSystem",
        "transmissionKind",
        "steeringKind",
      ],
      canUseFullSchedule: false,
      shouldBlockSensitiveShoppingLinks: true,
    };
  }

  // Resolve timing/transmission/steering, com regras especiais de EV.
  let timingSystem = normalizeTimingSystem(corpus?.sistema_distribuicao);
  let transmissionKind = normalizeTransmissionKind(corpus?.transmissao);
  const steeringKind = normalizeSteeringKind(null); // corpus atual não expõe

  if (fuelKind === "eletrico_puro") {
    if (timingSystem === null) timingSystem = "nao_aplicavel";
    if (transmissionKind === null) transmissionKind = "caixa_reducao";
  }

  const missingFields: ResolvedVehicleTechnicalProfile["missingFields"] = [];
  if (timingSystem === null) missingFields.push("timingSystem");
  if (transmissionKind === null) missingFields.push("transmissionKind");
  if (steeringKind === null) missingFields.push("steeringKind");

  const reasons: string[] = [
    `Combustível identificado como "${fuelKind}".`,
  ];

  // Perfil incompleto → NÃO persistir profile. IA fallback (server-fn) decide.
  if (missingFields.length > 0) {
    reasons.push(
      `Campos ainda desconhecidos: ${missingFields.join(", ")}.`,
    );
    if (!corpus) {
      reasons.push("Sem corpus técnico associado à assinatura.");
    }
    reasons.push(
      "Perfil incompleto — cronograma completo bloqueado até IA/admin resolver.",
    );
    return {
      profile: null,
      confidence: "low",
      source: corpus ? "corpus_ia" : "derivado_fipe",
      reasons,
      missingFields,
      canUseFullSchedule: false,
      shouldBlockSensitiveShoppingLinks: true,
    };
  }

  // Neste ponto todos os campos estão resolvidos e não são "desconhecido".
  const profile: JarvysVehicleProfile = {
    fuelKind,
    timingSystem: timingSystem as TimingSystem,
    transmissionKind: transmissionKind as JarvysTransmissionKind,
    steeringKind: steeringKind as JarvysSteeringKind,
  };

  const reviewed = corpus?.reviewed_by_admin === true;

  if (reviewed) {
    reasons.push("Corpus técnico curado por admin (reviewed_by_admin).");
    return {
      profile,
      confidence: "high",
      source: "corpus_curado",
      reasons,
      missingFields: [],
      canUseFullSchedule: true,
      shouldBlockSensitiveShoppingLinks: false,
    };
  }

  if (corpus) {
    reasons.push(
      "Corpus técnico disponível sem revisão de admin; usar com cautela.",
    );
    return {
      profile,
      confidence: "medium",
      source: "corpus_ia",
      reasons,
      missingFields: [],
      canUseFullSchedule: true,
      shouldBlockSensitiveShoppingLinks: true,
    };
  }

  // Perfil completo sem corpus (ex: EV derivado só de FIPE) — medium/derivado.
  reasons.push("Perfil montado a partir de FIPE + regras de EV.");
  return {
    profile,
    confidence: "medium",
    source: "derivado_fipe",
    reasons,
    missingFields: [],
    canUseFullSchedule: true,
    shouldBlockSensitiveShoppingLinks: true,
  };
}
