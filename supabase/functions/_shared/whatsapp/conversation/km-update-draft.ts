// Build 5.7F2E1A.5-MB — Contratos e validators puros dos drafts de atualização de KM.
// Módulo 100% puro: sem I/O, sem Supabase, sem env, sem clock, sem crypto, sem rede.

// ---------------------------------------------------------------------------
// Constantes de versão externa (não pertencem ao payload do draft)
// ---------------------------------------------------------------------------

export const KM_UPDATE_PARTIAL_DRAFT_VERSION = 0 as const;
export const KM_UPDATE_COMPLETE_DRAFT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Limites locais (independentes de banco)
// ---------------------------------------------------------------------------

const KM_MIN_VALUE = 0;
const KM_MAX_VALUE = 2147483647;

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

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
};

export type KmUpdateDraft =
  | AwaitingVehicleKmUpdateDraft
  | AwaitingConfirmationKmUpdateDraft;

// ---------------------------------------------------------------------------
// Erros e resultados
// ---------------------------------------------------------------------------

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
  | "inconsistent_is_correction";

export type KmUpdateDraftValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: KmUpdateDraftValidationErrorCode };

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

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

// UUID canônico (aceita v1..v5 conforme padrão RFC 4122 usado pelo Postgres uuid).
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
const COMPLETE_KEYS = [
  "phase",
  "vehicleId",
  "expectedPreviousKm",
  "newKm",
  "requestMessageId",
  "isCorrection",
] as const;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateAwaitingVehicleKmUpdateDraft(
  input: unknown,
): KmUpdateDraftValidationResult<AwaitingVehicleKmUpdateDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };

  const keys = Object.keys(input);
  // detectar campos não permitidos
  for (const k of keys) {
    if (!(PARTIAL_KEYS as ReadonlyArray<string>).includes(k)) {
      return { ok: false, code: "unexpected_field" };
    }
  }
  // obrigatórios presentes
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

  const keys = Object.keys(input);
  for (const k of keys) {
    if (!(COMPLETE_KEYS as ReadonlyArray<string>).includes(k)) {
      return { ok: false, code: "unexpected_field" };
    }
  }
  if (!hasExactOwnKeys(input, COMPLETE_KEYS)) {
    // faltando algum campo obrigatório
    for (const k of COMPLETE_KEYS) {
      if (!hasOwn(input, k)) return { ok: false, code: "missing_field" };
    }
    return { ok: false, code: "unexpected_field" };
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

  // Consistência de isCorrection
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
