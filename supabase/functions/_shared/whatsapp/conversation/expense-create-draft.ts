// Build expense-create-draft — Contratos e validators puros dos drafts de
// criação de despesa via WhatsApp. Módulo 100% puro: sem I/O, sem Supabase,
// sem env, sem clock, sem crypto, sem rede. Não importa de actions/*.

// ---------------------------------------------------------------------------
// Constantes de versão de PERSISTÊNCIA do draft (não pertencem ao payload).
// Despesa tem até 2 perguntas pendentes (categoria, depois veículo), logo 3
// níveis de promoção: INITIAL (novo), PROMOTED_ONCE, PROMOTED_TWICE.
// ---------------------------------------------------------------------------

export const EXPENSE_CREATE_INITIAL_DRAFT_VERSION = 0 as const;
export const EXPENSE_CREATE_PROMOTED_ONCE_VERSION = 1 as const;
export const EXPENSE_CREATE_PROMOTED_TWICE_VERSION = 2 as const;

// ---------------------------------------------------------------------------
// Limites e vocabulários locais (duplicados de propósito, não importar).
// ---------------------------------------------------------------------------

const EXPENSE_MAX_VALOR = 999999999.99;

export const EXPENSE_CATEGORIES = [
  "Revisão",
  "Manutenção",
  "Lavagem",
  "Combustível",
  "IPVA",
  "Multas",
  "Seguro",
  "Acessórios",
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

export type AwaitingCategoryExpenseDraft = {
  readonly phase: "awaiting_category";
  readonly valor: number;
  readonly requestMessageId: string;
};

export type AwaitingVehicleExpenseDraft = {
  readonly phase: "awaiting_vehicle";
  readonly categoria: ExpenseCategory;
  readonly valor: number;
  readonly requestMessageId: string;
};

export type AwaitingConfirmationExpenseDraft = {
  readonly phase: "awaiting_confirmation";
  readonly categoria: ExpenseCategory;
  readonly valor: number;
  readonly vehicleId: string;
  readonly requestMessageId: string;
};

export type ExpenseCreateDraft =
  | AwaitingCategoryExpenseDraft
  | AwaitingVehicleExpenseDraft
  | AwaitingConfirmationExpenseDraft;

// ---------------------------------------------------------------------------
// Erros e resultados
// ---------------------------------------------------------------------------

export type ExpenseDraftValidationErrorCode =
  | "not_an_object"
  | "unexpected_field"
  | "missing_field"
  | "invalid_phase"
  | "invalid_valor"
  | "invalid_categoria"
  | "invalid_request_message_id"
  | "invalid_vehicle_id";

export type ExpenseDraftValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ExpenseDraftValidationErrorCode };

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function isValidValor(value: unknown): value is number {
  if (typeof value !== "number") return false;
  if (!Number.isFinite(value)) return false;
  if (value <= 0) return false;
  if (value > EXPENSE_MAX_VALOR) return false;
  // rejeita fração de centavo
  if (Math.round(value * 100) / 100 !== value) return false;
  return true;
}

const CATEGORIES_SET: ReadonlySet<string> = new Set(EXPENSE_CATEGORIES);

function isValidCategoria(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && CATEGORIES_SET.has(value);
}

const CATEGORY_KEYS = ["phase", "valor", "requestMessageId"] as const;
const VEHICLE_KEYS = [
  "phase",
  "categoria",
  "valor",
  "requestMessageId",
] as const;
const CONFIRMATION_KEYS = [
  "phase",
  "categoria",
  "valor",
  "vehicleId",
  "requestMessageId",
] as const;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateAwaitingCategoryExpenseDraft(
  input: unknown,
): ExpenseDraftValidationResult<AwaitingCategoryExpenseDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };

  for (const k of Object.keys(input)) {
    if (!(CATEGORY_KEYS as ReadonlyArray<string>).includes(k)) {
      return { ok: false, code: "unexpected_field" };
    }
  }
  for (const k of CATEGORY_KEYS) {
    if (!hasOwn(input, k)) return { ok: false, code: "missing_field" };
  }

  if (input.phase !== "awaiting_category") {
    return { ok: false, code: "invalid_phase" };
  }
  if (!isValidValor(input.valor)) {
    return { ok: false, code: "invalid_valor" };
  }
  if (!isValidUuid(input.requestMessageId)) {
    return { ok: false, code: "invalid_request_message_id" };
  }

  return {
    ok: true,
    value: {
      phase: "awaiting_category",
      valor: input.valor,
      requestMessageId: input.requestMessageId,
    },
  };
}

export function validateAwaitingVehicleExpenseDraft(
  input: unknown,
): ExpenseDraftValidationResult<AwaitingVehicleExpenseDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };

  for (const k of Object.keys(input)) {
    if (!(VEHICLE_KEYS as ReadonlyArray<string>).includes(k)) {
      return { ok: false, code: "unexpected_field" };
    }
  }
  for (const k of VEHICLE_KEYS) {
    if (!hasOwn(input, k)) return { ok: false, code: "missing_field" };
  }

  if (input.phase !== "awaiting_vehicle") {
    return { ok: false, code: "invalid_phase" };
  }
  if (!isValidCategoria(input.categoria)) {
    return { ok: false, code: "invalid_categoria" };
  }
  if (!isValidValor(input.valor)) {
    return { ok: false, code: "invalid_valor" };
  }
  if (!isValidUuid(input.requestMessageId)) {
    return { ok: false, code: "invalid_request_message_id" };
  }

  return {
    ok: true,
    value: {
      phase: "awaiting_vehicle",
      categoria: input.categoria,
      valor: input.valor,
      requestMessageId: input.requestMessageId,
    },
  };
}

export function validateAwaitingConfirmationExpenseDraft(
  input: unknown,
): ExpenseDraftValidationResult<AwaitingConfirmationExpenseDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };

  for (const k of Object.keys(input)) {
    if (!(CONFIRMATION_KEYS as ReadonlyArray<string>).includes(k)) {
      return { ok: false, code: "unexpected_field" };
    }
  }
  for (const k of CONFIRMATION_KEYS) {
    if (!hasOwn(input, k)) return { ok: false, code: "missing_field" };
  }

  if (input.phase !== "awaiting_confirmation") {
    return { ok: false, code: "invalid_phase" };
  }
  if (!isValidCategoria(input.categoria)) {
    return { ok: false, code: "invalid_categoria" };
  }
  if (!isValidValor(input.valor)) {
    return { ok: false, code: "invalid_valor" };
  }
  if (!isValidUuid(input.vehicleId)) {
    return { ok: false, code: "invalid_vehicle_id" };
  }
  if (!isValidUuid(input.requestMessageId)) {
    return { ok: false, code: "invalid_request_message_id" };
  }

  return {
    ok: true,
    value: {
      phase: "awaiting_confirmation",
      categoria: input.categoria,
      valor: input.valor,
      vehicleId: input.vehicleId,
      requestMessageId: input.requestMessageId,
    },
  };
}

export function validateExpenseCreateDraft(
  input: unknown,
): ExpenseDraftValidationResult<ExpenseCreateDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };
  const phase = input.phase;
  if (phase === "awaiting_category") {
    return validateAwaitingCategoryExpenseDraft(input);
  }
  if (phase === "awaiting_vehicle") {
    return validateAwaitingVehicleExpenseDraft(input);
  }
  if (phase === "awaiting_confirmation") {
    return validateAwaitingConfirmationExpenseDraft(input);
  }
  return { ok: false, code: "invalid_phase" };
}
