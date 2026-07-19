export const KM_UPDATE_INITIAL_DRAFT_VERSION = 0 as const;
export const KM_UPDATE_PROMOTED_DRAFT_VERSION = 1 as const;

const KM_MIN_VALUE = 0;
const KM_MAX_VALUE = 2147483647;

export type AwaitingVehicleKmUpdateDraft = {
  readonly phase: "awaiting_vehicle";
  readonly newKm: number;
  readonly requestMessageId: string;
};

export type AwaitingConfirmationKmUpdateDraft = {
  readonly phase: "awaiting_confirmation";
  readonly vehicleId: string;
  readonly expectedPreviousKm: number | null;
  readonly newKm: number;
  readonly requestMessageId: string;
  readonly isCorrection: boolean;
  // Build 6a/9 do item 6 — ID da despesa que originou esta pergunta de km
  // (fluxo despesa→km), quando houver. Ausente em km avulsa (item 1).
  readonly linkedExpenseId?: string;
};

export type KmUpdateDraft =
  | AwaitingVehicleKmUpdateDraft
  | AwaitingConfirmationKmUpdateDraft;

export type KmUpdateDraftValidationErrorCode =
  | "not_an_object"
  | "unexpected_field"
  | "missing_field"
  | "invalid_phase"
  | "invalid_new_km"
  | "invalid_request_message_id"
  | "invalid_vehicle_id"
  | "invalid_expected_previous_km"
  | "invalid_is_correction"
  | "inconsistent_is_correction"
  | "invalid_linked_expense_id";

export type KmUpdateDraftValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: KmUpdateDraftValidationErrorCode };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isValidKmInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= KM_MIN_VALUE &&
    value <= KM_MAX_VALUE
  );
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function hasExactOwnKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlyArray<string>,
): boolean {
  const keys = Object.keys(obj);
  if (keys.length !== allowed.length) return false;
  const allowedSet = new Set(allowed);
  for (const k of keys) {
    if (!allowedSet.has(k)) return false;
  }
  for (const a of allowed) {
    if (!Object.prototype.hasOwnProperty.call(obj, a)) return false;
  }
  return true;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const PARTIAL_KEYS = ["phase", "newKm", "requestMessageId"] as const;
const COMPLETE_REQUIRED_KEYS = [
  "phase",
  "vehicleId",
  "expectedPreviousKm",
  "newKm",
  "requestMessageId",
  "isCorrection",
] as const;
const COMPLETE_OPTIONAL_KEYS = ["linkedExpenseId"] as const;
const COMPLETE_ALL_KEYS: ReadonlyArray<string> = [
  ...COMPLETE_REQUIRED_KEYS,
  ...COMPLETE_OPTIONAL_KEYS,
];

export function validateAwaitingVehicleKmUpdateDraft(
  input: unknown,
): KmUpdateDraftValidationResult<AwaitingVehicleKmUpdateDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };
  const keys = Object.keys(input);
  for (const k of keys) {
    if (!(PARTIAL_KEYS as ReadonlyArray<string>).includes(k)) {
      return { ok: false, code: "unexpected_field" };
    }
  }
  for (const k of PARTIAL_KEYS) {
    if (!hasOwn(input, k)) return { ok: false, code: "missing_field" };
  }
  if (input.phase !== "awaiting_vehicle") {
    return { ok: false, code: "invalid_phase" };
  }
  if (!isValidKmInteger(input.newKm)) {
    return { ok: false, code: "invalid_new_km" };
  }
  if (!isValidUuid(input.requestMessageId)) {
    return { ok: false, code: "invalid_request_message_id" };
  }
  return {
    ok: true,
    value: {
      phase: "awaiting_vehicle",
      newKm: input.newKm,
      requestMessageId: input.requestMessageId,
    },
  };
}

export function validateAwaitingConfirmationKmUpdateDraft(
  input: unknown,
): KmUpdateDraftValidationResult<AwaitingConfirmationKmUpdateDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };
  for (const k of Object.keys(input)) {
    if (!COMPLETE_ALL_KEYS.includes(k)) {
      return { ok: false, code: "unexpected_field" };
    }
  }
  for (const k of COMPLETE_REQUIRED_KEYS) {
    if (!hasOwn(input, k)) return { ok: false, code: "missing_field" };
  }
  if (input.phase !== "awaiting_confirmation") {
    return { ok: false, code: "invalid_phase" };
  }
  if (!isValidUuid(input.vehicleId)) {
    return { ok: false, code: "invalid_vehicle_id" };
  }
  const expectedPreviousKm = input.expectedPreviousKm;
  if (expectedPreviousKm !== null && !isValidKmInteger(expectedPreviousKm)) {
    return { ok: false, code: "invalid_expected_previous_km" };
  }
  if (!isValidKmInteger(input.newKm)) {
    return { ok: false, code: "invalid_new_km" };
  }
  if (!isValidUuid(input.requestMessageId)) {
    return { ok: false, code: "invalid_request_message_id" };
  }
  if (typeof input.isCorrection !== "boolean") {
    return { ok: false, code: "invalid_is_correction" };
  }
  const hasLinkedExpenseId = hasOwn(input, "linkedExpenseId");
  if (hasLinkedExpenseId && !isValidUuid(input.linkedExpenseId)) {
    return { ok: false, code: "invalid_linked_expense_id" };
  }
  const prev = expectedPreviousKm as number | null;
  const nk = input.newKm as number;
  const derived = prev !== null && nk < prev;
  if (derived !== input.isCorrection) {
    return { ok: false, code: "inconsistent_is_correction" };
  }
  return {
    ok: true,
    value: {
      phase: "awaiting_confirmation",
      vehicleId: input.vehicleId,
      expectedPreviousKm: prev,
      newKm: nk,
      requestMessageId: input.requestMessageId,
      isCorrection: input.isCorrection,
      ...(hasLinkedExpenseId
        ? { linkedExpenseId: input.linkedExpenseId as string }
        : {}),
    },
  };
}

export function validateKmUpdateDraft(
  input: unknown,
): KmUpdateDraftValidationResult<KmUpdateDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };
  const phase = input.phase;
  if (phase === "awaiting_vehicle") {
    return validateAwaitingVehicleKmUpdateDraft(input);
  }
  if (phase === "awaiting_confirmation") {
    return validateAwaitingConfirmationKmUpdateDraft(input);
  }
  return { ok: false, code: "invalid_phase" };
}
