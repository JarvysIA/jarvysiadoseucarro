import {
  isMaintenanceItemKey,
  MAINTENANCE_ITEM_KEYS,
  MAINTENANCE_TRIGGER_TAGS,
  recognizedTagsFromMaintenanceItemKeys,
  type MaintenanceItemKey,
  type MaintenanceTriggerTag,
} from "./expense-maintenance-items-parser.ts";

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
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

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
  // Build 4c/9 do item 6 — carregado ao longo do fluxo pra a resposta final
  // poder perguntar "qual filtro?" quando aplicável.
  readonly ambiguousFilterMention?: boolean;
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
  // Build 4c/9 do item 6.
  readonly ambiguousFilterMention?: boolean;
};

export type CollectingMaintenanceExpenseDraft = {
  readonly phase: "collecting_maintenance";
  readonly categoria: "Revisão" | "Manutenção";
  readonly valor?: number;
  readonly vehicleId?: string;
  readonly requestMessageId: string;
  readonly recognizedTags: ReadonlyArray<MaintenanceTriggerTag>;
  readonly maintenanceItemKeys: ReadonlyArray<MaintenanceItemKey>;
  readonly descricaoPreliminar?: string;
  readonly ambiguousFilterMention: boolean;
};

export type ExpenseCreateDraft =
  | AwaitingCategoryExpenseDraft
  | AwaitingVehicleExpenseDraft
  | AwaitingConfirmationExpenseDraft
  | CollectingMaintenanceExpenseDraft;

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
  | "duplicate_recognized_tags"
  | "recognized_tags_mismatch"
  | "invalid_maintenance_item_keys"
  | "duplicate_maintenance_item_keys"
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

const MAINTENANCE_TAGS_SET: ReadonlySet<string> = new Set(MAINTENANCE_TRIGGER_TAGS);

// Aditivo (build 3/9 do item 6): array de 0 a 4 tags válidas, sem
// duplicatas — o parser (build 2) já garante isso na origem, mas
// validamos aqui de novo, pois o draft vem do banco, não direto do parser.
function validateRecognizedTags(
  value: unknown,
):
  | { readonly ok: true; readonly value: ReadonlyArray<MaintenanceTriggerTag> }
  | { readonly ok: false; readonly code: "invalid_recognized_tags" | "duplicate_recognized_tags" } {
  if (!Array.isArray(value) || value.length > 4) {
    return { ok: false, code: "invalid_recognized_tags" };
  }
  if (value.some((item) => typeof item !== "string" || !MAINTENANCE_TAGS_SET.has(item))) {
    return { ok: false, code: "invalid_recognized_tags" };
  }
  if (new Set(value).size !== value.length) {
    return { ok: false, code: "duplicate_recognized_tags" };
  }
  return { ok: true, value: [...value] as ReadonlyArray<MaintenanceTriggerTag> };
}

function isValidRecognizedTags(value: unknown): value is ReadonlyArray<MaintenanceTriggerTag> {
  return validateRecognizedTags(value).ok;
}

function validateMaintenanceItemKeys(value: unknown):
  | { readonly ok: true; readonly value: ReadonlyArray<MaintenanceItemKey> }
  | {
      readonly ok: false;
      readonly code: "invalid_maintenance_item_keys" | "duplicate_maintenance_item_keys";
    } {
  if (
    !Array.isArray(value) ||
    value.length > MAINTENANCE_ITEM_KEYS.length ||
    !value.every(isMaintenanceItemKey)
  ) {
    return { ok: false, code: "invalid_maintenance_item_keys" };
  }
  if (new Set(value).size !== value.length) {
    return { ok: false, code: "duplicate_maintenance_item_keys" };
  }
  return { ok: true, value: [...value] };
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

const VEHICLE_REQUIRED_KEYS = ["phase", "categoria", "valor", "requestMessageId"] as const;
const VEHICLE_OPTIONAL_KEYS = [
  "recognizedTags",
  "descricaoPreliminar",
  "ambiguousFilterMention",
] as const;
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
const CONFIRMATION_OPTIONAL_KEYS = [
  "recognizedTags",
  "descricao",
  "ambiguousFilterMention",
] as const;
const CONFIRMATION_ALL_KEYS: ReadonlyArray<string> = [
  ...CONFIRMATION_REQUIRED_KEYS,
  ...CONFIRMATION_OPTIONAL_KEYS,
];

const COLLECTING_REQUIRED_KEYS = [
  "phase",
  "categoria",
  "requestMessageId",
  "recognizedTags",
  "maintenanceItemKeys",
  "ambiguousFilterMention",
] as const;
const COLLECTING_OPTIONAL_KEYS = ["valor", "vehicleId", "descricaoPreliminar"] as const;
const COLLECTING_ALL_KEYS: ReadonlyArray<string> = [
  ...COLLECTING_REQUIRED_KEYS,
  ...COLLECTING_OPTIONAL_KEYS,
];

export function validateCollectingMaintenanceExpenseDraft(
  input: unknown,
): ExpenseDraftValidationResult<CollectingMaintenanceExpenseDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };
  for (const key of Object.keys(input)) {
    if (!COLLECTING_ALL_KEYS.includes(key)) return { ok: false, code: "unexpected_field" };
  }
  for (const key of COLLECTING_REQUIRED_KEYS) {
    if (!hasOwn(input, key)) return { ok: false, code: "missing_field" };
  }
  if (input.phase !== "collecting_maintenance") return { ok: false, code: "invalid_phase" };
  if (input.categoria !== "Revisão" && input.categoria !== "Manutenção") {
    return { ok: false, code: "invalid_categoria" };
  }
  if (hasOwn(input, "valor") && !isValidValor(input.valor)) {
    return { ok: false, code: "invalid_valor" };
  }
  if (hasOwn(input, "vehicleId") && !isValidUuid(input.vehicleId)) {
    return { ok: false, code: "invalid_vehicle_id" };
  }
  if (!isValidUuid(input.requestMessageId)) {
    return { ok: false, code: "invalid_request_message_id" };
  }
  const recognizedTags = validateRecognizedTags(input.recognizedTags);
  if (!recognizedTags.ok) return recognizedTags;
  const maintenanceItemKeys = validateMaintenanceItemKeys(input.maintenanceItemKeys);
  if (!maintenanceItemKeys.ok) return maintenanceItemKeys;
  const expectedRecognizedTags = recognizedTagsFromMaintenanceItemKeys(maintenanceItemKeys.value);
  if (
    recognizedTags.value.length !== expectedRecognizedTags.length ||
    recognizedTags.value.some((tag, index) => tag !== expectedRecognizedTags[index])
  ) {
    return { ok: false, code: "recognized_tags_mismatch" };
  }
  if (
    hasOwn(input, "descricaoPreliminar") &&
    (typeof input.descricaoPreliminar !== "string" ||
      !isValidDescricaoField(input.descricaoPreliminar))
  ) {
    return { ok: false, code: "invalid_descricao" };
  }
  if (typeof input.ambiguousFilterMention !== "boolean") {
    return { ok: false, code: "invalid_ambiguous_filter_mention" };
  }
  return {
    ok: true,
    value: {
      phase: "collecting_maintenance",
      categoria: input.categoria,
      requestMessageId: input.requestMessageId,
      recognizedTags: expectedRecognizedTags,
      maintenanceItemKeys: maintenanceItemKeys.value,
      ambiguousFilterMention: input.ambiguousFilterMention,
      ...(hasOwn(input, "valor") ? { valor: input.valor as number } : {}),
      ...(hasOwn(input, "vehicleId") ? { vehicleId: input.vehicleId as string } : {}),
      ...(hasOwn(input, "descricaoPreliminar")
        ? { descricaoPreliminar: input.descricaoPreliminar as string }
        : {}),
    },
  };
}

export function validateAwaitingCategoryExpenseDraft(
  input: unknown,
): ExpenseDraftValidationResult<AwaitingCategoryExpenseDraft> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };

  for (const k of Object.keys(input)) {
    if (!CATEGORY_ALL_KEYS.includes(k)) {
      return { ok: false, code: "unexpected_field" };
    }
  }
  for (const k of CATEGORY_REQUIRED_KEYS) {
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

  const hasRecognizedTags = hasOwn(input, "recognizedTags");
  if (hasRecognizedTags && !isValidRecognizedTags(input.recognizedTags)) {
    return { ok: false, code: "invalid_recognized_tags" };
  }
  const hasDescricaoPreliminar = hasOwn(input, "descricaoPreliminar");
  if (hasDescricaoPreliminar && !isValidDescricaoField(input.descricaoPreliminar)) {
    return { ok: false, code: "invalid_descricao" };
  }
  const hasAmbiguousFilterMention = hasOwn(input, "ambiguousFilterMention");
  if (hasAmbiguousFilterMention && typeof input.ambiguousFilterMention !== "boolean") {
    return { ok: false, code: "invalid_ambiguous_filter_mention" };
  }

  return {
    ok: true,
    value: {
      phase: "awaiting_category",
      valor: input.valor,
      requestMessageId: input.requestMessageId,
      ...(hasRecognizedTags
        ? { recognizedTags: input.recognizedTags as ReadonlyArray<MaintenanceTriggerTag> }
        : {}),
      ...(hasDescricaoPreliminar
        ? { descricaoPreliminar: input.descricaoPreliminar as string | null }
        : {}),
      ...(hasAmbiguousFilterMention
        ? { ambiguousFilterMention: input.ambiguousFilterMention as boolean }
        : {}),
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
  const hasAmbiguousFilterMention = hasOwn(input, "ambiguousFilterMention");
  if (hasAmbiguousFilterMention && typeof input.ambiguousFilterMention !== "boolean") {
    return { ok: false, code: "invalid_ambiguous_filter_mention" };
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
      ...(hasAmbiguousFilterMention
        ? { ambiguousFilterMention: input.ambiguousFilterMention as boolean }
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
  const hasAmbiguousFilterMention = hasOwn(input, "ambiguousFilterMention");
  if (hasAmbiguousFilterMention && typeof input.ambiguousFilterMention !== "boolean") {
    return { ok: false, code: "invalid_ambiguous_filter_mention" };
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
      ...(hasAmbiguousFilterMention
        ? { ambiguousFilterMention: input.ambiguousFilterMention as boolean }
        : {}),
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
  if (phase === "collecting_maintenance") {
    return validateCollectingMaintenanceExpenseDraft(input);
  }
  return { ok: false, code: "invalid_phase" };
}
