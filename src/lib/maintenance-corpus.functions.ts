import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";

const FORBIDDEN_KEYS = [
  "user_id",
  "vehicle_id",
  "placa",
  "chassi",
  "numero_motor",
  "cpf",
  "documento",
  "email",
  "whatsapp",
  "telefone",
  "nome",
];

const SOURCE_TYPES = [
  "jarvys_pdf_v1",
  "manual_oficial",
  "curadoria",
  "terceiros",
] as const;

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const optionalNullableString = z.preprocess(
  emptyToNull,
  z.string().trim().nullable().optional(),
);

const optionalNullableInt = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  z.number().int().nullable().optional(),
);

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const slugRegex = /^[a-z0-9][a-z0-9_-]*$/;

const payloadSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1, "slug obrigatório")
      .transform((s) => s.toLowerCase())
      .refine((s) => slugRegex.test(s), "slug inválido"),
    title: z.string().trim().min(1, "title obrigatório"),
    brand: z
      .string()
      .trim()
      .min(1, "brand obrigatória")
      .transform((s) => s.toLowerCase()),
    model_group: z
      .string()
      .trim()
      .min(1, "model_group obrigatório")
      .transform((s) => s.toLowerCase()),
    generation_range: optionalNullableString,
    year_start: optionalNullableInt.refine(
      (v) => v == null || (v >= 1980 && v <= 2100),
      "year_start fora do intervalo 1980..2100",
    ),
    year_end: optionalNullableInt.refine(
      (v) => v == null || (v >= 1980 && v <= 2100),
      "year_end fora do intervalo 1980..2100",
    ),
    mechanical_families_json: z.array(jsonValueSchema).optional(),
    coverage_json: z.record(z.string(), jsonValueSchema).optional(),
    source_type: z.enum(SOURCE_TYPES).optional(),
    version: z.string().trim().min(1).optional(),
    file_name: optionalNullableString,
    storage_path: optionalNullableString,
    extracted_text: z.preprocess(
      (v) => (v === "" ? null : v),
      z.string().nullable().optional(),
    ),
    summary_json: z.record(z.string(), jsonValueSchema).optional(),
    quality_score: z.number().int().min(0).max(100).optional(),
    reviewed_by_admin: z.boolean().optional(),
    published: z.boolean().optional(),
    notes: optionalNullableString,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      val.year_start != null &&
      val.year_end != null &&
      val.year_start > val.year_end
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "year_start deve ser <= year_end",
        path: ["year_start"],
      });
    }
  });

export type UpsertMaintenanceCorpusInput = z.input<typeof payloadSchema>;

const PRESENCE_KEYS = [
  "slug",
  "title",
  "brand",
  "model_group",
  "generation_range",
  "year_start",
  "year_end",
  "mechanical_families_json",
  "coverage_json",
  "source_type",
  "version",
  "file_name",
  "storage_path",
  "extracted_text",
  "summary_json",
  "quality_score",
  "reviewed_by_admin",
  "published",
  "notes",
] as const;

type PresenceKey = (typeof PRESENCE_KEYS)[number];
type PresenceMap = Partial<Record<PresenceKey, true>>;

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

export const upsertMaintenanceCorpusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    assertNoForbiddenKeys(input);
    const parsed = payloadSchema.parse(input);
    const presentKeys: PresenceMap = {};
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const raw = input as Record<string, unknown>;
      for (const k of PRESENCE_KEYS) {
        if (k in raw) presentKeys[k] = true;
      }
    }
    return { parsed, presentKeys };
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { parsed, presentKeys } = data;

    type CorpusInsert =
      Database["public"]["Tables"]["jarvys_maintenance_corpus"]["Insert"];

    // Obrigatórios sempre presentes.
    const payload: CorpusInsert = {
      slug: parsed.slug,
      title: parsed.title,
      brand: parsed.brand,
      model_group: parsed.model_group,
    };

    // Nullable: incluir apenas se a chave estiver presente no input
    // (null explícito limpa; ausência preserva).
    if (presentKeys.generation_range)
      payload.generation_range = parsed.generation_range ?? null;
    if (presentKeys.year_start) payload.year_start = parsed.year_start ?? null;
    if (presentKeys.year_end) payload.year_end = parsed.year_end ?? null;
    if (presentKeys.file_name) payload.file_name = parsed.file_name ?? null;
    if (presentKeys.storage_path)
      payload.storage_path = parsed.storage_path ?? null;
    if (presentKeys.extracted_text)
      payload.extracted_text = parsed.extracted_text ?? null;
    if (presentKeys.notes) payload.notes = parsed.notes ?? null;

    // NOT NULL com default: só incluir quando enviados.
    if (presentKeys.mechanical_families_json && parsed.mechanical_families_json)
      payload.mechanical_families_json =
        parsed.mechanical_families_json as unknown as Json;
    if (presentKeys.coverage_json && parsed.coverage_json)
      payload.coverage_json = parsed.coverage_json as Json;
    if (presentKeys.summary_json && parsed.summary_json)
      payload.summary_json = parsed.summary_json as Json;
    if (presentKeys.source_type && parsed.source_type)
      payload.source_type = parsed.source_type;
    if (presentKeys.version && parsed.version) payload.version = parsed.version;
    if (presentKeys.quality_score && parsed.quality_score !== undefined)
      payload.quality_score = parsed.quality_score;
    if (presentKeys.reviewed_by_admin && parsed.reviewed_by_admin !== undefined)
      payload.reviewed_by_admin = parsed.reviewed_by_admin;
    if (presentKeys.published && parsed.published !== undefined)
      payload.published = parsed.published;

    const { data: corpus, error } = await supabaseAdmin
      .from("jarvys_maintenance_corpus")
      .upsert(payload, { onConflict: "slug" })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return { corpus };
  });

// ---------------------------------------------------------------------------
// uploadMaintenanceCorpusPdfFn
// ---------------------------------------------------------------------------

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const BASE64_REGEX = /^[A-Za-z0-9+/=\r\n\s]+$/;

const uploadPayloadSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1, "slug obrigatório")
      .transform((s) => s.toLowerCase())
      .refine((s) => slugRegex.test(s), "slug inválido"),
    fileName: z
      .string()
      .trim()
      .min(1, "fileName obrigatório")
      .refine((n) => !n.includes("/") && !n.includes("\\") && !n.includes(".."),
        "fileName inválido")
      .refine((n) => n.toLowerCase().endsWith(".pdf"), "fileName deve terminar em .pdf"),
    contentType: z
      .string()
      .refine((c) => c === "application/pdf", "contentType deve ser application/pdf"),
    fileBase64: z
      .string()
      .min(1, "fileBase64 obrigatório")
      .refine((b) => BASE64_REGEX.test(b), "fileBase64 inválido"),
    sizeBytes: z
      .number()
      .int()
      .positive("sizeBytes deve ser positivo")
      .max(MAX_PDF_BYTES, `Tamanho máximo: ${MAX_PDF_BYTES} bytes`),
  })
  .strict();

export type UploadMaintenanceCorpusPdfInput = z.input<typeof uploadPayloadSchema>;

export const uploadMaintenanceCorpusPdfFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    assertNoForbiddenKeys(input);
    return uploadPayloadSchema.parse(input);
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // 1. Exigir que o registro do corpus já exista.
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("jarvys_maintenance_corpus")
      .select("id")
      .eq("slug", data.slug)
      .maybeSingle();
    if (lookupError) throw new Error("Falha ao localizar corpus.");
    if (!existing) throw new Error("Corpus não encontrado para este slug.");

    // 2. Decodificar base64 server-side, conferir tamanho.
    const cleanedBase64 = data.fileBase64.replace(/\s+/g, "");
    let buffer: Buffer;
    try {
      buffer = Buffer.from(cleanedBase64, "base64");
    } catch {
      throw new Error("fileBase64 inválido.");
    }
    if (buffer.byteLength === 0) {
      throw new Error("Arquivo vazio.");
    }
    if (buffer.byteLength > MAX_PDF_BYTES) {
      throw new Error("Arquivo excede o tamanho máximo.");
    }
    if (buffer.byteLength !== data.sizeBytes) {
      throw new Error("sizeBytes não corresponde ao conteúdo enviado.");
    }

    // 3. Sanitizar fileName (apenas para coluna; storagePath é fixo).
    const sanitizedFileName = data.fileName
      .split(/[\\/]/)
      .pop()!
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 200);

    // 4. Caminho fixo determinístico no bucket privado.
    const storagePath = `corpus/${data.slug}/source.pdf`;

    // 5. Upload server-side via service_role (bucket privado, upsert).
    const { error: uploadError } = await supabaseAdmin.storage
      .from("jarvys-corpus")
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: true,
        cacheControl: "3600",
      });
    if (uploadError) throw new Error("Falha no upload do PDF.");

    // 6. Atualizar registro do corpus; tratar erro de update.
    const { error: updateError } = await supabaseAdmin
      .from("jarvys_maintenance_corpus")
      .update({ storage_path: storagePath, file_name: sanitizedFileName })
      .eq("slug", data.slug);
    if (updateError) {
      throw new Error(
        "Upload concluído, mas falhou ao atualizar o registro do corpus.",
      );
    }

    return {
      storagePath,
      fileName: sanitizedFileName,
      sizeBytes: buffer.byteLength,
    };
  });

// ---------------------------------------------------------------------------
// getMaintenanceCorpusSignedDownloadFn
// ---------------------------------------------------------------------------

const signedDownloadPayloadSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1, "slug obrigatório")
      .transform((s) => s.toLowerCase())
      .refine((s) => slugRegex.test(s), "slug inválido"),
    expiresIn: z
      .number()
      .int("expiresIn deve ser inteiro")
      .min(60, "expiresIn mínimo: 60s")
      .max(900, "expiresIn máximo: 900s")
      .optional(),
  })
  .strict();

export type GetMaintenanceCorpusSignedDownloadInput = z.input<
  typeof signedDownloadPayloadSchema
>;

export const getMaintenanceCorpusSignedDownloadFn = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    assertNoForbiddenKeys(input);
    return signedDownloadPayloadSchema.parse(input);
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: row, error: lookupError } = await supabaseAdmin
      .from("jarvys_maintenance_corpus")
      .select("storage_path, file_name")
      .eq("slug", data.slug)
      .maybeSingle();
    if (lookupError) throw new Error("Falha ao localizar corpus.");
    if (!row) throw new Error("Corpus não encontrado para este slug.");
    if (!row.storage_path) throw new Error("Corpus não possui PDF enviado.");

    const expiresIn = data.expiresIn ?? 300;

    const { data: signed, error: signedError } = await supabaseAdmin.storage
      .from("jarvys-corpus")
      .createSignedUrl(row.storage_path, expiresIn);
    if (signedError || !signed?.signedUrl) {
      throw new Error("Falha ao gerar URL assinada do PDF.");
    }

    return {
      signedUrl: signed.signedUrl,
      storagePath: row.storage_path,
      fileName: row.file_name ?? null,
      expiresIn,
    };
  });

// ---------------------------------------------------------------------------
// extractMaintenanceCorpusPdfTextFn
// ---------------------------------------------------------------------------

const MIN_EXTRACTED_TEXT_CHARS = 200;

const extractPayloadSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1, "slug obrigatório")
      .transform((s) => s.toLowerCase())
      .refine((s) => slugRegex.test(s), "slug inválido"),
  })
  .strict();

export type ExtractMaintenanceCorpusPdfTextInput = z.input<
  typeof extractPayloadSchema
>;

export const extractMaintenanceCorpusPdfTextFn = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    assertNoForbiddenKeys(input);
    return extractPayloadSchema.parse(input);
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { extractPdfText } = await import(
      "@/lib/maintenance-corpus-pdf.server"
    );

    const { data: row, error: lookupError } = await supabaseAdmin
      .from("jarvys_maintenance_corpus")
      .select("slug, storage_path, file_name")
      .eq("slug", data.slug)
      .maybeSingle();
    if (lookupError) throw new Error("Falha ao localizar corpus.");
    if (!row) throw new Error("Corpus não encontrado para este slug.");
    if (!row.storage_path) throw new Error("Corpus não possui PDF enviado.");

    const { data: blob, error: downloadError } = await supabaseAdmin.storage
      .from("jarvys-corpus")
      .download(row.storage_path);
    if (downloadError || !blob) {
      throw new Error("Falha ao baixar PDF do corpus.");
    }

    const arrayBuffer = await blob.arrayBuffer();
    const result = await extractPdfText(arrayBuffer);

    if (result.charCount < MIN_EXTRACTED_TEXT_CHARS) {
      throw new Error(
        "Texto extraído insuficiente. O PDF pode estar vazio, escaneado ou sem camada de texto.",
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("jarvys_maintenance_corpus")
      .update({ extracted_text: result.text })
      .eq("slug", row.slug);
    if (updateError) {
      throw new Error("Falha ao salvar texto extraído do corpus.");
    }

    return {
      slug: row.slug,
      charCount: result.charCount,
      pageCount: result.pageCount,
      fileName: row.file_name ?? null,
    };
  });

// ─────────────────────────────────────────────────────────────
// Build 6.9 — buildMaintenanceCorpusSummaryFn
// Gera summary_json básico por regex/heurísticas sobre extracted_text.
// Não chama IA, não acessa storage, não altera extracted_text.
// ─────────────────────────────────────────────────────────────

const MIN_SUMMARY_TEXT_CHARS = 200;

function normalizeTextForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const SECTION_PATTERNS: Record<string, RegExp> = {
  resumo_executivo: /resumo executivo/,
  regras_fixas: /regras fixas|padrao jarvys/,
  motorizacoes_pontos_criticos:
    /motorizacoes( e pontos criticos)?|pontos criticos/,
  cronograma_km:
    /cronograma por (quilometragem|km)|10\.?000 a 100\.?000|110\.?000 a 200\.?000/,
  intervalos_fixos: /itens por intervalo fixo|intervalo fixo/,
  alertas_especificos: /alertas especificos/,
  checklist_usado_sem_historico:
    /checklist inicial para carro usado sem historico|carro usado sem historico|sem historico/,
  fontes_base_tecnica: /fontes e base tecnica|base tecnica|(^|\n)\s*fontes\b/,
};

const KEYWORD_PATTERNS: Record<string, RegExp> = {
  uso_severo:
    /uso severo|condicoes severas|\bapp\b|\btaxi\b|\bfrota\b|\bcarga\b/,
  correia_dentada: /correia dentada/,
  corrente_comando: /corrente de comando/,
  correia_banhada: /correia banhada/,
  cambio_automatico: /cambio automatico|\batf\b/,
  cvt: /\bcvt\b/,
  automatizado: /dualogic|i-?motion|automatizado/,
  diesel: /\bdiesel\b/,
  hibrido: /hibrido/,
  eletrico: /eletrico/,
  alta_quilometragem:
    /alta quilometragem|200\.?000 km|300\.?000 km|500\.?000 km/,
};

const summaryPayloadSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .transform((s) => s.toLowerCase())
      .pipe(
        z
          .string()
          .min(1)
          .max(120)
          .refine((s) => slugRegex.test(s), "slug inválido"),
      ),
  })
  .strict();

export const buildMaintenanceCorpusSummaryFn = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    assertNoForbiddenKeys(input);
    return summaryPayloadSchema.parse(input);
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: row, error: lookupError } = await supabaseAdmin
      .from("jarvys_maintenance_corpus")
      .select("slug, extracted_text")
      .eq("slug", data.slug)
      .maybeSingle();
    if (lookupError) throw new Error("Falha ao localizar corpus.");
    if (!row) throw new Error("Corpus não encontrado para este slug.");

    const extractedText = (row.extracted_text ?? "").toString();
    if (!extractedText.trim()) {
      throw new Error("Corpus não possui texto extraído.");
    }

    const trimmed = extractedText.trim();
    if (trimmed.length < MIN_SUMMARY_TEXT_CHARS) {
      throw new Error("Texto extraído insuficiente para gerar resumo.");
    }

    const normalized = normalizeTextForSearch(extractedText);

    const sectionsDetected: Record<string, boolean> = {};
    for (const [key, rx] of Object.entries(SECTION_PATTERNS)) {
      sectionsDetected[key] = rx.test(normalized);
    }

    const detectedKeywords: Record<string, boolean> = {};
    for (const [key, rx] of Object.entries(KEYWORD_PATTERNS)) {
      detectedKeywords[key] = rx.test(normalized);
    }

    const charCount = trimmed.length;
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

    const summaryJson: Json = {
      schema_version: "1.0.0",
      generated_by: "regex",
      sections_detected: sectionsDetected,
      detected_keywords: detectedKeywords,
      text_stats: {
        char_count: charCount,
        word_count: wordCount,
      },
    };

    const updatePayload: Database["public"]["Tables"]["jarvys_maintenance_corpus"]["Update"] =
      { summary_json: summaryJson };

    const { error: updateError } = await supabaseAdmin
      .from("jarvys_maintenance_corpus")
      .update(updatePayload)
      .eq("slug", row.slug);
    if (updateError) {
      throw new Error("Falha ao salvar resumo do corpus.");
    }

    return {
      slug: row.slug,
      charCount,
      wordCount,
      sectionsDetected,
      detectedKeywords,
    };
  });
