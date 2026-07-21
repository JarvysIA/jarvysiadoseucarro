import {
  type CollectingMaintenanceExpenseDraft,
  type ExpenseDraftValidationErrorCode,
  validateCollectingMaintenanceExpenseDraft,
} from "./expense-create-draft.ts";
import {
  parseExpenseValorBareNumber,
  parseExpenseValorText,
  type ExpenseValorParseErrorCode,
} from "./expense-create-parser.ts";
import {
  dedupeMaintenanceItemKeys,
  isMaintenanceItemKey,
  MAINTENANCE_ITEM_LABEL,
  maintenanceItemKeysFromParseResult,
  parseMaintenanceItemsText,
  recognizedTagsFromMaintenanceItemKeys,
  type MaintenanceItemKey,
  type MaintenanceTriggerTag,
} from "./expense-maintenance-items-parser.ts";
import type { ConversationAwaitingField } from "./types.ts";

export type MaintenanceClarificationField = ConversationAwaitingField;

export type MaintenanceValueResponseResult =
  | { readonly ok: true; readonly valor: number }
  | {
      readonly ok: false;
      readonly code: ExpenseValorParseErrorCode | "wrong_context" | "km_mention";
    };

const NEGATIVE_AMOUNT_RE = /(?:^|\s)-\s*(?:r\$\s*)?\d|r\$\s*-\s*\d/i;
const KM_MENTION_RE = /\b(?:km|quilometr(?:o|agem))\b/i;
const EXPLICIT_MONEY_RE = /(?:r\$|\breais?\b)/i;
const TECHNICAL_VALUE_CONTEXT_RE =
  /\b(?:rodei|rodou)\s+\d|\b(?:revisao\s+(?:de|dos?)|marco\s+de)\s+\d|\btroquei\s+(?:aos?|com)\s+\d|\bmotor\s+\d+(?:[.,]\d+)?\b|\b\d+\s*w\s*\d+\b/i;
const AMOUNT_TEXT = "(?:[0-9]{1,3}(?:\\.[0-9]{3})+|[0-9]+)(?:,[0-9]{1,2})?";
const ISOLATED_AMOUNT_RE = new RegExp(`^\\s*${AMOUNT_TEXT}\\s*[.!?]?\\s*$`);
const ALLOWED_VALUE_PHRASE_RE = new RegExp(
  `^\\s*(?:(?:o\\s+valor\\s+)?(?:foi|ficou|custou|deu)|gastei|paguei)\\s+${AMOUNT_TEXT}\\s*[.!?]?\\s*$`,
  "i",
);

function normalizeForContextCheck(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseAllowedMaintenanceAmount(input: string): MaintenanceValueResponseResult {
  const marked = parseExpenseValorText(input);
  if (marked.ok || (marked.code !== "no_valor_candidate" && marked.code !== "empty_text")) {
    return marked;
  }
  return parseExpenseValorBareNumber(input);
}

export function parseMaintenanceValueResponse(
  input: unknown,
  context: MaintenanceClarificationField,
): MaintenanceValueResponseResult {
  if (context !== "maintenance_value") return { ok: false, code: "wrong_context" };
  if (typeof input !== "string") return parseExpenseValorText(input);
  if (KM_MENTION_RE.test(input)) {
    return { ok: false, code: "km_mention" };
  }
  if (NEGATIVE_AMOUNT_RE.test(input)) {
    return { ok: false, code: "valor_out_of_range" };
  }
  const normalized = normalizeForContextCheck(input);
  if (EXPLICIT_MONEY_RE.test(normalized)) {
    return parseAllowedMaintenanceAmount(input);
  }
  if (/\bmil\b/.test(normalized) || TECHNICAL_VALUE_CONTEXT_RE.test(normalized)) {
    return { ok: false, code: "no_valor_candidate" };
  }
  if (!ISOLATED_AMOUNT_RE.test(normalized) && !ALLOWED_VALUE_PHRASE_RE.test(normalized)) {
    return { ok: false, code: "no_valor_candidate" };
  }
  return parseAllowedMaintenanceAmount(input);
}

export type MaintenanceItemsResponseResult = {
  readonly status: "recognized" | "needs_clarification";
  readonly itemKeys: ReadonlyArray<MaintenanceItemKey>;
  readonly recognizedTags: ReadonlyArray<MaintenanceTriggerTag>;
  readonly descricaoPreliminar?: string;
  readonly ambiguousFilterMention: boolean;
};

function normalizedDescription(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  return trimmed.slice(0, 500);
}

export function parseMaintenanceItemsResponse(
  input: unknown,
  context: MaintenanceClarificationField,
): MaintenanceItemsResponseResult {
  if (context !== "maintenance_items" || typeof input !== "string") {
    return {
      status: "needs_clarification",
      itemKeys: [],
      recognizedTags: [],
      ambiguousFilterMention: false,
    };
  }
  const parsed = parseMaintenanceItemsText(input);
  const itemKeys = maintenanceItemKeysFromParseResult(parsed);
  return {
    status: itemKeys.length > 0 ? "recognized" : "needs_clarification",
    itemKeys,
    recognizedTags: recognizedTagsFromMaintenanceItemKeys(itemKeys),
    ...(normalizedDescription(input) !== undefined
      ? { descricaoPreliminar: normalizedDescription(input) }
      : {}),
    ambiguousFilterMention: parsed.ambiguousFilterMention,
  };
}

const FILTER_RESPONSE_PATTERNS: ReadonlyArray<{
  readonly itemKey: MaintenanceItemKey;
  readonly patterns: ReadonlyArray<RegExp>;
}> = [
  {
    itemKey: "filtro_oleo",
    patterns: [/^(?:era\s+)?(?:so\s+)?(?:o\s+)?filtro\s+(?:de|do)\s+oleo$/],
  },
  {
    itemKey: "filtro_ar_motor",
    patterns: [
      /^(?:era\s+)?(?:so\s+)?(?:o\s+)?filtro\s+(?:de|do)\s+ar$/,
      /^(?:era\s+)?(?:so\s+)?o\s+(?:de|do)\s+ar$/,
    ],
  },
  {
    itemKey: "filtro_cabine",
    patterns: [
      /^(?:era\s+)?(?:so\s+)?(?:o\s+)?filtro\s+(?:de|da)\s+cabine$/,
      /^(?:era\s+)?(?:so\s+)?(?:o\s+)?filtro\s+(?:do\s+)?ar\s+condicionado$/,
    ],
  },
  {
    itemKey: "filtro_combustivel",
    patterns: [
      /^(?:era\s+)?(?:so\s+)?(?:o\s+)?filtro\s+(?:de|do)\s+combustivel$/,
      /^(?:era\s+)?(?:so\s+)?(?:o\s+)?filtro\s+(?:de|da)\s+gasolina$/,
    ],
  },
];

function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type MaintenanceFilterResponseResult =
  | {
      readonly status: "resolved";
      readonly itemKey: MaintenanceItemKey;
      readonly itemKeys: ReadonlyArray<MaintenanceItemKey>;
      readonly recognizedTags: ReadonlyArray<MaintenanceTriggerTag>;
      readonly ambiguousFilterMention: false;
    }
  | {
      readonly status: "inconclusive";
      readonly itemKeys: ReadonlyArray<MaintenanceItemKey>;
      readonly recognizedTags: ReadonlyArray<MaintenanceTriggerTag>;
      readonly ambiguousFilterMention: true;
    };

export function parseMaintenanceFilterResponse(
  input: unknown,
  currentItemKeys: ReadonlyArray<MaintenanceItemKey>,
  context: MaintenanceClarificationField,
): MaintenanceFilterResponseResult {
  const previous = dedupeMaintenanceItemKeys(currentItemKeys);
  if (context === "maintenance_filter" && typeof input === "string") {
    const normalized = normalizeText(input);
    for (const candidate of FILTER_RESPONSE_PATTERNS) {
      if (candidate.patterns.some((pattern) => pattern.test(normalized))) {
        const itemKeys = dedupeMaintenanceItemKeys([...previous, candidate.itemKey]);
        return {
          status: "resolved",
          itemKey: candidate.itemKey,
          itemKeys,
          recognizedTags: recognizedTagsFromMaintenanceItemKeys(itemKeys),
          ambiguousFilterMention: false,
        };
      }
    }
  }
  return {
    status: "inconclusive",
    itemKeys: previous,
    recognizedTags: recognizedTagsFromMaintenanceItemKeys(previous),
    ambiguousFilterMention: true,
  };
}

export type MaintenanceDraftPatch = Readonly<{
  valor?: number | null;
  vehicleId?: string | null;
  maintenanceItemKeys?: ReadonlyArray<MaintenanceItemKey>;
  descricaoPreliminar?: string | null;
  ambiguousFilterMention?: boolean;
}>;

export type MergeMaintenanceDraftResult =
  | { readonly ok: true; readonly value: CollectingMaintenanceExpenseDraft }
  | {
      readonly ok: false;
      readonly code: ExpenseDraftValidationErrorCode | "invalid_patch";
    };

const PATCH_KEYS: ReadonlySet<string> = new Set([
  "valor",
  "vehicleId",
  "maintenanceItemKeys",
  "descricaoPreliminar",
  "ambiguousFilterMention",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function mergeCollectingMaintenanceDraft(
  current: CollectingMaintenanceExpenseDraft,
  patch: unknown,
): MergeMaintenanceDraftResult {
  const validCurrent = validateCollectingMaintenanceExpenseDraft(current);
  if (!validCurrent.ok) return validCurrent;
  if (!isPlainObject(patch) || Object.keys(patch).some((key) => !PATCH_KEYS.has(key))) {
    return { ok: false, code: "invalid_patch" };
  }

  const candidate: Record<string, unknown> = { ...validCurrent.value };
  for (const optionalKey of ["valor", "vehicleId", "descricaoPreliminar"] as const) {
    if (!hasOwn(patch, optionalKey)) continue;
    if (patch[optionalKey] === null) delete candidate[optionalKey];
    else candidate[optionalKey] = patch[optionalKey];
  }
  if (hasOwn(patch, "maintenanceItemKeys")) {
    if (
      !Array.isArray(patch.maintenanceItemKeys) ||
      !patch.maintenanceItemKeys.every(isMaintenanceItemKey)
    ) {
      return { ok: false, code: "invalid_maintenance_item_keys" };
    }
    if (new Set(patch.maintenanceItemKeys).size !== patch.maintenanceItemKeys.length) {
      return { ok: false, code: "duplicate_maintenance_item_keys" };
    }
    const itemKeys = [...patch.maintenanceItemKeys];
    candidate.maintenanceItemKeys = itemKeys;
    candidate.recognizedTags = recognizedTagsFromMaintenanceItemKeys(itemKeys);
  }
  if (hasOwn(patch, "ambiguousFilterMention")) {
    candidate.ambiguousFilterMention = patch.ambiguousFilterMention;
  }
  return validateCollectingMaintenanceExpenseDraft(candidate);
}

export type MaintenanceConversationRepresentation = {
  readonly descricao: string | null;
  readonly itemLabels: ReadonlyArray<string>;
  readonly recognizedTags: ReadonlyArray<MaintenanceTriggerTag>;
};

export function deriveMaintenanceConversationRepresentation(
  input: Readonly<{
    descricaoPreliminar?: string;
    maintenanceItemKeys: ReadonlyArray<MaintenanceItemKey>;
    recognizedTags: ReadonlyArray<MaintenanceTriggerTag>;
  }>,
): MaintenanceConversationRepresentation {
  const itemKeys = dedupeMaintenanceItemKeys(input.maintenanceItemKeys);
  const itemLabels = itemKeys.map((key) => MAINTENANCE_ITEM_LABEL[key]);
  const derived = recognizedTagsFromMaintenanceItemKeys(itemKeys);
  const preliminary = normalizedDescription(input.descricaoPreliminar);
  return {
    descricao: preliminary ?? (itemLabels.length > 0 ? itemLabels.join(", ") : null),
    itemLabels,
    recognizedTags: derived,
  };
}

export type MaintenanceItemCorrectionOperation = "replace_all" | "add" | "remove";

export type MaintenanceItemCorrectionResult =
  | {
      readonly status: "recognized";
      readonly operation: MaintenanceItemCorrectionOperation;
      readonly itemKeys: ReadonlyArray<MaintenanceItemKey>;
      readonly recognizedTags: ReadonlyArray<MaintenanceTriggerTag>;
    }
  | { readonly status: "inconclusive"; readonly code: "ambiguous" | "no_items" }
  | {
      readonly status: "not_applicable";
      readonly operation: "remove";
      readonly itemKeys: ReadonlyArray<MaintenanceItemKey>;
      readonly code: "item_not_present";
    };

export function parseMaintenanceItemCorrection(
  input: unknown,
  currentItemKeys: ReadonlyArray<MaintenanceItemKey>,
): MaintenanceItemCorrectionResult {
  if (typeof input !== "string") return { status: "inconclusive", code: "no_items" };
  const normalized = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  let operation: MaintenanceItemCorrectionOperation | null = null;
  if (/^(?:foi|era)\s+so\b/.test(normalized)) operation = "replace_all";
  else if (/^na verdade,\s*(?:foi|era)\s+so\b/.test(normalized)) {
    operation = "replace_all";
  } else if (/^nao(?:,|\.(?!\.))\s*(?:foi|era)\s+so\b/.test(normalized)) {
    operation = "replace_all";
  } else if (/^(?:adiciona|adicione|inclui|inclua)\b/.test(normalized)) operation = "add";
  else if (/^(?:tira|retira|remove|remova)\b/.test(normalized)) operation = "remove";
  if (operation === null) return { status: "inconclusive", code: "ambiguous" };

  const parsed = parseMaintenanceItemsText(input);
  const itemKeys = maintenanceItemKeysFromParseResult(parsed);
  if (parsed.ambiguousFilterMention || itemKeys.length === 0) {
    return { status: "inconclusive", code: itemKeys.length === 0 ? "no_items" : "ambiguous" };
  }
  if (operation === "remove") {
    const current = new Set(currentItemKeys);
    if (itemKeys.some((key) => !current.has(key))) {
      return { status: "not_applicable", operation, itemKeys, code: "item_not_present" };
    }
  }
  return {
    status: "recognized",
    operation,
    itemKeys,
    recognizedTags: recognizedTagsFromMaintenanceItemKeys(itemKeys),
  };
}
