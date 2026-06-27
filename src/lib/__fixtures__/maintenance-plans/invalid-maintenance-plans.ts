/**
 * Fixtures inválidas intencionais para o smoke test do schema
 * `maintenance_plan_json`. Cada export deve ser rejeitado por
 * `safeParseMaintenancePlanJson`.
 *
 * Tipadas como `unknown` porque o objetivo é exercitar o Zod em runtime, não
 * o TypeScript em compile time.
 */

import { MAINTENANCE_PLAN_SCHEMA_VERSION } from "../../maintenance-plan-schema";

const baseVehicleSummary = {
  display_name: "Fixture inválida",
};

const baseRules = {
  revision_interval_km: 10000,
  revision_interval_months: 12,
};

const baseSystemProfile = {
  timing_system: "corrente",
  transmission_type: "manual",
  transmission_service_policy: "troca_programada",
  transmission_fluid_service_type: "somente_fluido",
};

const baseMetadata = {
  generated_at: "2026-06-27T00:00:00.000Z",
  generated_by: "sistema",
  source: "sistema",
};

const validItem = {
  item_key: "oleo_motor",
  label: "Óleo do motor",
  category: "motor",
  action: "trocar",
  recommendation_type: "required",
  shopping_classification: "bundle_preferred",
  applies: true,
};

const baseMilestone = {
  km: 10000,
  label: "1ª revisão",
  items: [validItem],
};

/** Versão de schema incompatível. */
export const invalidSchemaVersionPlan: unknown = {
  schema_version: "0.9.0",
  vehicle_summary: baseVehicleSummary,
  base_rules: baseRules,
  system_profile: baseSystemProfile,
  milestones: [baseMilestone],
  metadata: baseMetadata,
};

/** Array de milestones vazio. */
export const invalidEmptyMilestonesPlan: unknown = {
  schema_version: MAINTENANCE_PLAN_SCHEMA_VERSION,
  vehicle_summary: baseVehicleSummary,
  base_rules: baseRules,
  system_profile: baseSystemProfile,
  milestones: [],
  metadata: baseMetadata,
};

/** Confidence fora do range 0–100. */
export const invalidConfidencePlan: unknown = {
  schema_version: MAINTENANCE_PLAN_SCHEMA_VERSION,
  vehicle_summary: baseVehicleSummary,
  base_rules: baseRules,
  system_profile: baseSystemProfile,
  milestones: [
    {
      ...baseMilestone,
      items: [{ ...validItem, confidence: 150 }],
    },
  ],
  metadata: baseMetadata,
};

/** KM negativo em milestone. */
export const invalidNegativeKmPlan: unknown = {
  schema_version: MAINTENANCE_PLAN_SCHEMA_VERSION,
  vehicle_summary: baseVehicleSummary,
  base_rules: baseRules,
  system_profile: baseSystemProfile,
  milestones: [{ ...baseMilestone, km: -10000 }],
  metadata: baseMetadata,
};

/** Bundle com lista de itens vazia. */
export const invalidBundleWithoutItemsPlan: unknown = {
  schema_version: MAINTENANCE_PLAN_SCHEMA_VERSION,
  vehicle_summary: baseVehicleSummary,
  base_rules: baseRules,
  system_profile: baseSystemProfile,
  milestones: [baseMilestone],
  purchase_bundles: [
    {
      bundle_key: "kit_vazio",
      label: "Kit vazio",
      bundle_type: "outro",
      item_keys: [],
      category: "outros",
      shopping_classification: "safe_to_buy",
    },
  ],
  metadata: baseMetadata,
};

/**
 * Inconsistência crítica: recommendation_type=not_applicable mas applies=true
 * e shopping_classification=safe_to_buy.
 */
export const invalidNotApplicableInconsistentPlan: unknown = {
  schema_version: MAINTENANCE_PLAN_SCHEMA_VERSION,
  vehicle_summary: baseVehicleSummary,
  base_rules: baseRules,
  system_profile: baseSystemProfile,
  milestones: [
    {
      ...baseMilestone,
      items: [
        {
          item_key: "kit_correia_dentada",
          label: "Kit correia dentada",
          category: "motor",
          action: "trocar",
          recommendation_type: "not_applicable",
          shopping_classification: "safe_to_buy",
          applies: true,
        },
      ],
    },
  ],
  metadata: baseMetadata,
};
