// C1 — Contrato semântico puro e desconectado do handoff `conversation`.
// Não classifica mensagens, não autoriza, não executa e não produz efeitos.

export const CONVERSATION_HANDOFF_CONTRACT_VERSION = "conversation.v1" as const;

export type ConversationHandoffContractVersion = typeof CONVERSATION_HANDOFF_CONTRACT_VERSION;

export type ConversationSegmentKind = "primary" | "supplemental";

export type ConversationHandoffCommandV1 = Readonly<{
  version: ConversationHandoffContractVersion;
  kind: "conversation";
  segment: ConversationSegmentKind;
  contactId: string;
  userId: string;
  vehicleId: string | null;
  sourceMessageId: string;
  originalText: string;
}>;

export type ConversationBlockReason = "authorization_required" | "vehicle_required";

export type ConversationTransientFailureReason = "temporarily_unavailable";

export type ConversationPermanentFailureReason = "invalid_request" | "unsupported_request";

export type ConversationExecutionSuccess = Readonly<{
  status: "success";
  responseText: string;
}>;

export type ConversationExecutionBlocked = Readonly<{
  status: "blocked";
  reason: ConversationBlockReason;
}>;

export type ConversationExecutionTransientFailure = Readonly<{
  status: "transient_failure";
  reason: ConversationTransientFailureReason;
}>;

export type ConversationExecutionPermanentFailure = Readonly<{
  status: "permanent_failure";
  reason: ConversationPermanentFailureReason;
}>;

export type ConversationExecutionResult =
  | ConversationExecutionSuccess
  | ConversationExecutionBlocked
  | ConversationExecutionTransientFailure
  | ConversationExecutionPermanentFailure;

export type ConversationHandoffValidationErrorCode =
  | "not_an_object"
  | "unexpected_field"
  | "missing_field"
  | "invalid_version"
  | "invalid_kind"
  | "invalid_segment"
  | "invalid_contact_id"
  | "invalid_user_id"
  | "invalid_vehicle_id"
  | "invalid_source_message_id"
  | "invalid_original_text";

export type ConversationExecutionResultValidationErrorCode =
  | "not_an_object"
  | "unexpected_field"
  | "missing_field"
  | "invalid_status"
  | "invalid_response_text"
  | "invalid_reason";

export type ConversationValidationResult<T, E extends string> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: E }>;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const COMMAND_KEYS = [
  "version",
  "kind",
  "segment",
  "contactId",
  "userId",
  "vehicleId",
  "sourceMessageId",
  "originalText",
] as const;

const SUCCESS_KEYS = ["status", "responseText"] as const;
const NON_SUCCESS_KEYS = ["status", "reason"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && allowedKeys.includes(key),
  );
}

function hasAllKeys(value: Record<string, unknown>, requiredKeys: readonly string[]): boolean {
  return requiredKeys.every((key) => hasOwn(value, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function hasUsefulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateConversationHandoffCommandV1(
  input: unknown,
): ConversationValidationResult<
  ConversationHandoffCommandV1,
  ConversationHandoffValidationErrorCode
> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };
  if (!hasOnlyKeys(input, COMMAND_KEYS)) return { ok: false, code: "unexpected_field" };
  if (!hasAllKeys(input, COMMAND_KEYS)) return { ok: false, code: "missing_field" };

  if (input.version !== CONVERSATION_HANDOFF_CONTRACT_VERSION) {
    return { ok: false, code: "invalid_version" };
  }
  if (input.kind !== "conversation") return { ok: false, code: "invalid_kind" };
  if (input.segment !== "primary" && input.segment !== "supplemental") {
    return { ok: false, code: "invalid_segment" };
  }
  if (!isUuid(input.contactId)) return { ok: false, code: "invalid_contact_id" };
  if (!isUuid(input.userId)) return { ok: false, code: "invalid_user_id" };
  if (input.vehicleId !== null && !isUuid(input.vehicleId)) {
    return { ok: false, code: "invalid_vehicle_id" };
  }
  if (!isUuid(input.sourceMessageId)) {
    return { ok: false, code: "invalid_source_message_id" };
  }
  if (!hasUsefulText(input.originalText)) {
    return { ok: false, code: "invalid_original_text" };
  }

  return {
    ok: true,
    value: {
      version: input.version,
      kind: input.kind,
      segment: input.segment,
      contactId: input.contactId,
      userId: input.userId,
      vehicleId: input.vehicleId,
      sourceMessageId: input.sourceMessageId,
      originalText: input.originalText,
    },
  };
}

export function validateConversationExecutionResult(
  input: unknown,
): ConversationValidationResult<
  ConversationExecutionResult,
  ConversationExecutionResultValidationErrorCode
> {
  if (!isPlainObject(input)) return { ok: false, code: "not_an_object" };

  if (input.status === "success") {
    if (!hasOnlyKeys(input, SUCCESS_KEYS)) return { ok: false, code: "unexpected_field" };
    if (!hasAllKeys(input, SUCCESS_KEYS)) return { ok: false, code: "missing_field" };
    if (!hasUsefulText(input.responseText)) {
      return { ok: false, code: "invalid_response_text" };
    }
    return { ok: true, value: { status: "success", responseText: input.responseText } };
  }

  if (
    input.status !== "blocked" &&
    input.status !== "transient_failure" &&
    input.status !== "permanent_failure"
  ) {
    return { ok: false, code: "invalid_status" };
  }
  if (!hasOnlyKeys(input, NON_SUCCESS_KEYS)) {
    return { ok: false, code: "unexpected_field" };
  }
  if (!hasAllKeys(input, NON_SUCCESS_KEYS)) return { ok: false, code: "missing_field" };

  if (input.status === "blocked") {
    if (input.reason !== "authorization_required" && input.reason !== "vehicle_required") {
      return { ok: false, code: "invalid_reason" };
    }
    return { ok: true, value: { status: "blocked", reason: input.reason } };
  }

  if (input.status === "transient_failure") {
    if (input.reason !== "temporarily_unavailable") {
      return { ok: false, code: "invalid_reason" };
    }
    return { ok: true, value: { status: "transient_failure", reason: input.reason } };
  }

  if (input.reason !== "invalid_request" && input.reason !== "unsupported_request") {
    return { ok: false, code: "invalid_reason" };
  }
  return { ok: true, value: { status: "permanent_failure", reason: input.reason } };
}
