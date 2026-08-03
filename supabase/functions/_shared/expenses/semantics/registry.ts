import {
  EXPENSE_SEMANTIC_CATEGORIES,
  EXPENSE_SEMANTIC_ITEM_KEYS,
  type ExpenseSemanticCategory,
  type ExpenseSemanticItemKey,
} from "./types.ts";

export { EXPENSE_SEMANTIC_ITEM_KEYS };
export type { ExpenseSemanticItemKey };

const CATEGORY_SET: ReadonlySet<unknown> = new Set(EXPENSE_SEMANTIC_CATEGORIES);
const ITEM_KEY_SET: ReadonlySet<unknown> = new Set(EXPENSE_SEMANTIC_ITEM_KEYS);

type ExpenseSemanticConceptDefinitionShape = Readonly<{
  conceptKey: string;
  relatedItemKeys: readonly ExpenseSemanticItemKey[];
  defaultCategory: ExpenseSemanticCategory;
}>;

export const EXPENSE_SEMANTIC_CONCEPT_REGISTRY = Object.freeze([
  Object.freeze({
    conceptKey: "engine_oil",
    relatedItemKeys: Object.freeze(["oleo_motor"] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "engine_oil_filter",
    relatedItemKeys: Object.freeze(["filtro_oleo"] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "tires",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Manutenção",
  }),
  Object.freeze({
    conceptKey: "multimedia_system",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Acessórios",
  }),
  Object.freeze({
    conceptKey: "transmission_fluid",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "brake_pads",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "engine_air_filter",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "cabin_filter",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "fuel_filter",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "timing_kit",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "cooling_system",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "spark_and_injection",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "suspension",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "wiper_blades",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "wheel_alignment",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "power_steering_fluid",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
  Object.freeze({
    conceptKey: "hybrid_ecvt_diagnostic",
    relatedItemKeys: Object.freeze([] as const),
    defaultCategory: "Revisão",
  }),
] as const satisfies readonly ExpenseSemanticConceptDefinitionShape[]);

export type ExpenseSemanticConceptDefinition = (typeof EXPENSE_SEMANTIC_CONCEPT_REGISTRY)[number];
export type ExpenseSemanticConceptKey = ExpenseSemanticConceptDefinition["conceptKey"];

export function findExpenseSemanticConcept(
  value: unknown,
): ExpenseSemanticConceptDefinition | undefined {
  return EXPENSE_SEMANTIC_CONCEPT_REGISTRY.find(({ conceptKey }) => conceptKey === value);
}

export function isExpenseSemanticCategory(value: unknown): value is ExpenseSemanticCategory {
  return CATEGORY_SET.has(value);
}

export function isExpenseSemanticItemKey(value: unknown): value is ExpenseSemanticItemKey {
  return ITEM_KEY_SET.has(value);
}

export const EXPENSE_SEMANTIC_ALIASES = Object.freeze({
  engineOil: ["oleo do motor", "oleo e filtro do motor"] as const,
  engineOilFilter: ["filtro de oleo", "filtro do oleo do motor"] as const,
  transmissionFluid: [
    "oleo do cambio",
    "oleo da transmissao",
    "fluido do cambio",
    "fluido da transmissao",
  ] as const,
});

// O catálogo determinístico existente só oferece especializações manual e
// automática. Elas são auditadas aqui, mas deliberadamente não são emitidas
// para uma menção genérica de câmbio/transmissão.
export const EXISTING_SPECIALIZED_TRANSMISSION_ITEM_KEYS = [
  "oleo_cambio_manual",
  "oleo_cambio_automatico",
] as const;
