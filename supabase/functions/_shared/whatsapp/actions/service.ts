// Build 5.7F2E1A — Serviço puro e desconectado de atualização confirmada de KM.
// TypeScript puro e desconectado. Executor chamado no máximo uma vez.
// Qualquer exception lançada pela porta -> outcome_unknown.

import {
  KM_MAX_VALUE,
  KM_UPDATE_ACTION_TYPE,
  type ConfirmedKmUpdateDeps,
  type ConfirmedKmUpdateInput,
  type ConfirmedKmUpdateLogFields,
  type ConfirmedKmUpdateLogger,
  type ConfirmedKmUpdateResult,
  type KmUpdateExecutionCommand,
  type KmUpdateExecutorResult,
  type MalformedReason,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers de validação (puros)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isInt32InRange(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function isValidKm(value: unknown): value is number {
  return isInt32InRange(value, 0, KM_MAX_VALUE);
}

function isValidExpectedPreviousKm(value: unknown): value is number | null {
  return value === null || isValidKm(value);
}

function isValidStateVersion(value: unknown): value is number {
  return isInt32InRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function readCorrectionReason(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false };
  }
  return { ok: true, value: raw };
}

// Build 6c/9 do item 6 — leitura defensiva do campo opcional
// linkedDespesaId, no mesmo padrão de readCorrectionReason: ausente
// (undefined/null) é válido (nada a transportar); string vazia é inválida
// (malformed) — evita gravar um vínculo "vazio" por engano.
function readLinkedDespesaId(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false };
  }
  return { ok: true, value: raw };
}

type ValidationOutcome =
  | { ok: true }
  | { ok: false; reason: MalformedReason };

function validateInput(input: ConfirmedKmUpdateInput): ValidationOutcome {
  const requiredIds: Array<keyof ConfirmedKmUpdateInput> = [
    "draftId",
    "conversationStateId",
    "confirmationMessageId",
    "sourceMessageId",
    "queueItemId",
    "userId",
    "contactId",
    "vehicleId",
    "orchestratorVersion",
  ];
  for (const key of requiredIds) {
    if (!isNonEmptyString(input[key])) {
      return { ok: false, reason: "input_invalid" };
    }
  }

  if (typeof input.correctionConfirmed !== "boolean") {
    return { ok: false, reason: "input_invalid" };
  }

  if (!isValidStateVersion(input.expectedStateVersion)) {
    return { ok: false, reason: "state_version_invalid" };
  }

  if (!isValidExpectedPreviousKm(input.expectedPreviousKm)) {
    return { ok: false, reason: "km_invalid" };
  }

  if (!isValidKm(input.newKm)) {
    return { ok: false, reason: "km_invalid" };
  }

  const reason = readCorrectionReason(input.correctionReason);
  if (!reason.ok) {
    return { ok: false, reason: "correction_reason_invalid" };
  }

  const linkedDespesaId = readLinkedDespesaId(input.linkedDespesaId);
  if (!linkedDespesaId.ok) {
    return { ok: false, reason: "linked_despesa_id_invalid" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Logger seguro
// ---------------------------------------------------------------------------

function safeLog(
  logger: ConfirmedKmUpdateLogger | undefined,
  fields: ConfirmedKmUpdateLogFields,
): void {
  if (!logger) return;
  try {
    logger.log(fields);
  } catch {
    /* logger nunca pode afetar o fluxo */
  }
}

// ---------------------------------------------------------------------------
// Classificação segura de exceptions (sem tocar .message/.stack)
// ---------------------------------------------------------------------------

function classifyErrorCategory(err: unknown): string {
  if (err === null) return "null";
  if (err === undefined) return "undefined";
  const t = typeof err;
  if (t !== "object" && t !== "function") return t;
  const ctor = (err as { constructor?: { name?: unknown } })?.constructor;
  const name = ctor?.name;
  if (typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) {
    return name;
  }
  return "object";
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

function defaultClock(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

// ---------------------------------------------------------------------------
// Serviço público
// ---------------------------------------------------------------------------

export async function executeConfirmedKmUpdate(
  input: ConfirmedKmUpdateInput,
  deps: ConfirmedKmUpdateDeps,
): Promise<ConfirmedKmUpdateResult> {
  const clock = deps.clock ?? defaultClock;
  const startedAt = clock();

  safeLog(deps.logger, {
    event: "km_update_started",
    actionType: KM_UPDATE_ACTION_TYPE,
  });

  const validation = validateInput(input);
  if (!validation.ok) {
    safeLog(deps.logger, {
      event: "km_update_validation_failed",
      actionType: KM_UPDATE_ACTION_TYPE,
      reasonCode: validation.reason,
      durationMs: clock() - startedAt,
    });
    return { kind: "malformed", reason: validation.reason };
  }

  const expectedPreviousKm = input.expectedPreviousKm;
  const newKm = input.newKm;
  const isCorrection =
    expectedPreviousKm !== null && newKm < expectedPreviousKm;

  if (isCorrection && !input.correctionConfirmed) {
    safeLog(deps.logger, {
      event: "km_update_rejected",
      actionType: KM_UPDATE_ACTION_TYPE,
      reasonCode: "correction_not_confirmed",
      isCorrection: true,
      durationMs: clock() - startedAt,
    });
    return { kind: "rejected", reason: "correction_not_confirmed" };
  }

  const correctionReasonNormalized = readCorrectionReason(input.correctionReason);
  const correctionReason =
    correctionReasonNormalized.ok ? correctionReasonNormalized.value : null;

  const command: KmUpdateExecutionCommand = {
    actionType: KM_UPDATE_ACTION_TYPE,
    draftId: input.draftId,
    conversationStateId: input.conversationStateId,
    confirmationMessageId: input.confirmationMessageId,
    sourceMessageId: input.sourceMessageId,
    queueItemId: input.queueItemId,
    userId: input.userId,
    contactId: input.contactId,
    vehicleId: input.vehicleId,
    expectedPreviousKm,
    newKm,
    isCorrection,
    correctionConfirmed: input.correctionConfirmed,
    correctionReason,
    expectedStateVersion: input.expectedStateVersion,
    orchestratorVersion: input.orchestratorVersion,
  };

  safeLog(deps.logger, {
    event: "km_update_dispatched",
    actionType: KM_UPDATE_ACTION_TYPE,
    isCorrection,
  });

  let executorResult: KmUpdateExecutorResult;
  try {
    executorResult = await deps.executor.executeKmUpdate(command);
  } catch (err) {
    const category = classifyErrorCategory(err);
    safeLog(deps.logger, {
      event: "km_update_outcome_unknown",
      actionType: KM_UPDATE_ACTION_TYPE,
      reasonCode: category,
      isCorrection,
      durationMs: clock() - startedAt,
    });
    return { kind: "outcome_unknown", errorCategory: category };
  }

  const durationMs = clock() - startedAt;

  switch (executorResult.kind) {
    case "applied": {
      safeLog(deps.logger, {
        event: "km_update_completed",
        actionType: KM_UPDATE_ACTION_TYPE,
        outcome: "completed",
        isCorrection,
        durationMs,
      });
      return {
        kind: "completed",
        actionExecutionId: executorResult.actionExecutionId,
        previousKm: executorResult.previousKm,
        newKm: executorResult.newKm,
      };
    }
    case "replayed": {
      safeLog(deps.logger, {
        event: "km_update_replayed",
        actionType: KM_UPDATE_ACTION_TYPE,
        outcome: "replayed",
        isCorrection,
        durationMs,
      });
      return {
        kind: "replayed",
        actionExecutionId: executorResult.actionExecutionId,
        previousKm: executorResult.previousKm,
        newKm: executorResult.newKm,
        noChange: executorResult.noChange,
      };
    }
    case "no_op": {
      safeLog(deps.logger, {
        event: "km_update_no_op",
        actionType: KM_UPDATE_ACTION_TYPE,
        outcome: "no_op",
        isCorrection,
        durationMs,
      });
      return {
        kind: "no_op",
        actionExecutionId: executorResult.actionExecutionId,
        currentKm: executorResult.currentKm,
      };
    }
    case "rejected": {
      safeLog(deps.logger, {
        event: "km_update_rejected",
        actionType: KM_UPDATE_ACTION_TYPE,
        outcome: "rejected",
        reasonCode: executorResult.reason,
        isCorrection,
        durationMs,
      });
      return { kind: "rejected", reason: executorResult.reason };
    }
    case "conflicted": {
      safeLog(deps.logger, {
        event: "km_update_conflicted",
        actionType: KM_UPDATE_ACTION_TYPE,
        outcome: "conflicted",
        reasonCode: executorResult.reason,
        isCorrection,
        durationMs,
      });
      return {
        kind: "conflicted",
        reason: executorResult.reason,
        ...(executorResult.currentKm !== undefined
          ? { currentKm: executorResult.currentKm }
          : {}),
        ...(executorResult.currentStateVersion !== undefined
          ? { currentStateVersion: executorResult.currentStateVersion }
          : {}),
      };
    }
    case "transient_error": {
      safeLog(deps.logger, {
        event: "km_update_transient_failure",
        actionType: KM_UPDATE_ACTION_TYPE,
        outcome: "transient_failure",
        reasonCode: executorResult.reason,
        isCorrection,
        durationMs,
      });
      return { kind: "transient_failure", reason: executorResult.reason };
    }
  }
}

