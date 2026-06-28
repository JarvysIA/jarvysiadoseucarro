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

function buildSystemPrompt(): string {
  return [
    "Você é um especialista técnico em manutenção automotiva do Jarvys.",
    "Gere SOMENTE JSON puro válido contra o schema maintenance_plan_json do Jarvys.",
    "Nunca inclua texto, comentários ou markdown antes ou depois do JSON.",
    "Use o technical_context fornecido como fonte principal e respeite os dados do veículo.",
    "Se houver incerteza, prefira recomendações conservadoras.",
    "Nunca invente dado específico não suportado pelo contexto.",
    "Para câmbio automático ou CVT, NUNCA recomende troca parcial do óleo do câmbio: recomende troca completa com máquina especializada, fluido correto e filtro quando elegível.",
    "Em alta quilometragem ou histórico desconhecido, oriente diagnóstico prévio antes de troca completa.",
    "Evite flush químico/agressivo.",
    "Considere uso severo quando informado.",
    "Saída obrigatoriamente em um único objeto JSON.",
  ].join("\n");
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
    usage?: unknown;
  };
  try {
    json = (await resp.json()) as typeof json;
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
  plan: JsonValue | null;
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

    const systemPrompt = buildSystemPrompt();
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
        ai: { provider: AI_PROVIDER, model: AI_MODEL, usage: ai.usage as JsonValue },
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
        ai: { provider: AI_PROVIDER, model: AI_MODEL, usage: ai.usage as JsonValue },
        technical_context_debug: buildDebug(ctx),
        raw_preview: preview,
      };
    }

    return {
      valid: true,
      plan: validation.data as unknown as JsonValue,
      errors: [],
      warnings: baseWarnings,
      ai: { provider: AI_PROVIDER, model: AI_MODEL, usage: ai.usage as JsonValue },
      technical_context_debug: buildDebug(ctx),
      raw_preview: preview,
    };
  });
