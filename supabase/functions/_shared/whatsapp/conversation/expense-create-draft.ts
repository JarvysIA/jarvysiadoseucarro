import type { MaintenanceTriggerTag } from "./expense-maintenance-items-parser.ts";

export const EXPENSE_CREATE_INITIAL_DRAFT_VERSION = 0 as const;
export const EXPENSE_CREATE_PROMOTED_ONCE_VERSION = 1 as const;
export const EXPENSE_CREATE_PROMOTED_TWICE_VERSION = 2 as const;

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

export type AwaitingCategoryExpenseDraft = {
  readonly phase: "awaiting_category";
  readonly valor: number;
  readonly requestMessageId: string;
  // Build 4c/9 do item 6 — calculado especulativamente ANTES de saber a
  // categoria (o parser de itens não depende dela). Só é efetivamente
  // aproveitado depois, se a categoria resolvida vier a ser Revisão ou
  // Manutenção — ver gateMaintenanceItemsByCategory em core.ts.
  readonly recognizedTags?: ReadonlyArray<MaintenanceTriggerTag>;
  readonly descricaoPreliminar?: string | null;
  readonly ambiguousFilterMention?: boolean;
};

export type AwaitingVehicleExpenseDraft = {
  readonly phase: "awaiting_vehicle";
  readonly categoria: ExpenseCategory;
  readonly valor: number;
  readonly requestMessageId: string;
  // Build 3/9 do item 6 — aditivo, só populado quando categoria já veio
  // como Revisão/Manutenção e o parser de itens (build 2) já rodou sobre a
  // mensagem original, antes de saber o veículo. Nenhum outro fluxo (KM,
  // despesas de outras categorias) usa esses campos.
  readonly recognizedTags?: ReadonlyArray<MaintenanceTriggerTag>;
  readonly descricaoPreliminar?: string | null;
};

export type AwaitingConfirmationExpenseDraft = {
  readonly phase: "awaiting_confirmation";
  readonly categoria: ExpenseCategory;
  readonly valor: number;
  readonly vehicleId: string;
  readonly requestMessageId: string;
  // Build 3/9 do item 6 — aditivo, mesma regra do campo acima.
  readonly recognizedTags?: ReadonlyArray<MaintenanceTriggerTag>;
  readonly descricao?: string | null;
};

export type ExpenseCreateDraft =
  | AwaitingCategoryExpenseDraft
  | AwaitingVehicleExpenseDraft
  | AwaitingConfirmationExpenseDraft;

export type ExpenseDraftValidationErrorCode =
  | "not_an_object"
  | "unexpected_field"
  | "missing_field"
  | "invalid_phase"
  | "invalid_valor"
  | "invalid_categoria"
  | "invalid_request_message_id"
  | "invalid_vehicle_id"
  | "invalid_recognized_tags"
  | "invalid_descricao"
  | "invalid_ambiguous_filter_mention";

export type ExpenseDraftValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ExpenseDraftValidationErrorCode };

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
  if (Math.round(value * 100) / 100 !== value) return false;
  return true;
}

const CATEGORIES_SET: ReadonlySet<string> = new Set(EXPENSE_CATEGORIES);

function isValidCategoria(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && CATEGORIES_SET.has(value);
}

const MAINTENANCE_TAGS_SET = new Set<string>([
  "oleo",
  "filtro",
  "pastilha",
  "arrefecimento",
]);

// Aditivo (build 3/9 do item 6): array de 0 a 4 tags válidas, sem
// duplicatas — o parser (build 2) já garante isso na origem, mas
// validamos aqui de novo, pois o draft vem do banco, não direto do parser.
function isValidRecognizedTags(
  value: unknown,
): value is ReadonlyArray<MaintenanceTriggerTag> {
  if (!Array.isArray(value)) return false;
  if (value.length > 4) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !MAINTENANCE_TAGS_SET.has(item)) return false;
    if (seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

const DESCRICAO_MAX_CHARS = 500;

// Aditivo (build 3/9 do item 6): texto livre opcional, null explícito
// significa "sem descrição ainda" — diferente de campo ausente (undefined),
// que significa "essa categoria nem usa esse conceito".
function isValidDescricaoField(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  if (value.length > DESCRICAO_MAX_CHARS) return false;
  return true;
}

const CATEGORY_REQUIRED_KEYS = ["phase", "valor", "requestMessageId"] as const;
const CATEGORY_OPTIONAL_KEYS = [
  "recognizedTags",
  "descricaoPreliminar",
  "ambiguousFilterMention",
] as const;
const CATEGORY_ALL_KEYS: ReadonlyArray<string> = [
  ...CATEGORY_REQUIRED_KEYS,
  ...CATEGORY_OPTIONAL_KEYS,
];

const VEHICLE_REQUIRED_KEYS = [
  "phase",
  "categoria",
  "valor",
  "requestMessageId",
] as const;
const VEHICLE_OPTIONAL_KEYS = ["recognizedTags", "descricaoPreliminar"] as const;
const VEHICLE_ALL_KEYS: ReadonlyArray<string> = [
  ...VEHICLE_REQUIRED_KEYS,
  ...VEHICLE_OPTIONAL_KEYS,
];

const CONFIRMATION_REQUIRED_KEYS = [
  "phase",
  "categoria",
  "valor",
  "vehicleId",
  "requestMessageId",
] as const;
const CONFIRMATION_OPTIONAL_KEYS = ["recognizedTags", "descricao"] as const;
const CONFIRMATION_ALL_KEYS: ReadonlyArray<string> = [
  ...CONFIRMATION_REQUIRED_KEYS,
  ...CONFIRMATION_OPTIONAL_KEYS,
];

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
    if (!VEHICLE_ALL_KEYS.includes(k)) {
      return { ok: false, code: "unexpected_field" };
    }
  }
  for (const k of VEHICLE_REQUIRED_KEYS) {
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

  const hasRecognizedTags = hasOwn(input, "recognizedTags");
  if (hasRecognizedTags && !isValidRecognizedTags(input.recognizedTags)) {
    return { ok: false, code: "invalid_recognized_tags" };
  }
  const hasDescricaoPreliminar = hasOwn(input, "descricaoPreliminar");
  if (hasDescricaoPreliminar && !isValidDescricaoField(input.descricaoPreliminar)) {
    return { ok: false, code: "invalid_descricao" };
  }

  return {
    ok: true,
    value: {
      phase: "awaiting_vehicle",
      categoria: input.categoria,
      valor: input.valor,
      requestMessageId: input.requestMessageId,
      ...(hasRecognizedTags
        ? { recognizedTags: input.recognizedTags as ReadonlyArray<MaintenanceTriggerTag> }
        : {}),
      ...(hasDescricaoPreliminar
        ? { descricaoPreliminar: input.descricaoPreliminar as string | null }
        : {}),
    },
  };
}

export function validateAwaitingConfirmationExpenseDraft(
  input: unknown,
): ExpenseDraftValidationResult<AwaitingConfirmationExpenseDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };

  for (const k of Object.keys(input)) {
    if (!CONFIRMATION_ALL_KEYS.includes(k)) {
      return { ok: false, code: "unexpected_field" };
    }
  }
  for (const k of CONFIRMATION_REQUIRED_KEYS) {
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

  const hasRecognizedTags = hasOwn(input, "recognizedTags");
  if (hasRecognizedTags && !isValidRecognizedTags(input.recognizedTags)) {
    return { ok: false, code: "invalid_recognized_tags" };
  }
  const hasDescricao = hasOwn(input, "descricao");
  if (hasDescricao && !isValidDescricaoField(input.descricao)) {
    return { ok: false, code: "invalid_descricao" };
  }

  return {
    ok: true,
    value: {
      phase: "awaiting_confirmation",
      categoria: input.categoria,
      valor: input.valor,
      vehicleId: input.vehicleId,
      requestMessageId: input.requestMessageId,
      ...(hasRecognizedTags
        ? { recognizedTags: input.recognizedTags as ReadonlyArray<MaintenanceTriggerTag> }
        : {}),
      ...(hasDescricao ? { descricao: input.descricao as string | null } : {}),
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
