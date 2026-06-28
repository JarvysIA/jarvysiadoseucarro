import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─────────────────────────────────────────────────────────────
// Build 6.22 — Seleção determinística de corpus por veículo
// Read-only. Sem IA, sem service_role, sem extracted_text,
// sem storage_path/file_name/signed URL/notes.
// Respeita RLS via context.supabase (apenas published+reviewed).
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

const SATURATED_KEYWORDS_IGNORED = [
  "cvt",
  "automatizado",
  "cambio_automatico",
  "correia_dentada",
  "uso_severo",
  "alta_quilometragem",
] as const;

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
  })
  .strict();

export type SelectMaintenanceCorpusForVehicleInput = z.input<
  typeof inputSchema
>;

function assertNoForbiddenKeys(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const keys = Object.keys(raw as Record<string, unknown>).map((k) =>
    k.toLowerCase(),
  );
  const bad = keys.filter((k) => FORBIDDEN_KEYS.includes(k));
  if (bad.length > 0) {
    throw new Error(`Campos não permitidos no payload: ${bad.join(", ")}.`);
  }
}

type CorpusRow = {
  id: string;
  slug: string;
  title: string;
  brand: string;
  model_group: string;
  generation_range: string | null;
  year_start: number | null;
  year_end: number | null;
  mechanical_families_json: unknown;
  coverage_json: unknown;
  summary_json: unknown;
  quality_score: number | null;
  reviewed_by_admin: boolean | null;
  published: boolean | null;
  version: string | null;
};

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
  row: CorpusRow,
  input: ParsedInput,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // brand
  if (row.brand && row.brand === input.brand) {
    score += 50;
    reasons.push("brand_exata");
  }

  const corpusModelGroup = row.model_group
    ? normalizeText(row.model_group)
    : "";

  // model_group exato
  if (
    input.model_group &&
    corpusModelGroup &&
    corpusModelGroup === input.model_group
  ) {
    score += 40;
    reasons.push("model_group_exato");
  }

  // modelo_fipe contém model_group do corpus ou vice-versa
  if (
    input.modelo_fipe &&
    corpusModelGroup &&
    bidirectionalContains(input.modelo_fipe, corpusModelGroup)
  ) {
    score += 25;
    reasons.push("modelo_fipe_match_model_group");
  }

  // versao contém model_group ou vice-versa
  if (
    input.versao &&
    corpusModelGroup &&
    bidirectionalContains(input.versao, corpusModelGroup)
  ) {
    score += 15;
    reasons.push("versao_match_model_group");
  }

  // ano
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

  // coverage_json (defensivo, string-based)
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
    if (input.sistema_distribuicao && input.sistema_distribuicao !== "desconhecido") {
      if (cov.includes(input.sistema_distribuicao)) {
        score += 10;
        reasons.push("coverage_sistema_distribuicao");
      }
    }
  }

  // detected_keywords (bônus fraco, apenas sinais variáveis)
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
  // Saturadas explicitamente ignoradas (não somam): cvt, automatizado,
  // cambio_automatico, correia_dentada, uso_severo, alta_quilometragem.
  void SATURATED_KEYWORDS_IGNORED;

  return { score, reasons };
}

export const selectMaintenanceCorpusForVehicleFn = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    assertNoForbiddenKeys(input);
    return inputSchema.parse(input);
  })
  .handler(async ({ context, data }) => {
    const input = data;
    const limit = input.limit ?? 5;

    const { data: rows, error } = await context.supabase
      .from("jarvys_maintenance_corpus")
      .select(
        "id, slug, title, brand, model_group, generation_range, year_start, year_end, mechanical_families_json, coverage_json, summary_json, quality_score, reviewed_by_admin, published, version",
      )
      .eq("brand", input.brand);

    if (error) {
      throw new Error("Falha ao consultar corpus.");
    }

    const candidates = (rows ?? []) as CorpusRow[];

    const scored = candidates.map((row) => {
      const { score, reasons } = scoreRow(row, input);
      return {
        id: row.id,
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
      };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.quality_score !== a.quality_score)
        return b.quality_score - a.quality_score;
      if (Number(b.reviewed_by_admin) !== Number(a.reviewed_by_admin)) {
        return Number(b.reviewed_by_admin) - Number(a.reviewed_by_admin);
      }
      return a.title.localeCompare(b.title);
    });

    const matches = scored.slice(0, limit);

    // normalizedInput montado APENAS a partir do input parseado (sem PII).
    const normalizedInput = {
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
      limit,
    };

    return {
      matches,
      debug: {
        normalizedInput,
        totalCandidates: candidates.length,
        returned: matches.length,
      },
    };
  });
