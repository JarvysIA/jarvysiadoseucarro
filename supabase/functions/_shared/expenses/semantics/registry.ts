import {
  EXPENSE_SEMANTIC_CATEGORIES,
  EXPENSE_SEMANTIC_ITEM_KEYS,
  type ExpenseSemanticCategory,
  type ExpenseSemanticItemKey,
} from "./types.ts";

const CATEGORY_SET: ReadonlySet<unknown> = new Set(EXPENSE_SEMANTIC_CATEGORIES);
const ITEM_KEY_SET: ReadonlySet<unknown> = new Set(EXPENSE_SEMANTIC_ITEM_KEYS);

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
