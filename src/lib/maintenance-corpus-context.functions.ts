import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─────────────────────────────────────────────────────────────
// Build 6.26 — Preparação de contexto técnico do corpus
// Admin/debug. Read-only. Sem IA, sem maintenance_plan_json,
// sem signed URL, sem storage_path/file_name/notes,
// sem extracted_text completo.
// Reutiliza a lógica de scoring do Build 6.22/6.23 (cópia mínima).
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
    .refine((v) => v == null || v > 0, "cilindradas deve ser positivo"),
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
    limit: z.number().int().min(1).max(5).optional(),
    maxCharsPerDocument: z.number().int().min(1000).max(6000).optional(),
  })
  .strict();

export type BuildMaintenanceCorpusContextAdminInput = z.input<
  typeof inputSchema
>;

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

type ParsedInput = z.output<typeof inputSchema>;

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
        input.ano_modelo < ys
          ? ys - input.ano_modelo
          : input.ano_modelo - ye;
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
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
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

export const buildMaintenanceCorpusContextAdminFn = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    assertNoForbiddenKeysDeep(input);
    return inputSchema.parse(input);
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const input = data;
    const limit = input.limit ?? 3;
    const maxCharsPerDocument = input.maxCharsPerDocument ?? 3000;

    // 1ª passada — candidatos por brand, sem extracted_text/storage_path/file_name/notes.
    const { data: rows, error } = await supabaseAdmin
      .from("jarvys_maintenance_corpus")
      .select(
        "id, slug, title, brand, model_group, generation_range, year_start, year_end, mechanical_families_json, coverage_json, summary_json, quality_score, reviewed_by_admin, published, version",
      )
      .eq("brand", input.brand);

    if (error) {
      throw new Error("Falha ao consultar corpus.");
    }

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
      if (detailError) {
        throw new Error("Falha ao carregar documentos selecionados.");
      }
      withText = (detailRows ?? []) as CorpusRowWithText[];
    }

    const textById = new Map<string, string | null>(
      withText.map((r) => [r.id, r.extracted_text ?? null]),
    );

    const documents = top.map(({ row, score, reasons }) => {
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
        quality_score: row.quality_score ?? 0,
        reviewed_by_admin: row.reviewed_by_admin ?? false,
        published: row.published ?? false,
        version: row.version ?? "",
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
    if (documents.some((d) => d.reviewed_by_admin === false)) {
      warnings.push("corpus_em_curadoria");
    }
    if (documents.some((d) => d.published === false)) {
      warnings.push("corpus_nao_publicado");
    }
    if (documents.some((d) => d.text_excerpt_char_count < 500)) {
      warnings.push("texto_curto_no_contexto");
    }

    const vehicle_input = {
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
    };

    return {
      technical_context: {
        schema_version: "1.0.0" as const,
        generated_by: "corpus_context_admin" as const,
        vehicle_input,
        selection: {
          totalCandidates: candidates.length,
          returned: documents.length,
          limit,
          maxCharsPerDocument,
        },
        documents,
        warnings,
      },
      debug: {
        mode: "admin" as const,
        totalCandidates: candidates.length,
        returned: documents.length,
      },
    };
  });
