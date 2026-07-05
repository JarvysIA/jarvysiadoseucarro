// Build 6.50A — Helper puro de normalização/resolução do perfil técnico Jarvys.
//
// Zero I/O: sem Supabase, sem React, sem fetch, sem IA, sem banco, sem side
// effects. Transforma DNA técnico (FIPE + corpus `vehicle_maintenance_profiles`)
// em um `JarvysVehicleProfile` normalizado + metadados de confiança/origem.
//
// Consumido futuramente por:
//   - resolveAndSaveVehicleTechnicalProfileFn (server-fn, Build 6.50B)
//   - cadastro (signup + AddVehicleModal, Build 6.50C)
//   - backfill admin (Build 6.50D)
//   - Home / NextRevisionCard / MaintenanceReviewShoppingSheet (Build 6.51)
//
// Neste build o helper apenas EXISTE. Nada é integrado ainda.

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
  | "manual_admin";

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
// Normalizadores
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
): JarvysTransmissionKind {
  const s = normalize(input);
  if (!s) return "desconhecido";

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

  return "desconhecido";
}

export function normalizeTimingSystem(
  input?: string | null,
): TimingSystem {
  const s = normalize(input);
  if (!s) return "desconhecido";

  if (/banhad|wet[-\s]?belt/.test(s)) {
    return "correia_banhada";
  }
  if (/corrente/.test(s)) {
    return "corrente";
  }
  if (/correia|dentad|\bseca\b/.test(s)) {
    return "correia_dentada";
  }

  return "desconhecido";
}

export function normalizeSteeringKind(
  input?: string | null,
): JarvysSteeringKind {
  const s = normalize(input);
  if (!s) return "desconhecida";

  if (/eletric|eletroassist/.test(s)) {
    return "eletrica";
  }
  if (/hidraulic/.test(s)) {
    return "hidraulica";
  }

  return "desconhecida";
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

  const timingSystem = normalizeTimingSystem(corpus?.sistema_distribuicao);
  const transmissionKind = normalizeTransmissionKind(corpus?.transmissao);
  const steeringKind: JarvysSteeringKind = "desconhecida";

  const reasons: string[] = [];

  // Sem fuelKind identificável → não conseguimos montar perfil confiável.
  if (fuelKind === null) {
    reasons.push(
      "Combustível não identificado a partir de FIPE nem do corpus técnico.",
    );
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

  const profile: JarvysVehicleProfile = {
    fuelKind,
    timingSystem,
    transmissionKind,
    steeringKind,
  };

  const missingFields: ResolvedVehicleTechnicalProfile["missingFields"] = [];
  if (timingSystem === "desconhecido") missingFields.push("timingSystem");
  if (transmissionKind === "desconhecido")
    missingFields.push("transmissionKind");
  if (steeringKind === "desconhecida") missingFields.push("steeringKind");

  reasons.push(`Combustível identificado como "${fuelKind}".`);

  const timingKnown = timingSystem !== "desconhecido";
  const transmissionKnown = transmissionKind !== "desconhecido";
  const reviewed = corpus?.reviewed_by_admin === true;

  // HIGH — corpus curado por admin + timing + transmission conhecidos
  if (reviewed && timingKnown && transmissionKnown) {
    reasons.push("Corpus técnico curado por admin (reviewed_by_admin).");
    return {
      profile,
      confidence: "high",
      source: "corpus_curado",
      reasons,
      missingFields,
      canUseFullSchedule: true,
      shouldBlockSensitiveShoppingLinks: false,
    };
  }

  // MEDIUM — corpus existe (sem review) e pelo menos timing OU transmission
  if (corpus && !reviewed && (timingKnown || transmissionKnown)) {
    reasons.push(
      "Corpus técnico disponível sem revisão de admin; usar com cautela.",
    );
    if (missingFields.length > 0) {
      reasons.push(
        `Campos ainda desconhecidos: ${missingFields.join(", ")}.`,
      );
    }
    return {
      profile,
      confidence: "medium",
      source: "corpus_ia",
      reasons,
      missingFields,
      canUseFullSchedule: true,
      shouldBlockSensitiveShoppingLinks: true,
    };
  }

  // LOW — só FIPE utilizável (ou corpus sem informação estrutural)
  reasons.push(
    "Perfil derivado apenas de FIPE; sistema de distribuição, câmbio e direção não confirmados.",
  );
  reasons.push(
    "Cronograma completo bloqueado; recomendar validação antes de compras sensíveis.",
  );
  return {
    profile,
    confidence: "low",
    source: "derivado_fipe",
    reasons,
    missingFields,
    canUseFullSchedule: false,
    shouldBlockSensitiveShoppingLinks: true,
  };
}
