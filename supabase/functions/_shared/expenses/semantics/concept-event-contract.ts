import {
  findExpenseSemanticConcept,
  isExpenseSemanticItemKey,
  type ExpenseSemanticConceptDefinition,
  type ExpenseSemanticConceptKey,
  type ExpenseSemanticItemKey,
} from "./registry.ts";

/**
 * P0-3B-S3.1 — contrato puro conceito × acontecimento.
 *
 * Desconectado do resolver e do runtime. Não autoriza categoria persistida,
 * valor final, KM, veículo, ownership, confirmação, persistência ou alteração
 * do cronograma.
 */

type ForbiddenOperationalAuthority = Readonly<{
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

type ForbiddenEventFields = ForbiddenOperationalAuthority &
  Readonly<{
    executedItemKeys?: never;
    amount?: never;
    allocation?: never;
    occurrenceCount?: never;
  }>;

export type ConceptRecognitionSource = "explicit_user_statement" | "deterministic_core";

type ConceptShape<
  ConceptKey extends string,
  RelatedItemKeys extends readonly ExpenseSemanticItemKey[],
> = Readonly<{
  conceptKey: ConceptKey;
  recognitionSource: ConceptRecognitionSource;
  relatedItemKeys: RelatedItemKeys;
  amount?: never;
}> &
  ForbiddenOperationalAuthority;

export type RecognizedAutomotiveConcept = {
  [Definition in ExpenseSemanticConceptDefinition as Definition["conceptKey"]]: ConceptShape<
    Definition["conceptKey"],
    Definition["relatedItemKeys"]
  >;
}[ExpenseSemanticConceptKey];

export type NoTechnicalEffect = ForbiddenOperationalAuthority &
  Readonly<{
    status: "none";
    executedItemKeys: readonly [];
    authorization?: never;
    activation?: never;
    scheduleEffect?: never;
    scheduleUpdated?: never;
    technicalEffectApplied?: never;
  }>;

export type FutureScheduleEffectCandidate = ForbiddenOperationalAuthority &
  Readonly<{
    status: "eligible_for_future_schedule_effect";
    executedItemKeys: readonly [ExpenseSemanticItemKey, ...ExpenseSemanticItemKey[]];
    authorization: "requires_deterministic_engine_validation";
    activation: "not_applied";
    scheduleEffect?: never;
    scheduleUpdated?: never;
    technicalEffectApplied?: never;
  }>;

type NonExecutionEvent = ForbiddenEventFields &
  Readonly<{
    serviceKind?: never;
    technicalEffect: NoTechnicalEffect;
  }>;

export type PurchaseEvent = NonExecutionEvent &
  Readonly<{ kind: "purchase"; completion: "completed" }>;

export type InstallationEvent = NonExecutionEvent &
  Readonly<{ kind: "installation"; completion: "confirmed_completed" }>;

export type CompletedInspectionEvent = NonExecutionEvent &
  Readonly<{ kind: "completed_inspection"; completion: "confirmed_completed" }>;

export type QuoteEvent = NonExecutionEvent &
  Readonly<{ kind: "quote"; completion: "proposal_only" }>;

export type FutureIntentEvent = NonExecutionEvent &
  Readonly<{ kind: "future_intent"; completion: "not_started" }>;

export type ConfirmedCompletedServiceEvent = ForbiddenEventFields &
  Readonly<{
    kind: "completed_service";
    serviceKind: "preventive_service" | "replacement" | "repair";
    completion: "explicitly_confirmed";
    technicalEffect: FutureScheduleEffectCandidate;
  }>;

export type ConceptEvent =
  | PurchaseEvent
  | InstallationEvent
  | ConfirmedCompletedServiceEvent
  | CompletedInspectionEvent
  | QuoteEvent
  | FutureIntentEvent;

export type ConceptWithEvents = ForbiddenOperationalAuthority &
  Readonly<{
    concept: RecognizedAutomotiveConcept;
    events: readonly [ConceptEvent, ...ConceptEvent[]];
    amount?: never;
  }>;

type ForbiddenFinancialAllocation = Readonly<{
  executedItemKeys?: never;
  allocations?: never;
  conceptAllocations?: never;
  eventAllocations?: never;
  splitByConcept?: never;
  splitByEvent?: never;
}>;

export type PresentFinancialOccurrence = ForbiddenOperationalAuthority &
  ForbiddenFinancialAllocation &
  Readonly<{
    status: "present";
    occurrenceCount: 1;
    reason?: never;
    amount: Readonly<{
      kind: "single_user_declared_total";
      declaredAmount: number;
      allocation: "undivided";
      conceptAllocations?: never;
      eventAllocations?: never;
    }>;
  }>;

export type AbsentFinancialOccurrenceReason =
  | "warranty"
  | "free_service"
  | "owner_performed"
  | "previously_purchased_part"
  | "quote_only"
  | "future_intent_only"
  | "no_completed_expense";

export type AbsentFinancialOccurrence = ForbiddenOperationalAuthority &
  ForbiddenFinancialAllocation &
  Readonly<{
    status: "absent";
    reason: AbsentFinancialOccurrenceReason;
    occurrenceCount?: never;
    amount?: never;
  }>;

export type FinancialOccurrence = PresentFinancialOccurrence | AbsentFinancialOccurrence;

/** Preserva ordem, multiplicidade e um único total indivisível, sem vínculos inventados. */
export type ConceptEventOccurrence = ForbiddenOperationalAuthority &
  Readonly<{
    contractVersion: "p0_3b_s3_1";
    concepts: readonly [ConceptWithEvents, ...ConceptWithEvents[]];
    financialOccurrence: FinancialOccurrence;
    aiAuthority: "none";
    runtimeIntegration: "disconnected";
    amount?: never;
  }>;

export type ConceptEventContractValidationErrorCode =
  | "invalid_type"
  | "unknown_property"
  | "invalid_value"
  | "invalid_financial_coherence";

export type ConceptEventContractValidationResult =
  | Readonly<{ valid: true; value: ConceptEventOccurrence }>
  | Readonly<{
      valid: false;
      error: Readonly<{ code: ConceptEventContractValidationErrorCode; path: string }>;
    }>;

const RECOGNITION_SOURCES: ReadonlySet<unknown> = new Set([
  "explicit_user_statement",
  "deterministic_core",
]);
const EVENT_KINDS: ReadonlySet<unknown> = new Set([
  "purchase",
  "installation",
  "completed_service",
  "completed_inspection",
  "quote",
  "future_intent",
]);
const SERVICE_KINDS: ReadonlySet<unknown> = new Set([
  "preventive_service",
  "replacement",
  "repair",
]);
const ABSENCE_REASONS: ReadonlySet<unknown> = new Set([
  "warranty",
  "free_service",
  "owner_performed",
  "previously_purchased_part",
  "quote_only",
  "future_intent_only",
  "no_completed_expense",
]);
const EXECUTION_ABSENCE_REASONS: ReadonlySet<unknown> = new Set([
  "warranty",
  "free_service",
  "owner_performed",
  "previously_purchased_part",
]);

const arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const objectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const reflectOwnKeys = Reflect.ownKeys;

type Failure = Extract<ConceptEventContractValidationResult, { valid: false }>;
type SafeObject = Readonly<{ values: Readonly<Record<string, unknown>> }>;
type SafeArray = Readonly<{ values: readonly unknown[] }>;
type EventKind = ConceptEvent["kind"];
type ValidatedEvent = Readonly<{ kind: EventKind }>;
type IntrospectionResult<Value> =
  | Readonly<{ succeeded: true; value: Value }>
  | Readonly<{ succeeded: false }>;

const fail = (code: ConceptEventContractValidationErrorCode, path: string): Failure => ({
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
  if (typeof value !== "object" || value === null) {
    return fail("invalid_type", path);
  }
  const arrayInspection = inspectArray(value);
  if (!arrayInspection.succeeded || arrayInspection.value) return fail("invalid_type", path);
  const prototype = inspectPrototype(value);
  if (!prototype.succeeded || (prototype.value !== objectPrototype && prototype.value !== null)) {
    return fail("invalid_type", path);
  }

  const allowed = new Set(allowedKeys);
  const descriptorsInspection = inspectDescriptors(value);
  if (!descriptorsInspection.succeeded) return fail("invalid_type", path);
  const descriptors = descriptorsInspection.value;
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
    if (!hasOwn(descriptors, key)) {
      return fail("invalid_type", `${path}.${key}`);
    }
  }
  return { values };
};

const isFailure = (value: SafeObject | SafeArray | ValidatedEvent | Failure): value is Failure =>
  hasOwn(value, "valid");

const checkArray = (value: unknown, path: string, nonEmpty: boolean): SafeArray | Failure => {
  const arrayInspection = inspectArray(value);
  if (!arrayInspection.succeeded || !arrayInspection.value) return fail("invalid_type", path);
  if (typeof value !== "object" || value === null) return fail("invalid_type", path);
  const prototype = inspectPrototype(value);
  if (!prototype.succeeded) return fail("invalid_type", path);
  const keysInspection = inspectOwnKeys(value);
  if (!keysInspection.succeeded) return fail("invalid_type", path);
  const keys = keysInspection.value;
  const lengthInspection = inspectDescriptor(value, "length");
  if (!lengthInspection.succeeded) return fail("invalid_type", path);
  const lengthDescriptor = lengthInspection.value;
  if (lengthDescriptor === undefined || typeof lengthDescriptor.value !== "number") {
    return fail("invalid_type", path);
  }
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || (nonEmpty && length === 0)) {
    return fail("invalid_type", path);
  }
  const values: unknown[] = [];
  for (const key of keys) {
    if (typeof key !== "string") return fail("unknown_property", path);
    if (key === "length") continue;
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
      return fail("unknown_property", `${path}.${key}`);
    }
  }
  for (let index = 0; index < length; index += 1) {
    const descriptorInspection = inspectDescriptor(value, String(index));
    if (!descriptorInspection.succeeded) return fail("invalid_type", `${path}[${index}]`);
    const descriptor = descriptorInspection.value;
    if (descriptor === undefined || !hasOwn(descriptor, "value")) {
      return fail("invalid_type", `${path}[${index}]`);
    }
    values.push(descriptor.value);
  }
  if (prototype.value !== arrayPrototype) return fail("invalid_type", path);
  return { values };
};

const validateStringArray = (
  value: unknown,
  isAllowed: (item: unknown) => boolean,
  path: string,
  nonEmpty: boolean,
): Failure | undefined => {
  const array = checkArray(value, path, nonEmpty);
  if (isFailure(array)) return array;
  const invalidIndex = array.values.findIndex((item) => !isAllowed(item));
  return invalidIndex < 0 ? undefined : fail("invalid_value", `${path}[${invalidIndex}]`);
};

const validateConcept = (value: unknown, path: string): Failure | undefined => {
  const checked = checkObject(
    value,
    ["conceptKey", "recognitionSource", "relatedItemKeys"],
    ["conceptKey", "recognitionSource", "relatedItemKeys"],
    path,
  );
  if (isFailure(checked)) return checked;
  const object = checked.values;
  if (!RECOGNITION_SOURCES.has(object.recognitionSource)) {
    return fail("invalid_value", `${path}.recognitionSource`);
  }
  const definition = findExpenseSemanticConcept(object.conceptKey);
  if (definition === undefined) return fail("invalid_value", `${path}.conceptKey`);
  const expected = definition.relatedItemKeys;
  const related = checkArray(object.relatedItemKeys, `${path}.relatedItemKeys`, false);
  if (isFailure(related)) return related;
  if (
    related.values.length !== expected.length ||
    related.values.some((item, index) => item !== expected[index])
  ) {
    return fail("invalid_value", `${path}.relatedItemKeys`);
  }
  return undefined;
};

const validateNoTechnicalEffect = (value: unknown, path: string): Failure | undefined => {
  const discriminator = checkObject(
    value,
    ["status", "executedItemKeys", "authorization", "activation"],
    ["status", "executedItemKeys"],
    path,
  );
  if (isFailure(discriminator)) return discriminator;
  if (discriminator.values.status !== "none") return fail("invalid_value", `${path}.status`);
  const checked = checkObject(
    value,
    ["status", "executedItemKeys"],
    ["status", "executedItemKeys"],
    path,
  );
  if (isFailure(checked)) return checked;
  const object = checked.values;
  const keys = checkArray(object.executedItemKeys, `${path}.executedItemKeys`, false);
  if (isFailure(keys)) return keys;
  if (keys.values.length !== 0) {
    return fail("invalid_value", `${path}.executedItemKeys`);
  }
  return undefined;
};

const validateFutureEffect = (value: unknown, path: string): Failure | undefined => {
  const checked = checkObject(
    value,
    ["status", "executedItemKeys", "authorization", "activation"],
    ["status", "executedItemKeys", "authorization", "activation"],
    path,
  );
  if (isFailure(checked)) return checked;
  const object = checked.values;
  if (object.status !== "eligible_for_future_schedule_effect") {
    return fail("invalid_value", `${path}.status`);
  }
  const keysFailure = validateStringArray(
    object.executedItemKeys,
    isExpenseSemanticItemKey,
    `${path}.executedItemKeys`,
    true,
  );
  if (keysFailure) return keysFailure;
  if (object.authorization !== "requires_deterministic_engine_validation") {
    return fail("invalid_value", `${path}.authorization`);
  }
  if (object.activation !== "not_applied") {
    return fail("invalid_value", `${path}.activation`);
  }
  return undefined;
};

const isEventKind = (value: unknown): value is EventKind => EVENT_KINDS.has(value);

const validateEvent = (value: unknown, path: string): ValidatedEvent | Failure => {
  const event = checkObject(
    value,
    ["kind", "serviceKind", "completion", "technicalEffect"],
    ["kind", "completion", "technicalEffect"],
    path,
  );
  if (isFailure(event)) return event;
  const object = event.values;
  if (!isEventKind(object.kind)) return fail("invalid_value", `${path}.kind`);
  const kind = object.kind;
  if (kind === "completed_service") {
    if (!hasOwn(object, "serviceKind")) return fail("invalid_type", `${path}.serviceKind`);
    if (!SERVICE_KINDS.has(object.serviceKind)) {
      return fail("invalid_value", `${path}.serviceKind`);
    }
    if (object.completion !== "explicitly_confirmed") {
      return fail("invalid_value", `${path}.completion`);
    }
    const effectFailure = validateFutureEffect(object.technicalEffect, `${path}.technicalEffect`);
    return effectFailure ?? { kind };
  }
  if (hasOwn(object, "serviceKind")) return fail("unknown_property", `${path}.serviceKind`);
  const completionByKind: Readonly<Record<string, string>> = {
    purchase: "completed",
    installation: "confirmed_completed",
    completed_inspection: "confirmed_completed",
    quote: "proposal_only",
    future_intent: "not_started",
  };
  if (object.completion !== completionByKind[kind]) {
    return fail("invalid_value", `${path}.completion`);
  }
  const effectFailure = validateNoTechnicalEffect(
    object.technicalEffect,
    `${path}.technicalEffect`,
  );
  return effectFailure ?? { kind };
};

const validateFinancialOccurrence = (
  value: unknown,
  eventKinds: readonly string[],
  path: string,
): Failure | undefined => {
  const financial = checkObject(
    value,
    ["status", "occurrenceCount", "amount", "reason"],
    ["status"],
    path,
  );
  if (isFailure(financial)) return financial;
  if (financial.values.status === "present") {
    const checked = checkObject(
      value,
      ["status", "occurrenceCount", "amount"],
      ["status", "occurrenceCount", "amount"],
      path,
    );
    if (isFailure(checked)) return checked;
    const object = checked.values;
    if (object.occurrenceCount !== 1) return fail("invalid_value", `${path}.occurrenceCount`);
    const checkedAmount = checkObject(
      object.amount,
      ["kind", "declaredAmount", "allocation"],
      ["kind", "declaredAmount", "allocation"],
      `${path}.amount`,
    );
    if (isFailure(checkedAmount)) return checkedAmount;
    const amount = checkedAmount.values;
    if (amount.kind !== "single_user_declared_total") {
      return fail("invalid_value", `${path}.amount.kind`);
    }
    if (
      typeof amount.declaredAmount !== "number" ||
      !Number.isFinite(amount.declaredAmount) ||
      amount.declaredAmount < 0
    ) {
      return fail("invalid_value", `${path}.amount.declaredAmount`);
    }
    if (amount.allocation !== "undivided") {
      return fail("invalid_value", `${path}.amount.allocation`);
    }
    if (eventKinds.every((kind) => kind === "quote" || kind === "future_intent")) {
      return fail("invalid_financial_coherence", path);
    }
    return undefined;
  }
  if (financial.values.status !== "absent") return fail("invalid_value", `${path}.status`);
  const checked = checkObject(value, ["status", "reason"], ["status", "reason"], path);
  if (isFailure(checked)) return checked;
  const object = checked.values;
  if (!ABSENCE_REASONS.has(object.reason)) return fail("invalid_value", `${path}.reason`);
  if (eventKinds.includes("purchase")) {
    return fail("invalid_financial_coherence", `${path}.reason`);
  }
  const onlyQuotes = eventKinds.every((kind) => kind === "quote");
  const onlyFutureIntent = eventKinds.every((kind) => kind === "future_intent");
  const onlyQuotesAndFutureIntent = eventKinds.every(
    (kind) => kind === "quote" || kind === "future_intent",
  );
  const hasQuoteAndFutureIntent =
    eventKinds.includes("quote") && eventKinds.includes("future_intent");
  const onlyCompletedInspection = eventKinds.every((kind) => kind === "completed_inspection");
  const hasCompletedService = eventKinds.includes("completed_service");
  const coherent =
    (onlyQuotes && object.reason === "quote_only") ||
    (onlyFutureIntent && object.reason === "future_intent_only") ||
    (onlyQuotesAndFutureIntent &&
      hasQuoteAndFutureIntent &&
      object.reason === "no_completed_expense") ||
    (onlyCompletedInspection && object.reason === "no_completed_expense") ||
    (hasCompletedService && EXECUTION_ABSENCE_REASONS.has(object.reason));
  if (!coherent) {
    return fail("invalid_financial_coherence", `${path}.reason`);
  }
  return undefined;
};

/** Validação pura, determinística, sem coerção e fail-closed para dados unknown. */
function validateConceptEventOccurrenceSafely(
  input: unknown,
): ConceptEventContractValidationResult {
  const root = checkObject(
    input,
    ["contractVersion", "concepts", "financialOccurrence", "aiAuthority", "runtimeIntegration"],
    ["contractVersion", "concepts", "financialOccurrence", "aiAuthority", "runtimeIntegration"],
    "$",
  );
  if (isFailure(root)) return root;
  const rootValues = root.values;
  if (rootValues.contractVersion !== "p0_3b_s3_1") {
    return fail("invalid_value", "$.contractVersion");
  }
  if (rootValues.aiAuthority !== "none") return fail("invalid_value", "$.aiAuthority");
  if (rootValues.runtimeIntegration !== "disconnected") {
    return fail("invalid_value", "$.runtimeIntegration");
  }
  const concepts = checkArray(rootValues.concepts, "$.concepts", true);
  if (isFailure(concepts)) return concepts;
  const eventKinds: string[] = [];
  for (let conceptIndex = 0; conceptIndex < concepts.values.length; conceptIndex += 1) {
    const entry = concepts.values[conceptIndex];
    const path = `$.concepts[${conceptIndex}]`;
    const group = checkObject(entry, ["concept", "events"], ["concept", "events"], path);
    if (isFailure(group)) return group;
    const conceptFailure = validateConcept(group.values.concept, `${path}.concept`);
    if (conceptFailure) return conceptFailure;
    const events = checkArray(group.values.events, `${path}.events`, true);
    if (isFailure(events)) return events;
    for (let eventIndex = 0; eventIndex < events.values.length; eventIndex += 1) {
      const event = events.values[eventIndex];
      const eventPath = `${path}.events[${eventIndex}]`;
      const validatedEvent = validateEvent(event, eventPath);
      if (isFailure(validatedEvent)) return validatedEvent;
      eventKinds.push(validatedEvent.kind);
    }
  }
  const financialFailure = validateFinancialOccurrence(
    rootValues.financialOccurrence,
    eventKinds,
    "$.financialOccurrence",
  );
  if (financialFailure) return financialFailure;
  return { valid: true, value: input as ConceptEventOccurrence };
}

/** Validação pura, determinística, sem coerção e fail-closed para dados unknown. */
export const validateConceptEventOccurrence = validateConceptEventOccurrenceSafely;
