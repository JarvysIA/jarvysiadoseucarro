// C2A — Contrato de execução agregado (primary + supplemental) do handoff
// `conversation`. Compõe e valida um par de comandos C1 (../contract.ts) e o
// resultado agregado correspondente. Não classifica mensagens, não autoriza,
// não executa, não chama IA, não acessa rede/banco/filesystem e não produz
// efeitos — só valida snapshots contra as regras já definidas no C1.

import {
  validateConversationExecutionResult,
  validateConversationHandoffCommandV1,
  type ConversationExecutionResult,
  type ConversationHandoffCommandV1,
  type ConversationValidationResult,
} from "./contract.ts";

export type ConversationHandoffPrimaryCommandV1 = Readonly<
  ConversationHandoffCommandV1 & { segment: "primary" }
>;

export type ConversationHandoffSupplementalCommandV1 = Readonly<
  ConversationHandoffCommandV1 & { segment: "supplemental" }
>;

export type ConversationHandoffExecutionCommandV1 = Readonly<{
  primary: ConversationHandoffPrimaryCommandV1;
  supplemental?: ConversationHandoffSupplementalCommandV1;
}>;

export type ConversationHandoffUncertainReasonV1 = "exception_thrown" | "invalid_result";

// Um outcome "*_uncertain" registra apenas que o resultado real do C1 não pôde
// ser observado (exceção ou retorno inválido) — nunca que nenhum efeito
// ocorreu. A ausência de prova de execução não é prova de ausência de execução.
export type ConversationHandoffPrimarySucceededExecutionResultV1 = Readonly<{
  status: "primary_succeeded";
  command: ConversationHandoffExecutionCommandV1;
  primaryResult: Extract<ConversationExecutionResult, { status: "success" }>;
}>;

export type ConversationHandoffPrimaryFailedExecutionResultV1 = Readonly<{
  status: "primary_failed";
  command: ConversationHandoffExecutionCommandV1;
  primaryResult: Exclude<ConversationExecutionResult, { status: "success" }>;
}>;

export type ConversationHandoffCompletedExecutionResultV1 = Readonly<{
  status: "completed";
  command: ConversationHandoffExecutionCommandV1;
  primaryResult: Extract<ConversationExecutionResult, { status: "success" }>;
  supplementalResult: Extract<ConversationExecutionResult, { status: "success" }>;
}>;

export type ConversationHandoffPartiallyCompletedExecutionResultV1 = Readonly<{
  status: "partially_completed";
  command: ConversationHandoffExecutionCommandV1;
  primaryResult: Extract<ConversationExecutionResult, { status: "success" }>;
  supplementalResult: Exclude<ConversationExecutionResult, { status: "success" }>;
}>;

export type ConversationHandoffPrimaryOutcomeUncertainExecutionResultV1 = Readonly<{
  status: "primary_outcome_uncertain";
  command: ConversationHandoffExecutionCommandV1;
  reason: ConversationHandoffUncertainReasonV1;
}>;

export type ConversationHandoffSupplementalOutcomeUncertainExecutionResultV1 = Readonly<{
  status: "supplemental_outcome_uncertain";
  command: ConversationHandoffExecutionCommandV1;
  primaryResult: Extract<ConversationExecutionResult, { status: "success" }>;
  reason: ConversationHandoffUncertainReasonV1;
}>;

export type ConversationHandoffExecutionResultV1 =
  | ConversationHandoffPrimarySucceededExecutionResultV1
  | ConversationHandoffPrimaryFailedExecutionResultV1
  | ConversationHandoffCompletedExecutionResultV1
  | ConversationHandoffPartiallyCompletedExecutionResultV1
  | ConversationHandoffPrimaryOutcomeUncertainExecutionResultV1
  | ConversationHandoffSupplementalOutcomeUncertainExecutionResultV1;

export type ConversationHandoffExecutionCommandValidationErrorCode =
  | "not_an_object"
  | "unexpected_field"
  | "missing_field"
  | "invalid_primary_command"
  | "invalid_supplemental_command"
  | "mismatched_contact_id"
  | "mismatched_user_id"
  | "mismatched_vehicle_id"
  | "mismatched_source_message_id"
  | "mismatched_original_text";

export type ConversationHandoffExecutionResultValidationErrorCode =
  | "not_an_object"
  | "unexpected_field"
  | "missing_field"
  | "invalid_status"
  | "invalid_command"
  | "invalid_primary_result"
  | "invalid_supplemental_result"
  | "invalid_uncertain_reason"
  | "invalid_execution_state";

type PlainObjectSnapshot = Readonly<{
  keys: readonly PropertyKey[];
  descriptors: ReadonlyMap<PropertyKey, PropertyDescriptor>;
}>;

// Introspecção defensiva: nunca lê uma propriedade diretamente (o que
// disparia um getter hostil) antes de a chave ter passado por uma allowlist.
// Qualquer trap de Proxy (ownKeys, getOwnPropertyDescriptor, getPrototypeOf)
// que lance é tratada como "não é um objeto inspecionável".
function trySnapshotPlainObject(value: unknown): PlainObjectSnapshot | undefined {
  if (value === null || typeof value !== "object") return undefined;
  try {
    if (Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;

    const keys = Reflect.ownKeys(value);
    const descriptors = new Map<PropertyKey, PropertyDescriptor>();
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) return undefined;
      descriptors.set(key, descriptor);
    }
    return { keys, descriptors };
  } catch {
    return undefined;
  }
}

function hasKey(snapshot: PlainObjectSnapshot, key: string): boolean {
  return snapshot.keys.includes(key);
}

function keysWithinAllowlist(snapshot: PlainObjectSnapshot, allowed: readonly string[]): boolean {
  return snapshot.keys.every((key) => typeof key === "string" && allowed.includes(key));
}

// Só expõe o lado "value" do descriptor (propriedade de dados). Uma
// propriedade de acesso (getter/setter) nunca é invocada por este módulo.
function readDataValue(snapshot: PlainObjectSnapshot, key: string): unknown {
  const descriptor = snapshot.descriptors.get(key);
  if (descriptor === undefined || !("value" in descriptor)) return undefined;
  return descriptor.value;
}

function isPrimarySegmentCommand(
  value: ConversationHandoffCommandV1,
): value is ConversationHandoffPrimaryCommandV1 {
  return value.segment === "primary";
}

function isSupplementalSegmentCommand(
  value: ConversationHandoffCommandV1,
): value is ConversationHandoffSupplementalCommandV1 {
  return value.segment === "supplemental";
}

const EXECUTION_COMMAND_ROOT_KEYS = ["primary", "supplemental"] as const;

export function validateConversationHandoffExecutionCommandV1(
  input: unknown,
): ConversationValidationResult<
  ConversationHandoffExecutionCommandV1,
  ConversationHandoffExecutionCommandValidationErrorCode
> {
  const snapshot = trySnapshotPlainObject(input);
  if (snapshot === undefined) return { ok: false, code: "not_an_object" };
  if (!keysWithinAllowlist(snapshot, EXECUTION_COMMAND_ROOT_KEYS)) {
    return { ok: false, code: "unexpected_field" };
  }
  if (!hasKey(snapshot, "primary")) return { ok: false, code: "missing_field" };

  const primaryCandidate = readDataValue(snapshot, "primary");
  let primaryValidation: ReturnType<typeof validateConversationHandoffCommandV1>;
  try {
    primaryValidation = validateConversationHandoffCommandV1(primaryCandidate);
  } catch {
    return { ok: false, code: "invalid_primary_command" };
  }
  if (!primaryValidation.ok || !isPrimarySegmentCommand(primaryValidation.value)) {
    return { ok: false, code: "invalid_primary_command" };
  }
  const primary = primaryValidation.value;

  if (!hasKey(snapshot, "supplemental")) {
    return { ok: true, value: { primary } };
  }

  const supplementalCandidate = readDataValue(snapshot, "supplemental");
  if (supplementalCandidate === undefined || supplementalCandidate === null) {
    return { ok: false, code: "invalid_supplemental_command" };
  }

  let supplementalValidation: ReturnType<typeof validateConversationHandoffCommandV1>;
  try {
    supplementalValidation = validateConversationHandoffCommandV1(supplementalCandidate);
  } catch {
    return { ok: false, code: "invalid_supplemental_command" };
  }
  if (!supplementalValidation.ok || !isSupplementalSegmentCommand(supplementalValidation.value)) {
    return { ok: false, code: "invalid_supplemental_command" };
  }
  const supplemental = supplementalValidation.value;

  if (primary.contactId !== supplemental.contactId) {
    return { ok: false, code: "mismatched_contact_id" };
  }
  if (primary.userId !== supplemental.userId) {
    return { ok: false, code: "mismatched_user_id" };
  }
  if (primary.vehicleId !== supplemental.vehicleId) {
    return { ok: false, code: "mismatched_vehicle_id" };
  }
  if (primary.sourceMessageId !== supplemental.sourceMessageId) {
    return { ok: false, code: "mismatched_source_message_id" };
  }
  if (primary.originalText !== supplemental.originalText) {
    return { ok: false, code: "mismatched_original_text" };
  }

  return { ok: true, value: { primary, supplemental } };
}

const ALL_EXECUTION_RESULT_KEYS = [
  "status",
  "command",
  "primaryResult",
  "supplementalResult",
  "reason",
] as const;

const PRIMARY_SUCCEEDED_KEYS = ["status", "command", "primaryResult"] as const;
const PRIMARY_FAILED_KEYS = ["status", "command", "primaryResult"] as const;
const COMPLETED_KEYS = ["status", "command", "primaryResult", "supplementalResult"] as const;
const PARTIALLY_COMPLETED_KEYS = COMPLETED_KEYS;
const PRIMARY_UNCERTAIN_KEYS = ["status", "command", "reason"] as const;
const SUPPLEMENTAL_UNCERTAIN_KEYS = ["status", "command", "primaryResult", "reason"] as const;

type ShapeCheckOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "missing_field" | "invalid_execution_state" }>;

function checkVariantShape(
  snapshot: PlainObjectSnapshot,
  requiredKeys: readonly string[],
): ShapeCheckOutcome {
  for (const key of requiredKeys) {
    if (!hasKey(snapshot, key)) return { ok: false, code: "missing_field" };
  }
  for (const key of ALL_EXECUTION_RESULT_KEYS) {
    if (requiredKeys.includes(key)) continue;
    if (hasKey(snapshot, key)) return { ok: false, code: "invalid_execution_state" };
  }
  return { ok: true };
}

type EmbeddedCommandOutcome =
  | Readonly<{ ok: true; value: ConversationHandoffExecutionCommandV1 }>
  | Readonly<{ ok: false; code: "invalid_command" }>;

function validateEmbeddedCommand(snapshot: PlainObjectSnapshot): EmbeddedCommandOutcome {
  const candidate = readDataValue(snapshot, "command");
  let result: ReturnType<typeof validateConversationHandoffExecutionCommandV1>;
  try {
    result = validateConversationHandoffExecutionCommandV1(candidate);
  } catch {
    return { ok: false, code: "invalid_command" };
  }
  if (!result.ok) return { ok: false, code: "invalid_command" };
  return { ok: true, value: result.value };
}

type EmbeddedResultOutcome<C extends "invalid_primary_result" | "invalid_supplemental_result"> =
  | Readonly<{ ok: true; value: ConversationExecutionResult }>
  | Readonly<{ ok: false; code: C }>;

function validateEmbeddedResult<C extends "invalid_primary_result" | "invalid_supplemental_result">(
  snapshot: PlainObjectSnapshot,
  key: "primaryResult" | "supplementalResult",
  code: C,
): EmbeddedResultOutcome<C> {
  const candidate = readDataValue(snapshot, key);
  let result: ReturnType<typeof validateConversationExecutionResult>;
  try {
    result = validateConversationExecutionResult(candidate);
  } catch {
    return { ok: false, code };
  }
  if (!result.ok) return { ok: false, code };
  return { ok: true, value: result.value };
}

function readUncertainReason(
  snapshot: PlainObjectSnapshot,
):
  | Readonly<{ ok: true; value: ConversationHandoffUncertainReasonV1 }>
  | Readonly<{ ok: false; code: "invalid_uncertain_reason" }> {
  const candidate = readDataValue(snapshot, "reason");
  if (candidate !== "exception_thrown" && candidate !== "invalid_result") {
    return { ok: false, code: "invalid_uncertain_reason" };
  }
  return { ok: true, value: candidate };
}

type ExecutionResultValidation = ConversationValidationResult<
  ConversationHandoffExecutionResultV1,
  ConversationHandoffExecutionResultValidationErrorCode
>;

function commandHasSupplemental(command: ConversationHandoffExecutionCommandV1): boolean {
  return Object.hasOwn(command, "supplemental");
}

function finishPrimarySucceeded(snapshot: PlainObjectSnapshot): ExecutionResultValidation {
  const shape = checkVariantShape(snapshot, PRIMARY_SUCCEEDED_KEYS);
  if (!shape.ok) return shape;

  const command = validateEmbeddedCommand(snapshot);
  if (!command.ok) return command;

  const primaryResult = validateEmbeddedResult(snapshot, "primaryResult", "invalid_primary_result");
  if (!primaryResult.ok) return primaryResult;
  if (primaryResult.value.status !== "success") {
    return { ok: false, code: "invalid_execution_state" };
  }

  return {
    ok: true,
    value: {
      status: "primary_succeeded",
      command: command.value,
      primaryResult: primaryResult.value,
    },
  };
}

function finishPrimaryFailed(snapshot: PlainObjectSnapshot): ExecutionResultValidation {
  const shape = checkVariantShape(snapshot, PRIMARY_FAILED_KEYS);
  if (!shape.ok) return shape;

  const command = validateEmbeddedCommand(snapshot);
  if (!command.ok) return command;

  const primaryResult = validateEmbeddedResult(snapshot, "primaryResult", "invalid_primary_result");
  if (!primaryResult.ok) return primaryResult;
  if (primaryResult.value.status === "success") {
    return { ok: false, code: "invalid_execution_state" };
  }

  return {
    ok: true,
    value: {
      status: "primary_failed",
      command: command.value,
      primaryResult: primaryResult.value,
    },
  };
}

function finishCompleted(snapshot: PlainObjectSnapshot): ExecutionResultValidation {
  const shape = checkVariantShape(snapshot, COMPLETED_KEYS);
  if (!shape.ok) return shape;

  const command = validateEmbeddedCommand(snapshot);
  if (!command.ok) return command;
  if (!commandHasSupplemental(command.value)) {
    return { ok: false, code: "invalid_execution_state" };
  }

  const primaryResult = validateEmbeddedResult(snapshot, "primaryResult", "invalid_primary_result");
  if (!primaryResult.ok) return primaryResult;
  if (primaryResult.value.status !== "success") {
    return { ok: false, code: "invalid_execution_state" };
  }

  const supplementalResult = validateEmbeddedResult(
    snapshot,
    "supplementalResult",
    "invalid_supplemental_result",
  );
  if (!supplementalResult.ok) return supplementalResult;
  if (supplementalResult.value.status !== "success") {
    return { ok: false, code: "invalid_execution_state" };
  }

  return {
    ok: true,
    value: {
      status: "completed",
      command: command.value,
      primaryResult: primaryResult.value,
      supplementalResult: supplementalResult.value,
    },
  };
}

function finishPartiallyCompleted(snapshot: PlainObjectSnapshot): ExecutionResultValidation {
  const shape = checkVariantShape(snapshot, PARTIALLY_COMPLETED_KEYS);
  if (!shape.ok) return shape;

  const command = validateEmbeddedCommand(snapshot);
  if (!command.ok) return command;
  if (!commandHasSupplemental(command.value)) {
    return { ok: false, code: "invalid_execution_state" };
  }

  const primaryResult = validateEmbeddedResult(snapshot, "primaryResult", "invalid_primary_result");
  if (!primaryResult.ok) return primaryResult;
  if (primaryResult.value.status !== "success") {
    return { ok: false, code: "invalid_execution_state" };
  }

  const supplementalResult = validateEmbeddedResult(
    snapshot,
    "supplementalResult",
    "invalid_supplemental_result",
  );
  if (!supplementalResult.ok) return supplementalResult;
  if (supplementalResult.value.status === "success") {
    return { ok: false, code: "invalid_execution_state" };
  }

  return {
    ok: true,
    value: {
      status: "partially_completed",
      command: command.value,
      primaryResult: primaryResult.value,
      supplementalResult: supplementalResult.value,
    },
  };
}

function finishPrimaryOutcomeUncertain(snapshot: PlainObjectSnapshot): ExecutionResultValidation {
  const shape = checkVariantShape(snapshot, PRIMARY_UNCERTAIN_KEYS);
  if (!shape.ok) return shape;

  const command = validateEmbeddedCommand(snapshot);
  if (!command.ok) return command;

  const reason = readUncertainReason(snapshot);
  if (!reason.ok) return reason;

  return {
    ok: true,
    value: {
      status: "primary_outcome_uncertain",
      command: command.value,
      reason: reason.value,
    },
  };
}

function finishSupplementalOutcomeUncertain(
  snapshot: PlainObjectSnapshot,
): ExecutionResultValidation {
  const shape = checkVariantShape(snapshot, SUPPLEMENTAL_UNCERTAIN_KEYS);
  if (!shape.ok) return shape;

  const command = validateEmbeddedCommand(snapshot);
  if (!command.ok) return command;
  if (!commandHasSupplemental(command.value)) {
    return { ok: false, code: "invalid_execution_state" };
  }

  const primaryResult = validateEmbeddedResult(snapshot, "primaryResult", "invalid_primary_result");
  if (!primaryResult.ok) return primaryResult;
  if (primaryResult.value.status !== "success") {
    return { ok: false, code: "invalid_execution_state" };
  }

  const reason = readUncertainReason(snapshot);
  if (!reason.ok) return reason;

  return {
    ok: true,
    value: {
      status: "supplemental_outcome_uncertain",
      command: command.value,
      primaryResult: primaryResult.value,
      reason: reason.value,
    },
  };
}

export function validateConversationHandoffExecutionResultV1(
  input: unknown,
): ExecutionResultValidation {
  const snapshot = trySnapshotPlainObject(input);
  if (snapshot === undefined) return { ok: false, code: "not_an_object" };
  if (!keysWithinAllowlist(snapshot, ALL_EXECUTION_RESULT_KEYS)) {
    return { ok: false, code: "unexpected_field" };
  }
  if (!hasKey(snapshot, "status")) return { ok: false, code: "missing_field" };

  const status = readDataValue(snapshot, "status");
  switch (status) {
    case "primary_succeeded":
      return finishPrimarySucceeded(snapshot);
    case "primary_failed":
      return finishPrimaryFailed(snapshot);
    case "completed":
      return finishCompleted(snapshot);
    case "partially_completed":
      return finishPartiallyCompleted(snapshot);
    case "primary_outcome_uncertain":
      return finishPrimaryOutcomeUncertain(snapshot);
    case "supplemental_outcome_uncertain":
      return finishSupplementalOutcomeUncertain(snapshot);
    default:
      return { ok: false, code: "invalid_status" };
  }
}
