import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { safeParseMaintenancePlanJson } from "./maintenance-plan-validation";
import type { MaintenancePlanJson } from "./maintenance-plan-schema";

// ─────────────────────────────────────────────────────────────
// Build 6.30 — Gerador IA dry-run de maintenance_plan_json.
// Admin/debug. NÃO persiste, NÃO altera corpus/profile/curadoria.
// A montagem do technical_context replica a lógica mínima do
// Build 6.26 localmente — chamar uma createServerFn de dentro de
// outra não é um contrato público garantido pelo TanStack Start,
// então mantemos a cópia controlada para não refatorar builds já
// validados.
// ─────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = [
  "placa",
  "chassi",
  "numero_motor",
  "cpf",
  "documento",
  "email",
  "whatsapp",
  "telefone",
  "nome",
  "user_id",
  "vehicle_id",
];

const AI_PROVIDER = "lovable-ai-gateway";
const AI_MODEL = "google/gemini-3-flash-preview";
const RAW_PREVIEW_MAX = 2000;

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const optionalNormalizedString = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .transform((s) => normalizeText(s))
    .nullable()
    .optional(),
);

const optionalString = z.preprocess(
  emptyToNull,
  z.string().trim().nullable().optional(),
);

const optionalIntYear = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  z
    .number()
    .int()
    .nullable()
    .optional()
    .refine(
      (v) => v == null || (v >= 1980 && v <= 2100),
      "ano_modelo fora do intervalo 1980..2100",
    ),
);

const optionalPositiveInt = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  z
    .number()
    .int()
    .nullable()
    .optional()
    .refine((v) => v == null || v > 0, "valor deve ser positivo"),
);

const sistemaDistribuicaoSchema = z
  .enum(["correia_dentada", "corrente", "correia_banhada", "desconhecido"])
  .nullable()
  .optional();

const inputSchema = z
  .object({
    brand: z
      .string()
      .trim()
      .min(1, "brand obrigatório")
      .transform((s) => normalizeText(s)),
    model_group: optionalNormalizedString,
    modelo_fipe: optionalString,
    versao: optionalString,
    ano_modelo: optionalIntYear,
    combustivel: optionalString,
    motor_textual: optionalString,
    cilindradas: optionalPositiveInt,
    transmissao: optionalString,
    sistema_distribuicao: sistemaDistribuicaoSchema,
    km_atual: optionalPositiveInt,
    uso_severo: z.boolean().nullable().optional(),
    historico_desconhecido: z.boolean().nullable().optional(),
    limit: z.number().int().min(1).max(5).optional(),
    maxCharsPerDocument: z.number().int().min(1000).max(6000).optional(),
    mode: z.literal("strict_json").optional(),
  })
  .strict();

type ParsedInput = z.output<typeof inputSchema>;

/**
 * Detecta se a transmissão informada (ou marcadores híbridos equivalentes)
 * representa um sistema e-CVT. Cobre variações de grafia e marcadores comuns:
 * e-cvt, ecvt, e cvt, e_cvt, E-CVT, eCVT, Toyota Hybrid Synergy Drive,
 * BYD DM-i, GWM híbrido, etc.
 */
function isECvtTransmission(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const normalized = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_\s]+/g, " ")
    .trim();
  if (!normalized) return false;
  if (/\becvt\b/.test(normalized)) return true;
  if (/\be cvt\b/.test(normalized)) return true;
  if (normalized.includes("hybrid synergy drive")) return true;
  if (normalized.includes("synergy drive")) return true;
  if (normalized.includes("dm i") || normalized.includes("dmi")) return true;
  if (normalized.includes("byd") && normalized.includes("hibrid")) return true;
  if (normalized.includes("gwm") && normalized.includes("hibrid")) return true;
  if (normalized.includes("e cvt hibrid")) return true;
  return false;
}

function assertNoForbiddenKeysDeep(raw: unknown, depth = 0): void {
  if (raw == null || depth > 4) return;
  if (Array.isArray(raw)) {
    for (const item of raw) assertNoForbiddenKeysDeep(item, depth + 1);
    return;
  }
  if (typeof raw !== "object") return;
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj).map((k) => k.toLowerCase());
  const bad = keys.filter((k) => FORBIDDEN_KEYS.includes(k));
  if (bad.length > 0) {
    throw new Error(`Campos não permitidos no payload: ${bad.join(", ")}.`);
  }
  for (const v of Object.values(obj)) assertNoForbiddenKeysDeep(v, depth + 1);
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

type CorpusRowBase = {
  id: string;
  slug: string;
  title: string;
  brand: string;
  model_group: string;
  generation_range: string | null;
  year_start: number | null;
  year_end: number | null;
  mechanical_families_json: JsonValue;
  coverage_json: JsonValue;
  summary_json: JsonValue;
  quality_score: number | null;
  reviewed_by_admin: boolean | null;
  published: boolean | null;
  version: string | null;
};

type CorpusRowWithText = CorpusRowBase & { extracted_text: string | null };

function bidirectionalContains(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const an = normalizeText(a);
  const bn = normalizeText(b);
  if (!an || !bn) return false;
  return an.includes(bn) || bn.includes(an);
}

function coverageHaystack(coverage: unknown): string {
  if (coverage == null) return "";
  try {
    return normalizeText(JSON.stringify(coverage));
  } catch {
    return "";
  }
}

function getKeywordFlag(summary: unknown, key: string): boolean {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return false;
  }
  const s = summary as Record<string, unknown>;
  const kw = s.detected_keywords;
  if (!kw || typeof kw !== "object" || Array.isArray(kw)) return false;
  return (kw as Record<string, unknown>)[key] === true;
}

function detectFuelHint(combustivel: string | null | undefined): {
  diesel: boolean;
  hibrido: boolean;
  eletrico: boolean;
} {
  const c = combustivel ? normalizeText(combustivel) : "";
  return {
    diesel: /diesel/.test(c),
    hibrido: /hibrido|hybrid/.test(c),
    eletrico: /eletric|electric|\bev\b/.test(c),
  };
}

function scoreRow(
  row: CorpusRowBase,
  input: ParsedInput,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (row.brand && row.brand === input.brand) {
    score += 50;
    reasons.push("brand_exata");
  }

  const corpusModelGroup = row.model_group
    ? normalizeText(row.model_group)
    : "";

  if (
    input.model_group &&
    corpusModelGroup &&
    corpusModelGroup === input.model_group
  ) {
    score += 40;
    reasons.push("model_group_exato");
  }

  if (
    input.modelo_fipe &&
    corpusModelGroup &&
    bidirectionalContains(input.modelo_fipe, corpusModelGroup)
  ) {
    score += 25;
    reasons.push("modelo_fipe_match_model_group");
  }

  if (
    input.versao &&
    corpusModelGroup &&
    bidirectionalContains(input.versao, corpusModelGroup)
  ) {
    score += 15;
    reasons.push("versao_match_model_group");
  }

  const { year_start, year_end } = row;
  if (year_start == null && year_end == null) {
    score += 5;
    reasons.push("ano_range_indefinido");
  } else if (input.ano_modelo != null) {
    const ys = year_start ?? Number.NEGATIVE_INFINITY;
    const ye = year_end ?? Number.POSITIVE_INFINITY;
    if (input.ano_modelo >= ys && input.ano_modelo <= ye) {
      score += 20;
      reasons.push("ano_no_range");
    } else {
      const dist =
        input.ano_modelo < ys ? ys - input.ano_modelo : input.ano_modelo - ye;
      if (dist <= 2) {
        score += 5;
        reasons.push("ano_proximo_range");
      }
    }
  }

  const cov = coverageHaystack(row.coverage_json);
  if (cov.length > 0) {
    if (input.combustivel) {
      const c = normalizeText(input.combustivel);
      if (c && cov.includes(c)) {
        score += 10;
        reasons.push("coverage_combustivel");
      }
    }
    if (input.transmissao) {
      const t = normalizeText(input.transmissao);
      if (t && cov.includes(t)) {
        score += 10;
        reasons.push("coverage_transmissao");
      }
    }
    let motorMatched = false;
    if (input.cilindradas != null) {
      if (cov.includes(String(input.cilindradas))) {
        score += 10;
        reasons.push("coverage_cilindradas");
        motorMatched = true;
      }
    }
    if (!motorMatched && input.motor_textual) {
      const m = normalizeText(input.motor_textual);
      if (m && cov.includes(m)) {
        score += 10;
        reasons.push("coverage_motor_textual");
      }
    }
    if (
      input.sistema_distribuicao &&
      input.sistema_distribuicao !== "desconhecido"
    ) {
      if (cov.includes(input.sistema_distribuicao)) {
        score += 10;
        reasons.push("coverage_sistema_distribuicao");
      }
    }
  }

  const fuel = detectFuelHint(input.combustivel ?? null);
  if (fuel.diesel && getKeywordFlag(row.summary_json, "diesel")) {
    score += 3;
    reasons.push("kw_diesel");
  }
  if (fuel.hibrido && getKeywordFlag(row.summary_json, "hibrido")) {
    score += 3;
    reasons.push("kw_hibrido");
  }
  if (fuel.eletrico && getKeywordFlag(row.summary_json, "eletrico")) {
    score += 3;
    reasons.push("kw_eletrico");
  }
  if (
    input.sistema_distribuicao === "correia_banhada" &&
    getKeywordFlag(row.summary_json, "correia_banhada")
  ) {
    score += 3;
    reasons.push("kw_correia_banhada");
  }
  if (
    input.sistema_distribuicao === "corrente" &&
    getKeywordFlag(row.summary_json, "corrente_comando")
  ) {
    score += 3;
    reasons.push("kw_corrente_comando");
  }

  return { score, reasons };
}

function buildTextExcerpt(text: string | null, maxChars: number): string {
  if (!text) return "";
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length === 0) return "";
  if (normalized.length <= maxChars) return normalized;

  const hardCut = normalized.slice(0, maxChars);
  const minCut = Math.floor(maxChars * 0.6);

  const candidates = [
    hardCut.lastIndexOf("\n\n"),
    hardCut.lastIndexOf(". "),
    hardCut.lastIndexOf("\n"),
  ].filter((idx) => idx >= minCut);

  if (candidates.length > 0) {
    const cutAt = Math.max(...candidates);
    const sliced = hardCut.slice(0, cutAt + 1).trimEnd();
    if (sliced.length > 0 && sliced.length <= maxChars) return sliced;
  }

  return hardCut.trimEnd();
}

async function assertSuperAdmin(userId: string) {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("Falha ao verificar permissões.");
  if (!data?.is_super_admin) throw new Error("Acesso negado.");
}

type ContextDocument = {
  slug: string;
  title: string;
  brand: string;
  model_group: string;
  generation_range: string | null;
  year_start: number | null;
  year_end: number | null;
  score: number;
  reasons: string[];
  coverage_json: JsonValue;
  mechanical_families_json: JsonValue;
  summary_json: JsonValue;
  text_excerpt: string;
  text_excerpt_char_count: number;
};

type TechnicalContext = {
  vehicle_input: Record<string, unknown>;
  totalCandidates: number;
  documents: ContextDocument[];
  warnings: string[];
  limit: number;
  maxCharsPerDocument: number;
};

async function buildTechnicalContext(
  input: ParsedInput,
): Promise<TechnicalContext> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const limit = input.limit ?? 3;
  const maxCharsPerDocument = input.maxCharsPerDocument ?? 3000;

  const { data: rows, error } = await supabaseAdmin
    .from("jarvys_maintenance_corpus")
    .select(
      "id, slug, title, brand, model_group, generation_range, year_start, year_end, mechanical_families_json, coverage_json, summary_json, quality_score, reviewed_by_admin, published, version",
    )
    .eq("brand", input.brand);

  if (error) throw new Error("Falha ao consultar corpus.");

  const candidates = (rows ?? []) as CorpusRowBase[];

  const scored = candidates.map((row) => {
    const { score, reasons } = scoreRow(row, input);
    return { row, score, reasons };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aq = a.row.quality_score ?? 0;
    const bq = b.row.quality_score ?? 0;
    if (bq !== aq) return bq - aq;
    const ar = Number(a.row.reviewed_by_admin ?? false);
    const br = Number(b.row.reviewed_by_admin ?? false);
    if (br !== ar) return br - ar;
    return a.row.title.localeCompare(b.row.title);
  });

  const top = scored.slice(0, limit);
  const topIds = top.map((t) => t.row.id);

  let withText: CorpusRowWithText[] = [];
  if (topIds.length > 0) {
    const { data: detailRows, error: detailError } = await supabaseAdmin
      .from("jarvys_maintenance_corpus")
      .select(
        "id, slug, title, brand, model_group, generation_range, year_start, year_end, mechanical_families_json, coverage_json, summary_json, quality_score, reviewed_by_admin, published, version, extracted_text",
      )
      .in("id", topIds);
    if (detailError) throw new Error("Falha ao carregar documentos.");
    withText = (detailRows ?? []) as CorpusRowWithText[];
  }

  const textById = new Map<string, string | null>(
    withText.map((r) => [r.id, r.extracted_text ?? null]),
  );

  const documents: ContextDocument[] = top.map(({ row, score, reasons }) => {
    const text = textById.get(row.id) ?? null;
    const excerpt = buildTextExcerpt(text, maxCharsPerDocument);
    return {
      slug: row.slug,
      title: row.title,
      brand: row.brand,
      model_group: row.model_group,
      generation_range: row.generation_range,
      year_start: row.year_start,
      year_end: row.year_end,
      score,
      reasons,
      coverage_json: row.coverage_json,
      mechanical_families_json: row.mechanical_families_json,
      summary_json: row.summary_json,
      text_excerpt: excerpt,
      text_excerpt_char_count: excerpt.length,
    };
  });

  const warnings: string[] = [];
  if (documents.length === 0) warnings.push("sem_documentos");
  if (documents.length > 0 && documents[0].score < 70) {
    warnings.push("score_baixo");
  }
  if (isECvtTransmission(input.transmissao)) {
    warnings.push("schema_sem_e_cvt_transmission_type");
  }

  if (documents.some((d) => d.text_excerpt_char_count < 500)) {
    warnings.push("texto_curto_no_contexto");
  }

  const vehicle_input: Record<string, unknown> = {
    brand: input.brand,
    model_group: input.model_group ?? null,
    modelo_fipe: input.modelo_fipe ?? null,
    versao: input.versao ?? null,
    ano_modelo: input.ano_modelo ?? null,
    combustivel: input.combustivel ?? null,
    motor_textual: input.motor_textual ?? null,
    cilindradas: input.cilindradas ?? null,
    transmissao: input.transmissao ?? null,
    sistema_distribuicao: input.sistema_distribuicao ?? null,
    km_atual: input.km_atual ?? null,
    uso_severo: input.uso_severo ?? null,
    historico_desconhecido: input.historico_desconhecido ?? null,
  };

  return {
    vehicle_input,
    totalCandidates: candidates.length,
    documents,
    warnings,
    limit,
    maxCharsPerDocument,
  };
}

// Molde JSON literal compatível com MaintenancePlanJson (schema 1.0.0).
// JSON puro — sem comentários. Explicações ficam fora, no prompt textual.
const MAINTENANCE_PLAN_JSON_CONTRACT = `{
  "schema_version": "1.0.0",
  "vehicle_summary": {
    "display_name": "Marca Modelo Versão Ano",
    "marca": "Marca",
    "modelo_fipe": "Modelo Versão",
    "ano_modelo": 2023,
    "combustivel": "Flex",
    "cilindradas": 1000,
    "motor_textual": "1.0 Turbo Flex",
    "valvulas": 12,
    "transmissao": "manual"
  },
  "base_rules": {
    "revision_interval_km": 10000,
    "revision_interval_months": 12,
    "max_planned_km": 200000,
    "severe_use_oil_interval_km": 5000,
    "severe_use_oil_interval_months": 6
  },
  "system_profile": {
    "timing_system": "corrente",
    "transmission_type": "manual",
    "transmission_service_policy": "troca_programada",
    "transmission_fluid_service_type": "somente_fluido"
  },
  "milestones": [
    {
      "km": 10000,
      "label": "1ª revisão — 10.000 km",
      "revision_number": 1,
      "items": [
        {
          "item_key": "oleo_motor",
          "label": "Óleo do motor",
          "category": "motor",
          "action": "trocar",
          "recommendation_type": "required",
          "shopping_classification": "bundle_preferred",
          "applies": true,
          "interval_km": 10000,
          "interval_months": 12,
          "confidence": 90,
          "source_type": "manual"
        },
        {
          "item_key": "filtro_oleo",
          "label": "Filtro de óleo",
          "category": "filtros",
          "action": "trocar",
          "recommendation_type": "required",
          "shopping_classification": "bundle_preferred",
          "applies": true,
          "confidence": 90,
          "source_type": "manual"
        }
      ],
      "purchase_bundle_keys": ["kit_troca_oleo_motor"]
    }
  ],
  "fixed_intervals": [
    {
      "item_key": "palhetas",
      "label": "Palhetas do limpador",
      "category": "conforto",
      "action": "trocar",
      "interval_months": 12,
      "shopping_classification": "safe_to_buy",
      "recommendation_type": "recommended",
      "applies": true,
      "confidence": 80,
      "source_type": "experiencia_preventiva"
    }
  ],
  "severe_use_rules": [
    {
      "item_key": "oleo_motor",
      "label": "Óleo do motor — uso severo",
      "description": "Reduzir intervalo em uso severo.",
      "interval_km": 5000,
      "interval_months": 6,
      "recommendation_type": "preventive_recommended",
      "source_type": "experiencia_preventiva",
      "confidence": 80
    }
  ],
  "age_based_alerts": [
    {
      "item_key": "bateria",
      "label": "Bateria",
      "trigger_age_years": 3,
      "recommendation_type": "inspect_only",
      "shopping_classification": "inspect_before_buy",
      "reason": "Vida útil média ~3 anos.",
      "source_type": "experiencia_preventiva",
      "confidence": 80
    }
  ],
  "not_applicable_items": [
    {
      "item_key": "kit_correia_dentada",
      "label": "Kit correia dentada",
      "reason": "Motor com corrente de comando.",
      "source_type": "manual",
      "confidence": 90
    }
  ],
  "purchase_bundles": [
    {
      "bundle_key": "kit_troca_oleo_motor",
      "label": "Kit troca de óleo do motor",
      "description": "Óleo recomendado + filtro de óleo.",
      "bundle_type": "kit_troca_oleo_motor",
      "item_keys": ["oleo_motor", "filtro_oleo"],
      "category": "motor",
      "shopping_classification": "safe_to_buy",
      "preferred_search_query_template": "kit troca óleo {modelo} {motor} {ano_modelo}",
      "required_item_keys": ["oleo_motor", "filtro_oleo"],
      "requires_compatibility_confirmation": false,
      "confidence": 85,
      "source_type": "catalogo"
    }
  ],
  "general_notes": ["Plano gerado por IA em modo dry-run."],
  "safety_disclaimer": "Sempre confirme com profissional de confiança antes de executar serviços.",
  "metadata": {
    "generated_at": "2026-06-28T00:00:00.000Z",
    "generated_by": "ia",
    "source": "ia",
    "overall_confidence": 80,
    "reviewed_by_admin": false,
    "schema_notes": ["dry-run"]
  }
}`;

function buildSystemPrompt(opts: { isECvt: boolean } = { isECvt: false }): string {
  const lines: string[] = [
    "Você é um especialista técnico em manutenção automotiva do Jarvys.",
    "Sua tarefa é gerar UM ÚNICO objeto JSON puro, válido contra o schema maintenance_plan_json do Jarvys (schema_version 1.0.0).",
    "",
    "REGRAS DE SAÍDA (obrigatórias):",
    "- Retorne SOMENTE JSON puro. Sem markdown. Sem cercas ```. Sem comentários. Sem texto antes ou depois.",
    '- O campo "schema_version" deve ser exatamente a string "1.0.0".',
    "- Use APENAS as chaves definidas pelo schema. O schema é strict: qualquer chave fora do contrato invalida a saída.",
    "- NUNCA use chaves inventadas como: maintenance_policy, critical_alerts, immediate_recovery_service, future_schedule, brand, model, version, year, engine, transmission, current_km, distribution, ou qualquer outra fora do schema.",
    "",
    "CAMPOS OBRIGATÓRIOS NA RAIZ:",
    "- schema_version, vehicle_summary, base_rules, system_profile, milestones, metadata.",
    "- Opcionais: fixed_intervals, severe_use_rules, age_based_alerts, not_applicable_items, purchase_bundles, general_notes, safety_disclaimer.",
    "",
    "ESTRUTURA DE CAMPOS:",
    '- vehicle_summary exige "display_name" (string). Demais (marca, modelo_fipe, ano_modelo, combustivel, cilindradas, motor_textual, valvulas, transmissao) são opcionais, mas preencha quando o contexto permitir.',
    "- base_rules exige revision_interval_km e revision_interval_months (inteiros positivos). Pode incluir max_planned_km, severe_use_oil_interval_km, severe_use_oil_interval_months.",
    "- system_profile exige timing_system, transmission_type, transmission_service_policy, transmission_fluid_service_type.",
    "- milestones é um array com pelo menos 1 marco. Cada marco exige km (inteiro positivo), label e items (≥1).",
    "- Cada item de milestone exige: item_key, label, category, action, recommendation_type, shopping_classification, applies (boolean).",
    '- Se recommendation_type for "not_applicable", então applies DEVE ser false E shopping_classification DEVE ser "not_applicable".',
    "- metadata exige generated_at (ISO string), generated_by, source.",
    "",
    "ENUMS PERMITIDOS (use apenas estes valores):",
    "- timing_system: correia_dentada | corrente | correia_banhada | desconhecido",
    "- transmission_type: manual | automatico | cvt | automatizado | dupla_embreagem | desconhecido",
    "- transmission_service_policy: troca_programada | preventiva_recomendada | sem_troca_programada | verificar_manual | desconhecido",
    "- transmission_fluid_service_type: somente_fluido | fluido_e_um_filtro | fluido_e_dois_filtros | fluido_filtro_junta | filtro_interno_nao_servicavel | sem_troca_programada | desconhecido",
    "- category: motor | filtros | ignicao | arrefecimento | freios | suspensao | direcao | pneus | transmissao | eletrica | carroceria | diagnostico | conforto | outros",
    "- action: trocar | verificar | inspecionar | limpar | regular | completar | diagnosticar | resetar_aviso | troca_preventiva_recomendada | nao_aplicavel",
    "- recommendation_type: required | recommended | preventive_recommended | inspect_only | condition_based | not_applicable | unknown",
    "- shopping_classification: safe_to_buy | service_only | inspect_before_buy | bundle_preferred | do_not_link | not_applicable | unknown",
    "- bundle_type: kit_troca_oleo_motor | kit_filtros | kit_revisao_completa | kit_correia_dentada | kit_correia_acessorios | kit_cambio_manual | kit_cambio_automatico | kit_freio | kit_arrefecimento | kit_ignicao | outro",
    "- source_type (item/bundle/metadata.source): manual | ia | curadoria | catalogo | fornecedor | experiencia_preventiva | sistema",
    "- metadata.generated_by: ia | manual | curadoria | sistema",
    "",
    "REGRA CRÍTICA DE ENUMS DE TRANSMISSÃO:",
    "- system_profile.transmission_service_policy aceita SOMENTE os valores em português do schema: troca_programada | preventiva_recomendada | sem_troca_programada | verificar_manual | desconhecido.",
    "- Para câmbio automático, CVT ou automatizado quando a recomendação for preventiva, use exatamente: preventiva_recomendada.",
    "- NUNCA use preventive_recommended em system_profile.transmission_service_policy.",
    "- preventive_recommended só pode aparecer em items[].recommendation_type (que usa enums em inglês).",
    "- Não misture enums em português de system_profile com enums em inglês dos items.",
    "- Se estiver em dúvida, use verificar_manual ou desconhecido. Nunca invente valores.",
    "",
    "REGRA CRÍTICA SOBRE e-CVT:",
    "- e-CVT NÃO é CVT convencional. Não normalize e-CVT para CVT convencional.",
    '- Use "cvt" SOMENTE para CVT convencional (caixa de variação contínua mecânica/hidráulica não híbrida).',
    '- NUNCA use "e-cvt" (com hífen) em nenhum campo enum do JSON final. O schema não aceita.',
    '- Enquanto o schema NÃO aceitar "e_cvt", para veículos com e-CVT use OBRIGATORIAMENTE:',
    '    system_profile.transmission_type = "desconhecido"',
    '    system_profile.transmission_fluid_service_type = "desconhecido" (salvo se o technical_context ou manual disser EXPLICITAMENTE que existe fluido com intervalo de troca definido)',
    '    vehicle_summary.transmissao = "desconhecido"',
    "- Trate como e-CVT quando o veículo informar: e-CVT, eCVT, E-CVT, e_cvt, híbrido com e-CVT, Toyota Hybrid Synergy Drive, BYD DM-i, GWM híbrido ou sistema híbrido equivalente.",
    "- Para e-CVT, NÃO recomende troca preventiva padrão de óleo do câmbio, filtro de câmbio, kit de câmbio ou manutenção de CVT convencional.",
    "- Nos KMs típicos de revisão de câmbio, recomende INSPEÇÃO/DIAGNÓSTICO do sistema híbrido/e-CVT com scanner automotivo ou equipamento diagnóstico adequado.",
    "- A recomendação deve mencionar: verificação de códigos de falha, parâmetros eletrônicos, funcionamento do conjunto híbrido/e-CVT, ruídos/anomalias e eventuais vazamentos quando aplicável.",
    "- Só recomende troca de fluido em e-CVT se o technical_context ou manual informado disser EXPLICITAMENTE que existe fluido com intervalo de troca definido.",
    "- Em histórico desconhecido ou alta quilometragem, recomende diagnóstico prévio com scanner/equipamento adequado antes de qualquer intervenção.",
    "- Evite flush químico/agressivo.",
    "- Para itens de transmissão em e-CVT, prefira:",
    '    action = "diagnosticar" | "inspecionar" | "verificar"',
    '    recommendation_type = "inspect_only" | "condition_based"',
    '    shopping_classification = "service_only" | "inspect_before_buy"',
    "- NUNCA gere bundle/item de compra segura para óleo/filtro/kit de e-CVT sem suporte EXPLÍCITO do technical_context.",
    "",
    "REGRA CRÍTICA DE CRONOGRAMA POR MILESTONES (10k–200k):",
    "- O array milestones DEVE conter EXATAMENTE as 20 revisões obrigatórias, em km, na ordem crescente:",
    "    10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000, 110000, 120000, 130000, 140000, 150000, 160000, 170000, 180000, 190000, 200000.",
    "- Mínimo absoluto: milestones.length >= 20. Primeira = 10000 km. Última = 200000 km. Passo fixo = 10000 km.",
    "- revision_number = km / 10000 (ex.: 10000→1, 60000→6, 100000→10, 200000→20).",
    '- label sugerido: "Revisão de {N}.000 km" (ex.: "Revisão de 60.000 km").',
    "- CADA milestone obrigatória DEVE conter pelo menos 1 item em items[]. Nunca emita milestone sem itens.",
    "- O km_atual do veículo é APENAS contexto. NÃO use km_atual para limitar, truncar, pular ou omitir milestones. NÃO gere apenas a próxima revisão. NÃO omita revisões anteriores. O plano deve ser SEMPRE o cronograma completo.",
    "- Distribuição típica de itens (use o technical_context para refinar):",
    "    * Toda revisão (10k em 10k): óleo do motor, filtro de óleo, inspeções básicas (freios, suspensão, arrefecimento, luzes), checagem/rodízio/calibragem de pneus quando aplicável.",
    "    * Revisões alternadas (20k/30k/40k): filtro de ar do motor, filtro de cabine, filtro de combustível, limpeza/verificação de TBI, inspeção de correias, fluido de freio por tempo/km.",
    "    * Marcos maiores: velas, correia poly V/acessórios, líquido de arrefecimento, fluido de freio, correia dentada/kit sincronismo (quando aplicável), correia banhada (inspeção/diagnóstico), óleo de câmbio automático/CVT convencional (troca completa com máquina), diagnóstico de automatizado/dupla embreagem/PowerShift, diagnóstico híbrido/e-CVT, inspeções de alta quilometragem.",
    "",
    "REGRAS CRÍTICAS DE COMPATIBILIDADE TÉCNICA:",
    '- timing_system = "corrente": NUNCA gere item nem bundle de troca de correia dentada/kit sincronismo. Em alta km pode haver inspeção de corrente.',
    '- timing_system = "correia_dentada": gere troca preventiva em milestone(s) coerente(s) (tipicamente 60k–100k conforme contexto). category = "motor". action = "trocar" ou "troca_preventiva_recomendada". Em dúvida, prefira recomendação conservadora.',
    '- timing_system = "correia_banhada": item crítico. Prefira inspeção/diagnóstico preventivo (action = "inspecionar"/"diagnosticar"). NÃO tratar como correia dentada comum.',
    "- Elétrico puro: NÃO gere óleo de motor, filtro de óleo, velas, correia dentada, kit sincronismo nem qualquer item de motor a combustão.",
    "- Híbrido com motor a combustão: pode haver óleo do motor e filtro de óleo; trate o sistema híbrido com inspeções/diagnóstico quando aplicável.",
    "- Câmbio automático/CVT convencional/automatizado/dupla embreagem/PowerShift: NUNCA recomende troca parcial. Manutenção de fluido = troca COMPLETA com máquina, fluido correto, filtro quando aplicável. Em alta km/histórico desconhecido, oriente diagnóstico prévio. Evite flush químico/agressivo.",
    "",
    "REGRAS CRÍTICAS DE ÓLEO DO MOTOR (engine_oil_profile):",
    "- Use o technical_context.engine_oil_profile quando disponível.",
    '- Se engine_oil_profile.status = "insufficient": NÃO invente viscosidade (SAE), NÃO invente norma (API/ACEA/Dexos/Fiat), NÃO invente quantidade em litros. Ainda assim, mantenha "oleo_motor" e "filtro_oleo" em milestones para veículos a combustão.',
    '- Label sugerido nesse caso: "Óleo do motor — especificação a confirmar conforme manual". Filtro: "Filtro de óleo".',
    '- Para óleo do motor com perfil insuficiente, use shopping_classification = "inspect_before_buy". NUNCA "safe_to_buy".',
    "- Este build NÃO precisa gerar links/SKU de shopping. Foco é o cronograma técnico.",
    "",
    "PURCHASE BUNDLES (não são foco deste build):",
    "- Bundles podem existir, mas não invente SKU/URL/afiliado/viscosidade/norma/quantidade.",
    "- Não crie chaves fora do schema. Não inclua bundle de correia dentada se timing_system != correia_dentada. Não inclua bundle de CVT para e-CVT.",
    "",
    "REGRAS TÉCNICAS:",
    "- Use o technical_context fornecido como fonte principal e respeite os dados do veículo.",
    "- Se houver incerteza, prefira recomendações conservadoras; nunca invente dado específico não suportado pelo contexto.",
    "- Para câmbio automático ou CVT convencional, NUNCA recomende troca parcial do óleo do câmbio: recomende troca completa com máquina especializada, fluido correto e filtro quando elegível.",
    "- Em alta quilometragem ou histórico desconhecido, oriente diagnóstico prévio antes de troca completa.",
    "- Evite flush químico/agressivo.",
    "- Considere uso severo quando informado.",
    "",
    "ESTRUTURA OBRIGATÓRIA — o JSON abaixo é um MOLDE ESTRUTURAL com apenas 1 milestone como amostra. A SAÍDA REAL DEVE conter as 20 milestones obrigatórias (10k até 200k). Copie EXATAMENTE as chaves; substitua valores conforme o veículo e o technical_context. Não adicione chaves novas. Não remova chaves obrigatórias. Arrays opcionais podem ser omitidos se não fizerem sentido:",
    MAINTENANCE_PLAN_JSON_CONTRACT,

  ];

  if (opts.isECvt) {
    lines.push(
      "",
      "DIRETIVA ESPECÍFICA PARA ESTE VEÍCULO:",
      '- O veículo atual usa e-CVT. Defina OBRIGATORIAMENTE: system_profile.transmission_type = "desconhecido", system_profile.transmission_fluid_service_type = "desconhecido" (salvo suporte explícito do technical_context com intervalo definido) e vehicle_summary.transmissao = "desconhecido".',
      "- Aplique TODAS as regras técnicas de e-CVT acima nos itens do plano: inspeção/diagnóstico com scanner em vez de troca preventiva padrão de óleo/filtro/kit de câmbio.",
    );
  }

  return lines.join("\n");
}

function buildUserPrompt(ctx: TechnicalContext): string {
  const payload = {
    vehicle: ctx.vehicle_input,
    technical_context: {
      totalCandidates: ctx.totalCandidates,
      returned: ctx.documents.length,
      documents: ctx.documents.map((d) => ({
        slug: d.slug,
        title: d.title,
        brand: d.brand,
        model_group: d.model_group,
        generation_range: d.generation_range,
        year_start: d.year_start,
        year_end: d.year_end,
        score: d.score,
        reasons: d.reasons,
        coverage_json: d.coverage_json,
        mechanical_families_json: d.mechanical_families_json,
        summary_json: d.summary_json,
        text_excerpt: d.text_excerpt,
      })),
    },
  };
  return [
    "Gere o maintenance_plan_json para o veículo abaixo.",
    "Responda apenas com o JSON do plano. Sem markdown.",
    "",
    JSON.stringify(payload),
  ].join("\n");
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    const withoutOpen = trimmed.replace(/^```(?:json)?\s*/i, "");
    const withoutClose = withoutOpen.replace(/```\s*$/i, "");
    return withoutClose.trim();
  }
  return trimmed;
}

function clipPreview(raw: string): string {
  if (raw.length <= RAW_PREVIEW_MAX) return raw;
  return raw.slice(0, RAW_PREVIEW_MAX);
}

type AiCallResult =
  | {
      ok: true;
      content: string;
      usage: JsonValue;
    }
  | {
      ok: false;
      error: string;
    };

async function callLovableAi(
  systemPrompt: string,
  userPrompt: string,
): Promise<AiCallResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "LOVABLE_API_KEY não configurada no servidor." };
  }

  let resp: Response;
  try {
    resp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        }),
      },
    );
  } catch {
    return { ok: false, error: "Falha de rede ao contatar a IA." };
  }

  if (!resp.ok) {
    if (resp.status === 429) {
      return { ok: false, error: "IA indisponível: limite de requisições." };
    }
    if (resp.status === 402) {
      return { ok: false, error: "IA indisponível: créditos esgotados." };
    }
    return {
      ok: false,
      error: `IA indisponível (status ${resp.status}).`,
    };
  }

  let json: {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: JsonValue;
  };
  try {
    const parsed: unknown = await resp.json();
    // Normaliza para JsonValue serializável (remove referências não-serializáveis).
    json = JSON.parse(JSON.stringify(parsed)) as typeof json;
  } catch {
    return { ok: false, error: "Resposta da IA não pôde ser lida." };
  }

  const content = json.choices?.[0]?.message?.content?.toString() ?? "";
  if (!content.trim()) {
    return { ok: false, error: "Resposta da IA veio vazia." };
  }

  return { ok: true, content, usage: json.usage ?? null };
}

type DryRunResult = {
  valid: boolean;
  plan: MaintenancePlanJson | null;
  errors: string[];
  warnings: string[];
  ai: {
    provider: string | null;
    model: string | null;
    usage?: JsonValue;
  };
  technical_context_debug: {
    totalCandidates: number;
    returned: number;
    documents: Array<{
      slug: string;
      title: string;
      score: number;
      reasons: string[];
      text_excerpt_char_count: number;
    }>;
  };
  raw_preview?: string;
};

function buildDebug(ctx: TechnicalContext) {
  return {
    totalCandidates: ctx.totalCandidates,
    returned: ctx.documents.length,
    documents: ctx.documents.map((d) => ({
      slug: d.slug,
      title: d.title,
      score: d.score,
      reasons: d.reasons,
      text_excerpt_char_count: d.text_excerpt_char_count,
    })),
  };
}

export const generateMaintenancePlanFromCorpusDryRunFn = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    assertNoForbiddenKeysDeep(input);
    return inputSchema.parse(input);
  })
  .handler(async ({ context, data }): Promise<DryRunResult> => {
    await assertSuperAdmin(context.userId);

    const ctx = await buildTechnicalContext(data);

    const baseWarnings = [...ctx.warnings];

    if (ctx.documents.length === 0) {
      return {
        valid: false,
        plan: null,
        errors: [
          "Nenhum documento técnico encontrado para este veículo.",
        ],
        warnings: baseWarnings,
        ai: { provider: null, model: null },
        technical_context_debug: buildDebug(ctx),
      };
    }

    const isECvt = baseWarnings.includes("schema_sem_e_cvt_transmission_type");
    const systemPrompt = buildSystemPrompt({ isECvt });
    const userPrompt = buildUserPrompt(ctx);

    const ai = await callLovableAi(systemPrompt, userPrompt);

    if (!ai.ok) {
      return {
        valid: false,
        plan: null,
        errors: [ai.error],
        warnings: baseWarnings,
        ai: { provider: AI_PROVIDER, model: AI_MODEL },
        technical_context_debug: buildDebug(ctx),
      };
    }

    const raw = ai.content;
    const preview = clipPreview(raw);
    const cleaned = stripJsonFences(raw);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch {
      return {
        valid: false,
        plan: null,
        errors: ["Resposta da IA não é JSON válido."],
        warnings: baseWarnings,
        ai: { provider: AI_PROVIDER, model: AI_MODEL, usage: ai.usage },
        technical_context_debug: buildDebug(ctx),
        raw_preview: preview,
      };
    }

    const validation = safeParseMaintenancePlanJson(parsedJson);
    if (!validation.success) {
      const errors = validation.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${path}: ${issue.message}`;
      });
      return {
        valid: false,
        plan: null,
        errors,
        warnings: baseWarnings,
        ai: { provider: AI_PROVIDER, model: AI_MODEL, usage: ai.usage },
        technical_context_debug: buildDebug(ctx),
        raw_preview: preview,
      };
    }

    return {
      valid: true,
      plan: validation.data,
      errors: [],
      warnings: baseWarnings,
      ai: { provider: AI_PROVIDER, model: AI_MODEL, usage: ai.usage },
      technical_context_debug: buildDebug(ctx),
      raw_preview: preview,
    };
  });
