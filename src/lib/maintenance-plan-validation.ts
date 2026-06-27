/**
 * maintenance-plan-validation.ts
 *
 * Validação Zod isolada do contrato `MaintenancePlanJson` definido em
 * `./maintenance-plan-schema` (Build 5.1).
 *
 * Este arquivo é puro: apenas schemas Zod, helpers de parse e tipos inferidos.
 * Sem Supabase, sem React, sem I/O, sem chamadas de rede.
 *
 * IMPORTANTE:
 * - Os enums abaixo espelham EXATAMENTE os unions do Build 5.1. Qualquer
 *   alteração de valor deve ser feita primeiro em `maintenance-plan-schema.ts`
 *   e bumpar `MAINTENANCE_PLAN_SCHEMA_VERSION`.
 * - Este build NÃO integra ao `upsertMaintenanceProfileFn`. Essa integração
 *   ficou para o Build 5.4.
 */

import { z } from "zod";
import {
  MAINTENANCE_PLAN_SCHEMA_VERSION,
  type MaintenancePlanJson,
} from "./maintenance-plan-schema";

// ---------------------------------------------------------------------------
// Enums (espelham Build 5.1 — não inventar/remover valores)
// ---------------------------------------------------------------------------

export const timingSystemSchema = z.enum([
  "correia_dentada",
  "corrente",
  "correia_banhada",
  "desconhecido",
]);

export const transmissionTypeSchema = z.enum([
  "manual",
  "automatico",
  "cvt",
  "automatizado",
  "dupla_embreagem",
  "desconhecido",
]);

export const transmissionServicePolicySchema = z.enum([
  "troca_programada",
  "preventiva_recomendada",
  "sem_troca_programada",
  "verificar_manual",
  "desconhecido",
]);

export const transmissionFluidServiceTypeSchema = z.enum([
  "somente_fluido",
  "fluido_e_um_filtro",
  "fluido_e_dois_filtros",
  "fluido_filtro_junta",
  "filtro_interno_nao_servicavel",
  "sem_troca_programada",
  "desconhecido",
]);

export const maintenanceCategorySchema = z.enum([
  "motor",
  "filtros",
  "ignicao",
  "arrefecimento",
  "freios",
  "suspensao",
  "direcao",
  "pneus",
  "transmissao",
  "eletrica",
  "carroceria",
  "diagnostico",
  "conforto",
  "outros",
]);

export const maintenanceActionSchema = z.enum([
  "trocar",
  "verificar",
  "inspecionar",
  "limpar",
  "regular",
  "completar",
  "diagnosticar",
  "resetar_aviso",
  "troca_preventiva_recomendada",
  "nao_aplicavel",
]);

export const maintenanceRecommendationTypeSchema = z.enum([
  "required",
  "recommended",
  "preventive_recommended",
  "inspect_only",
  "condition_based",
  "not_applicable",
  "unknown",
]);

export const shoppingClassificationSchema = z.enum([
  "safe_to_buy",
  "service_only",
  "inspect_before_buy",
  "bundle_preferred",
  "do_not_link",
  "not_applicable",
  "unknown",
]);

export const maintenanceBundleTypeSchema = z.enum([
  "kit_troca_oleo_motor",
  "kit_filtros",
  "kit_revisao_completa",
  "kit_correia_dentada",
  "kit_correia_acessorios",
  "kit_cambio_manual",
  "kit_cambio_automatico",
  "kit_freio",
  "kit_arrefecimento",
  "kit_ignicao",
  "outro",
]);

export const maintenanceSourceTypeSchema = z.enum([
  "manual",
  "ia",
  "curadoria",
  "catalogo",
  "fornecedor",
  "experiencia_preventiva",
  "sistema",
]);

export const maintenancePlanGeneratedBySchema = z.enum([
  "ia",
  "manual",
  "curadoria",
  "sistema",
]);

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

const nonEmptyString = z.string().trim().min(1);

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const optionalNullableString = z.preprocess(
  emptyToNull,
  z.string().trim().min(1).nullable().optional(),
);

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const confidenceSchema = z.number().int().min(0).max(100);
const itemKeySchema = nonEmptyString;
const notesSchema = z.array(z.string()).optional();

// ---------------------------------------------------------------------------
// Estruturas
// ---------------------------------------------------------------------------

export const maintenanceVehicleSummarySchema = z
  .object({
    display_name: nonEmptyString,
    marca: optionalNullableString,
    modelo_fipe: optionalNullableString,
    ano_modelo: z.number().int().nullable().optional(),
    combustivel: optionalNullableString,
    cilindradas: z.number().int().positive().nullable().optional(),
    motor_textual: optionalNullableString,
    valvulas: z.number().int().positive().nullable().optional(),
    transmissao: transmissionTypeSchema.nullable().optional(),
  })
  .strict();

export const maintenanceBaseRulesSchema = z
  .object({
    revision_interval_km: positiveInt,
    revision_interval_months: positiveInt,
    max_planned_km: positiveInt.optional(),
    severe_use_oil_interval_km: positiveInt.optional(),
    severe_use_oil_interval_months: positiveInt.optional(),
  })
  .strict();

export const maintenanceSystemProfileSchema = z
  .object({
    timing_system: timingSystemSchema,
    transmission_type: transmissionTypeSchema,
    transmission_service_policy: transmissionServicePolicySchema,
    transmission_fluid_service_type: transmissionFluidServiceTypeSchema,
    cooling_system_policy: z.string().trim().min(1).optional(),
  })
  .strict();

export const maintenancePlanItemSchema = z
  .object({
    item_key: itemKeySchema,
    label: nonEmptyString,
    category: maintenanceCategorySchema,
    action: maintenanceActionSchema,
    recommendation_type: maintenanceRecommendationTypeSchema,
    shopping_classification: shoppingClassificationSchema,
    applies: z.boolean().default(true),
    interval_km: positiveInt.optional(),
    interval_months: positiveInt.optional(),
    confidence: confidenceSchema.optional(),
    source_type: maintenanceSourceTypeSchema.optional(),
    reason: z.string().trim().min(1).optional(),
    notes: notesSchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    // Regra rígida: "not_applicable" exige applies=false e
    // shopping_classification="not_applicable".
    if (item.recommendation_type === "not_applicable") {
      if (item.applies !== false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["applies"],
          message:
            'Quando recommendation_type === "not_applicable", applies deve ser false.',
        });
      }
      if (item.shopping_classification !== "not_applicable") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["shopping_classification"],
          message:
            'Quando recommendation_type === "not_applicable", shopping_classification deve ser "not_applicable".',
        });
      }
    }
  });

export const maintenanceFixedIntervalItemSchema = z
  .object({
    item_key: itemKeySchema,
    label: nonEmptyString,
    category: maintenanceCategorySchema,
    action: maintenanceActionSchema,
    interval_km: positiveInt.optional(),
    interval_months: positiveInt.optional(),
    shopping_classification: shoppingClassificationSchema,
    recommendation_type: maintenanceRecommendationTypeSchema,
    applies: z.boolean().default(true),
    confidence: confidenceSchema.optional(),
    source_type: maintenanceSourceTypeSchema.optional(),
    notes: notesSchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    if (
      item.interval_km === undefined &&
      item.interval_months === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interval_km"],
        message:
          "Pelo menos um de interval_km ou interval_months deve ser informado.",
      });
    }
  });

export const maintenanceMilestoneSchema = z
  .object({
    km: positiveInt,
    label: nonEmptyString,
    revision_number: positiveInt.optional(),
    projected: z.boolean().optional(),
    items: z.array(maintenancePlanItemSchema).min(1),
    purchase_bundle_keys: z.array(nonEmptyString).optional(),
    notes: notesSchema,
  })
  .strict();

export const maintenanceSevereUseRuleSchema = z
  .object({
    item_key: itemKeySchema,
    label: nonEmptyString,
    description: z.string().trim().min(1).optional(),
    interval_km: positiveInt.optional(),
    interval_months: positiveInt.optional(),
    recommendation_type: maintenanceRecommendationTypeSchema,
    source_type: maintenanceSourceTypeSchema.optional(),
    confidence: confidenceSchema.optional(),
  })
  .strict();

export const maintenanceAgeBasedAlertSchema = z
  .object({
    item_key: itemKeySchema,
    label: nonEmptyString,
    trigger_age_years: nonNegativeInt,
    recommendation_type: maintenanceRecommendationTypeSchema,
    shopping_classification: shoppingClassificationSchema,
    reason: z.string().trim().min(1).optional(),
    source_type: maintenanceSourceTypeSchema.optional(),
    confidence: confidenceSchema.optional(),
  })
  .strict();

export const maintenanceNotApplicableItemSchema = z
  .object({
    item_key: itemKeySchema,
    label: nonEmptyString,
    reason: nonEmptyString,
    source_type: maintenanceSourceTypeSchema.optional(),
    confidence: confidenceSchema.optional(),
  })
  .strict();

export const maintenancePurchaseBundleSchema = z
  .object({
    bundle_key: nonEmptyString,
    label: nonEmptyString,
    description: z.string().trim().min(1).optional(),
    bundle_type: maintenanceBundleTypeSchema,
    item_keys: z.array(itemKeySchema).min(1),
    category: maintenanceCategorySchema,
    shopping_classification: shoppingClassificationSchema,
    preferred_search_query_template: z.string().trim().min(1).optional(),
    required_item_keys: z.array(itemKeySchema).optional(),
    optional_item_keys: z.array(itemKeySchema).optional(),
    excluded_item_keys: z.array(itemKeySchema).optional(),
    requires_compatibility_confirmation: z.boolean().optional(),
    confidence: confidenceSchema.optional(),
    source_type: maintenanceSourceTypeSchema.optional(),
    notes: notesSchema,
  })
  .strict();

export const maintenancePlanMetadataSchema = z
  .object({
    generated_at: nonEmptyString,
    generated_by: maintenancePlanGeneratedBySchema,
    source: maintenanceSourceTypeSchema,
    overall_confidence: confidenceSchema.optional(),
    reviewed_by_admin: z.boolean().optional(),
    schema_notes: z.array(z.string()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Raiz
// ---------------------------------------------------------------------------

export const maintenancePlanJsonSchema = z
  .object({
    schema_version: z.literal(MAINTENANCE_PLAN_SCHEMA_VERSION),
    vehicle_summary: maintenanceVehicleSummarySchema,
    base_rules: maintenanceBaseRulesSchema,
    system_profile: maintenanceSystemProfileSchema,
    milestones: z.array(maintenanceMilestoneSchema).min(1),
    fixed_intervals: z.array(maintenanceFixedIntervalItemSchema).optional(),
    severe_use_rules: z.array(maintenanceSevereUseRuleSchema).optional(),
    age_based_alerts: z.array(maintenanceAgeBasedAlertSchema).optional(),
    not_applicable_items: z
      .array(maintenanceNotApplicableItemSchema)
      .optional(),
    purchase_bundles: z.array(maintenancePurchaseBundleSchema).optional(),
    general_notes: z.array(z.string()).optional(),
    safety_disclaimer: z.string().trim().min(1).optional(),
    metadata: maintenancePlanMetadataSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Tipos inferidos
// ---------------------------------------------------------------------------

/**
 * Tipo inferido diretamente do schema Zod. Útil para testes internos.
 * O tipo público canônico continua sendo `MaintenancePlanJson` do Build 5.1.
 */
export type ParsedMaintenancePlanJson = z.infer<
  typeof maintenancePlanJsonSchema
>;

// ---------------------------------------------------------------------------
// Helpers de parse
// ---------------------------------------------------------------------------

/**
 * Valida e retorna o plano tipado conforme o contrato canônico do Build 5.1.
 * Lança `z.ZodError` se inválido.
 */
export function parseMaintenancePlanJson(
  input: unknown,
): MaintenancePlanJson {
  return maintenancePlanJsonSchema.parse(input) as MaintenancePlanJson;
}

/**
 * Variante segura: não lança, retorna union discriminada.
 */
export function safeParseMaintenancePlanJson(
  input: unknown,
):
  | { success: true; data: MaintenancePlanJson }
  | { success: false; error: z.ZodError } {
  const result = maintenancePlanJsonSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data as MaintenancePlanJson };
  }
  return { success: false, error: result.error };
}
