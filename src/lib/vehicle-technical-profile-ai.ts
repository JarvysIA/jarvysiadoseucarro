// Build 6.50D — Helper puro para IA classificar o perfil técnico Jarvys.
//
// Zero I/O: sem fetch, sem Supabase, sem React. Apenas:
//   - buildAiPrompt(input): monta system + user prompt determinístico.
//   - validateAiResolvedTechnicalProfile(raw): valida rígidamente a resposta
//     da IA contra os enums Jarvys.
//
// A chamada HTTP real ao gateway Lovable AI é feita pela server function
// `resolveAndSaveVehicleTechnicalProfileFn`. Este arquivo não conhece rede.

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

export type AiTechnicalProfileInput = {
  marca?: string | null;
  modelo?: string | null;
  modelo_fipe?: string | null;
  ano?: number | string | null;
  ano_modelo?: number | null;
  combustivel_fipe?: string | null;
  motorizacao?: string | null;
  cilindradas?: number | null;
  codigo_fipe?: string | null;
  codigo_marca?: string | null;
  codigo_modelo?: string | null;
  vehicle_signature?: string | null;
};

export type ValidatedAiTechnicalProfile =
  | {
      ok: true;
      profile: JarvysVehicleProfile;
      confidence: "medium" | "low";
      evidence: string[];
      warnings: string[];
    }
  | {
      ok: false;
      reason: string;
    };

// ─────────────────────────────────────────────────────────────
// Enums permitidos (subset restrito da IA — NÃO aceita "desconhecido")
// ─────────────────────────────────────────────────────────────

const AI_FUEL_ENUM: readonly JarvysFuelKind[] = [
  "combustao",
  "hibrido_combustao",
  "eletrico_puro",
] as const;

const AI_TIMING_ENUM: readonly TimingSystem[] = [
  "correia_dentada",
  "correia_banhada",
  "corrente",
  "nao_aplicavel",
] as const;

const AI_TRANSMISSION_ENUM: readonly JarvysTransmissionKind[] = [
  "manual",
  "automatico",
  "cvt",
  "e_cvt",
  "automatizado",
  "dupla_embreagem",
  "caixa_reducao",
] as const;

const AI_STEERING_ENUM: readonly JarvysSteeringKind[] = [
  "hidraulica",
  "eletrica",
] as const;

// ─────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "Você é um classificador técnico automotivo para o Jarvys. " +
  "Sua tarefa é apenas classificar o perfil técnico do veículo para alimentar " +
  "um motor determinístico de manutenção preventiva. " +
  "Você NÃO deve gerar cronograma, peças, intervalos, links ou texto livre. " +
  "Retorne APENAS JSON puro.";

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = String(v).trim();
  return s.length > 0 ? s : "—";
}

export function buildAiPrompt(input: AiTechnicalProfileInput): {
  system: string;
  user: string;
} {
  const dados = [
    `- marca: ${fmt(input.marca)}`,
    `- modelo: ${fmt(input.modelo)}`,
    `- modelo_fipe: ${fmt(input.modelo_fipe)}`,
    `- ano: ${fmt(input.ano)}`,
    `- ano_modelo: ${fmt(input.ano_modelo)}`,
    `- combustivel_fipe: ${fmt(input.combustivel_fipe)}`,
    `- motorizacao: ${fmt(input.motorizacao)}`,
    `- cilindradas: ${fmt(input.cilindradas)}`,
    `- codigo_fipe: ${fmt(input.codigo_fipe)}`,
    `- codigo_marca: ${fmt(input.codigo_marca)}`,
    `- codigo_modelo: ${fmt(input.codigo_modelo)}`,
    `- vehicle_signature: ${fmt(input.vehicle_signature)}`,
  ].join("\n");

  const user =
    `Classifique o perfil técnico deste veículo usando SOMENTE os dados FIPE/modelo abaixo.\n\n` +
    `DADOS DO VEÍCULO:\n${dados}\n\n` +
    `VALORES PERMITIDOS:\n\n` +
    `fuelKind: "combustao" | "hibrido_combustao" | "eletrico_puro"\n\n` +
    `timingSystem: "correia_dentada" | "correia_banhada" | "corrente" | "nao_aplicavel"\n` +
    `Regras:\n` +
    `- Para combustão/híbrido, use apenas correia_dentada, correia_banhada ou corrente.\n` +
    `- Para elétrico puro, use nao_aplicavel.\n` +
    `- Não use desconhecido.\n\n` +
    `transmissionKind: "manual" | "automatico" | "cvt" | "e_cvt" | "automatizado" | "dupla_embreagem" | "caixa_reducao"\n` +
    `Regras:\n` +
    `- Se a versão FIPE indicar Aut., Automático, AT ou equivalente, use automatico, salvo se for CVT/e-CVT/dupla embreagem explícito.\n` +
    `- Se indicar Mec. ou Manual, use manual.\n` +
    `- Para elétrico puro, use caixa_reducao quando aplicável.\n` +
    `- Atenção: não assuma que todo híbrido usa e-CVT. Determine o transmissionKind pelo modelo/versão informado. Use e_cvt somente quando houver indicação técnica de e-CVT/transaxle híbrido.\n` +
    `- Não use desconhecido.\n\n` +
    `steeringKind: "hidraulica" | "eletrica"\n` +
    `Regras:\n` +
    `- Classifique como hidraulica ou eletrica.\n` +
    `- Não use desconhecida.\n\n` +
    `confidence: "medium" | "low"\n` +
    `Regras:\n` +
    `- Use medium quando conseguir classificar todos os campos obrigatórios com segurança.\n` +
    `- Use low somente se o veículo for muito antigo, raro, recém-lançado ou se os dados forem insuficientes.\n` +
    `- Nunca use high.\n\n` +
    `Retorne APENAS JSON puro neste formato (sem markdown, sem texto livre):\n` +
    `{\n` +
    `  "fuelKind": "combustao",\n` +
    `  "timingSystem": "correia_dentada",\n` +
    `  "transmissionKind": "automatico",\n` +
    `  "steeringKind": "eletrica",\n` +
    `  "confidence": "medium",\n` +
    `  "evidence": ["Modelo FIPE indica ...", "Família técnica usa correia dentada", "Versão FIPE indica câmbio automático", "Configuração do modelo indica direção elétrica"],\n` +
    `  "warnings": []\n` +
    `}`;

  return { system: SYSTEM_PROMPT, user };
}

// ─────────────────────────────────────────────────────────────
// Validação rígida
// ─────────────────────────────────────────────────────────────

function tryParseJson(raw: unknown): unknown {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Rejeita markdown wrapper explícito.
  if (/^```/.test(trimmed) || /```$/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function asStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function includesAs<T extends string>(
  arr: readonly T[],
  v: unknown,
): v is T {
  return typeof v === "string" && (arr as readonly string[]).includes(v);
}

export function validateAiResolvedTechnicalProfile(
  raw: unknown,
): ValidatedAiTechnicalProfile {
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "JSON inválido ou vazio." };
  }

  const obj = parsed as Record<string, unknown>;

  const { fuelKind, timingSystem, transmissionKind, steeringKind, confidence } =
    obj;

  if (!includesAs(AI_FUEL_ENUM, fuelKind)) {
    return { ok: false, reason: `fuelKind fora do enum: ${String(fuelKind)}` };
  }
  if (!includesAs(AI_TIMING_ENUM, timingSystem)) {
    return {
      ok: false,
      reason: `timingSystem fora do enum: ${String(timingSystem)}`,
    };
  }
  if (!includesAs(AI_TRANSMISSION_ENUM, transmissionKind)) {
    return {
      ok: false,
      reason: `transmissionKind fora do enum: ${String(transmissionKind)}`,
    };
  }
  if (!includesAs(AI_STEERING_ENUM, steeringKind)) {
    return {
      ok: false,
      reason: `steeringKind fora do enum: ${String(steeringKind)}`,
    };
  }

  if (confidence !== "medium" && confidence !== "low") {
    return {
      ok: false,
      reason: `confidence inválido (esperado medium|low): ${String(confidence)}`,
    };
  }

  // Coerência combustível ↔ sistema de distribuição / câmbio.
  if (fuelKind === "eletrico_puro") {
    if (timingSystem !== "nao_aplicavel") {
      return {
        ok: false,
        reason: "Elétrico puro deve ter timingSystem = nao_aplicavel.",
      };
    }
    if (
      transmissionKind !== "caixa_reducao" &&
      transmissionKind !== "e_cvt" &&
      transmissionKind !== "automatico"
    ) {
      return {
        ok: false,
        reason:
          "Elétrico puro deve ter transmissionKind em {caixa_reducao, e_cvt, automatico}.",
      };
    }
  } else {
    // combustão / híbrido
    if (timingSystem === "nao_aplicavel") {
      return {
        ok: false,
        reason:
          "Combustão/híbrido não pode ter timingSystem = nao_aplicavel.",
      };
    }
    if (transmissionKind === "caixa_reducao") {
      return {
        ok: false,
        reason:
          "Combustão/híbrido não pode ter transmissionKind = caixa_reducao.",
      };
    }
  }

  const evidence = asStringArray(obj.evidence);
  const warnings = asStringArray(obj.warnings);

  // Para MEDIUM exigimos evidence com pelo menos um item — evita "aceitar tudo".
  if (confidence === "medium" && evidence.length === 0) {
    return {
      ok: false,
      reason: "confidence=medium exige ao menos um item em evidence.",
    };
  }

  const profile: JarvysVehicleProfile = {
    fuelKind,
    timingSystem,
    transmissionKind,
    steeringKind,
  };

  return {
    ok: true,
    profile,
    confidence,
    evidence,
    warnings,
  };
}
