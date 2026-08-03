import {
  findExpenseSemanticConcept,
  isExpenseSemanticCategory,
  type ExpenseSemanticConceptDefinition,
  type ExpenseSemanticConceptKey,
  type ExpenseSemanticItemKey,
} from "./registry.ts";
import type { ExpenseSemanticCategory } from "./types.ts";

/**
 * P0-3B-S3.3 — ocorrência semântica independente de despesa.
 *
 * Contrato puro e desconectado. Não autoriza persistência, efeitos técnicos,
 * alterações de cards ou cronograma, nem representa KM ou vínculos entre despesas.
 */

type ForbiddenOperationalFields = Readonly<{
  operationalAuthority?: never;
  title?: never;
  quantity?: never;
  unit?: never;
  event?: never;
  events?: never;
  kind?: never;
  serviceKind?: never;
  completion?: never;
  occurrenceCount?: never;
  recognitionSource?: never;
  relatedItemKeys?: never;
  executedItemKeys?: never;
  amount?: never;
  financialOccurrence?: never;
  allocation?: never;
  allocations?: never;
  conceptAllocations?: never;
  eventAllocations?: never;
  splitByConcept?: never;
  splitByEvent?: never;
  km?: never;
  kmAtual?: never;
  kmRegistro?: never;
  expectedPreviousKm?: never;
  vehicleId?: never;
  userId?: never;
  ownerId?: never;
  expenseId?: never;
  previousExpenseId?: never;
  linkedExpenseId?: never;
  serviceCompleted?: never;
  technicalEffect?: never;
  scheduleEffect?: never;
  scheduleUpdated?: never;
  technicalEffectApplied?: never;
  cardEffect?: never;
  confirmation?: never;
  confirmed?: never;
  persistable?: never;
  persisted?: never;
  persistenceStatus?: never;
}>;

export type SemanticFinancialValue =
  | Readonly<{
      status: "declared_positive";
      declaredAmount: number;
    }>
  | Readonly<{
      status: "confirmed_zero_cost";
      declaredAmount: 0;
    }>
  | Readonly<{
      status: "not_informed";
      declaredAmount?: never;
    }>;

export type ConceptRecognitionSource = "explicit_user_statement" | "deterministic_core";

type RecognizedConceptShape<
  ConceptKey extends string,
  RelatedItemKeys extends readonly ExpenseSemanticItemKey[],
> = Readonly<{
  conceptKey: ConceptKey;
  recognitionSource: ConceptRecognitionSource;
  relatedItemKeys: RelatedItemKeys;
  amount?: never;
  serviceCompleted?: never;
  km?: never;
  kmAtual?: never;
  vehicleId?: never;
  userId?: never;
  ownerId?: never;
  category?: never;
  persistedCategory?: never;
  scheduleEffect?: never;
  scheduleUpdated?: never;
  technicalEffectApplied?: never;
  confirmation?: never;
  confirmed?: never;
  persisted?: never;
  persistenceStatus?: never;
}>;

export type RecognizedAutomotiveConcept = {
  [Definition in ExpenseSemanticConceptDefinition as Definition["conceptKey"]]: RecognizedConceptShape<
    Definition["conceptKey"],
    Definition["relatedItemKeys"]
  >;
}[ExpenseSemanticConceptKey];

export type ExpenseSemanticOccurrence = ForbiddenOperationalFields &
  Readonly<{
    contractVersion: "p0_3b_s3_3";
    concepts: readonly RecognizedAutomotiveConcept[];
    category: ExpenseSemanticCategory;
    description: string;
    financialValue: SemanticFinancialValue;
    aiAuthority: "none";
    runtimeIntegration: "disconnected";
  }>;

export type ExpenseSemanticOccurrenceValidationErrorCode =
  | "invalid_type"
  | "unknown_property"
  | "invalid_value"
  | "duplicate_concept"
  | "category_concept_mismatch"
  | "unsupported_category_conflict";

export type ExpenseSemanticOccurrenceValidationResult =
  | Readonly<{ valid: true; value: ExpenseSemanticOccurrence }>
  | Readonly<{
      valid: false;
      error: Readonly<{
        code: ExpenseSemanticOccurrenceValidationErrorCode;
        path: string;
      }>;
    }>;

const arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const objectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const reflectOwnKeys = Reflect.ownKeys;

type Failure = Extract<ExpenseSemanticOccurrenceValidationResult, { valid: false }>;
type SafeObject = Readonly<{ values: Readonly<Record<string, unknown>> }>;
type SafeArray = Readonly<{ values: readonly unknown[] }>;
type ValidatedConcept = Readonly<{ conceptKey: ExpenseSemanticConceptKey }>;
type IntrospectionResult<Value> =
  | Readonly<{ succeeded: true; value: Value }>
  | Readonly<{ succeeded: false }>;

const RECOGNITION_SOURCES: ReadonlySet<unknown> = new Set([
  "explicit_user_statement",
  "deterministic_core",
]);

const fail = (code: ExpenseSemanticOccurrenceValidationErrorCode, path: string): Failure => ({
  valid: false,
  error: { code, path },
});

const hasOwn = (value: object, key: PropertyKey): boolean =>
  objectPrototypeHasOwnProperty.call(value, key);

const inspectArray = (value: unknown): IntrospectionResult<boolean> => {
  try {
    return { succeeded: true, value: arrayIsArray(value) };
  } catch {
    return { succeeded: false };
  }
};

const inspectPrototype = (value: object): IntrospectionResult<object | null> => {
  try {
    return { succeeded: true, value: objectGetPrototypeOf(value) };
  } catch {
    return { succeeded: false };
  }
};

const inspectDescriptors = (value: object): IntrospectionResult<PropertyDescriptorMap> => {
  try {
    return { succeeded: true, value: objectGetOwnPropertyDescriptors(value) };
  } catch {
    return { succeeded: false };
  }
};

const inspectOwnKeys = (value: object): IntrospectionResult<(string | symbol)[]> => {
  try {
    return { succeeded: true, value: reflectOwnKeys(value) };
  } catch {
    return { succeeded: false };
  }
};

const inspectDescriptor = (
  value: object,
  key: PropertyKey,
): IntrospectionResult<PropertyDescriptor | undefined> => {
  try {
    return { succeeded: true, value: objectGetOwnPropertyDescriptor(value, key) };
  } catch {
    return { succeeded: false };
  }
};

const checkObject = (
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  path: string,
): SafeObject | Failure => {
  if (typeof value !== "object" || value === null) return fail("invalid_type", path);
  const arrayInspection = inspectArray(value);
  if (!arrayInspection.succeeded || arrayInspection.value) return fail("invalid_type", path);
  const prototype = inspectPrototype(value);
  if (!prototype.succeeded || (prototype.value !== objectPrototype && prototype.value !== null)) {
    return fail("invalid_type", path);
  }
  const descriptorsInspection = inspectDescriptors(value);
  if (!descriptorsInspection.succeeded) return fail("invalid_type", path);
  const descriptors = descriptorsInspection.value;
  const allowed = new Set(allowedKeys);
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of reflectOwnKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      return fail("unknown_property", typeof key === "string" ? `${path}.${key}` : path);
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail("invalid_type", `${path}.${key}`);
    }
    values[key] = descriptor.value;
  }
  for (const key of requiredKeys) {
    if (!hasOwn(descriptors, key)) return fail("invalid_type", `${path}.${key}`);
  }
  return { values };
};

const isFailure = (value: SafeObject | SafeArray | ValidatedConcept | Failure): value is Failure =>
  hasOwn(value, "valid");

const checkArray = (value: unknown, path: string): SafeArray | Failure => {
  const arrayInspection = inspectArray(value);
  if (!arrayInspection.succeeded || !arrayInspection.value || value === null) {
    return fail("invalid_type", path);
  }
  const array = value as object;
  const prototype = inspectPrototype(array);
  if (!prototype.succeeded || prototype.value !== arrayPrototype) return fail("invalid_type", path);
  const keysInspection = inspectOwnKeys(array);
  const lengthInspection = inspectDescriptor(array, "length");
  if (!keysInspection.succeeded || !lengthInspection.succeeded) return fail("invalid_type", path);
  const lengthDescriptor = lengthInspection.value;
  if (
    lengthDescriptor === undefined ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return fail("invalid_type", path);
  }
  const length = lengthDescriptor.value;
  for (const key of keysInspection.value) {
    if (typeof key !== "string") return fail("unknown_property", path);
    if (key === "length") continue;
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
      return fail("unknown_property", `${path}.${key}`);
    }
  }
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptorInspection = inspectDescriptor(array, String(index));
    if (!descriptorInspection.succeeded) return fail("invalid_type", `${path}[${index}]`);
    const descriptor = descriptorInspection.value;
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail("invalid_type", `${path}[${index}]`);
    }
    values.push(descriptor.value);
  }
  return { values };
};

const validateConcept = (value: unknown, path: string): Failure | ValidatedConcept => {
  const concept = checkObject(
    value,
    ["conceptKey", "recognitionSource", "relatedItemKeys"],
    ["conceptKey", "recognitionSource", "relatedItemKeys"],
    path,
  );
  if (isFailure(concept)) return concept;
  const definition = findExpenseSemanticConcept(concept.values.conceptKey);
  if (definition === undefined) return fail("invalid_value", `${path}.conceptKey`);
  if (!RECOGNITION_SOURCES.has(concept.values.recognitionSource)) {
    return fail("invalid_value", `${path}.recognitionSource`);
  }
  const relatedItemKeys = checkArray(concept.values.relatedItemKeys, `${path}.relatedItemKeys`);
  if (isFailure(relatedItemKeys)) return relatedItemKeys;
  if (
    relatedItemKeys.values.length !== definition.relatedItemKeys.length ||
    relatedItemKeys.values.some((item, index) => item !== definition.relatedItemKeys[index])
  ) {
    return fail("invalid_value", `${path}.relatedItemKeys`);
  }
  return { conceptKey: definition.conceptKey };
};

const validateFinancialValue = (value: unknown): Failure | undefined => {
  const financial = checkObject(
    value,
    ["status", "declaredAmount"],
    ["status"],
    "$.financialValue",
  );
  if (isFailure(financial)) return financial;
  const { status } = financial.values;
  if (status === "declared_positive") {
    const declared = checkObject(
      value,
      ["status", "declaredAmount"],
      ["status", "declaredAmount"],
      "$.financialValue",
    );
    if (isFailure(declared)) return declared;
    const amount = declared.values.declaredAmount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return fail("invalid_value", "$.financialValue.declaredAmount");
    }
    return undefined;
  }
  if (status === "confirmed_zero_cost") {
    const zero = checkObject(
      value,
      ["status", "declaredAmount"],
      ["status", "declaredAmount"],
      "$.financialValue",
    );
    if (isFailure(zero)) return zero;
    return zero.values.declaredAmount === 0
      ? undefined
      : fail("invalid_value", "$.financialValue.declaredAmount");
  }
  if (status === "not_informed") {
    const absent = checkObject(value, ["status"], ["status"], "$.financialValue");
    return isFailure(absent) ? absent : undefined;
  }
  return fail("invalid_value", "$.financialValue.status");
};

/**
 * Cascata determinística P0-3B-S3.4: Revisão vence sempre que presente; senão
 * Manutenção vence como desempate; senão exige defaultCategory uniforme entre
 * os conceitos; caso contrário falha fechado com "conflict".
 */
export function resolveCategoryForConcepts(
  concepts: readonly RecognizedAutomotiveConcept[],
):
  | Readonly<{ status: "ok"; category: ExpenseSemanticCategory }>
  | Readonly<{ status: "conflict" }> {
  const defaultCategories = concepts.map(
    (concept) => findExpenseSemanticConcept(concept.conceptKey)?.defaultCategory,
  );
  if (defaultCategories.includes("Revisão")) {
    return { status: "ok", category: "Revisão" };
  }
  if (defaultCategories.includes("Manutenção")) {
    return { status: "ok", category: "Manutenção" };
  }
  const [first, ...rest] = defaultCategories;
  if (first !== undefined && rest.every((category) => category === first)) {
    return { status: "ok", category: first };
  }
  return { status: "conflict" };
}

/** Validação pura, determinística, sem coerção, mutação ou efeitos externos. */
export function validateExpenseSemanticOccurrence(
  input: unknown,
): ExpenseSemanticOccurrenceValidationResult {
  const root = checkObject(
    input,
    [
      "contractVersion",
      "concepts",
      "category",
      "description",
      "financialValue",
      "aiAuthority",
      "runtimeIntegration",
    ],
    [
      "contractVersion",
      "concepts",
      "category",
      "description",
      "financialValue",
      "aiAuthority",
      "runtimeIntegration",
    ],
    "$",
  );
  if (isFailure(root)) return root;
  const values = root.values;
  if (values.contractVersion !== "p0_3b_s3_3") {
    return fail("invalid_value", "$.contractVersion");
  }
  if (values.aiAuthority !== "none") {
    return fail("invalid_value", "$.aiAuthority");
  }
  if (values.runtimeIntegration !== "disconnected") {
    return fail("invalid_value", "$.runtimeIntegration");
  }
  if (!isExpenseSemanticCategory(values.category)) {
    return fail("invalid_value", "$.category");
  }
  if (
    typeof values.description !== "string" ||
    values.description.trim().length === 0 ||
    values.description.length > 500
  ) {
    return fail("invalid_value", "$.description");
  }
  const concepts = checkArray(values.concepts, "$.concepts");
  if (isFailure(concepts)) return concepts;
  const seen = new Set<ExpenseSemanticConceptKey>();
  for (let index = 0; index < concepts.values.length; index += 1) {
    const concept = concepts.values[index];
    const path = `$.concepts[${index}]`;
    const validatedConcept = validateConcept(concept, path);
    if (isFailure(validatedConcept)) return validatedConcept;
    if (seen.has(validatedConcept.conceptKey)) {
      return fail("duplicate_concept", path);
    }
    seen.add(validatedConcept.conceptKey);
  }
  if (concepts.values.length > 0) {
    const categoryResolution = resolveCategoryForConcepts(
      concepts.values as readonly RecognizedAutomotiveConcept[],
    );
    if (categoryResolution.status === "conflict") {
      return fail("unsupported_category_conflict", "$.concepts");
    }
    if (values.category !== categoryResolution.category) {
      return fail("category_concept_mismatch", "$.category");
    }
  }
  const financialFailure = validateFinancialValue(values.financialValue);
  if (financialFailure) return financialFailure;
  return { valid: true, value: input as ExpenseSemanticOccurrence };
}
