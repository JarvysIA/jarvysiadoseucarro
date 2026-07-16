// Build expense-service-pure — Serviço puro e desconectado de criação
// confirmada de despesa. TypeScript puro. Executor chamado no máximo uma
// vez. Qualquer exception lançada pela porta -> outcome_unknown.

import {
  EXPENSE_CATEGORIES,
  EXPENSE_CREATE_ACTION_TYPE,
  EXPENSE_MAX_VALOR,
  type ConfirmedExpenseCreateDeps,
  type ConfirmedExpenseCreateInput,
  type ConfirmedExpenseCreateLogFields,
  type ConfirmedExpenseCreateLogger,
  type ConfirmedExpenseCreateResult,
  type ExpenseCategory,
  type ExpenseCreateExecutionCommand,
  type ExpenseCreateExecutorResult,
  type ExpenseMalformedReason,
} from "./expense-types.ts";

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

function isValidStateVersion(value: unknown): value is number {
  return isInt32InRange(value, 0, Number.MAX_SAFE_INTEGER);
}

const VALID_CATEGORIES: ReadonlySet<string> = new Set(EXPENSE_CATEGORIES);

function isValidCategoria(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && VALID_CATEGORIES.has(value);
}

function isValidValor(value: unknown): value is number {
  if (typeof value !== "number") return false;
  if (!Number.isFinite(value)) return false;
  if (value <= 0) return false;
  if (value > EXPENSE_MAX_VALOR) return false;
  // Rejeita fração de centavo. Comparar arredondando a 2 casas evitando
  // erros óbvios de ponto flutuante.
  return Math.round(value * 100) / 100 === value;
}

type DescricaoOutcome =
  | { ok: true; value: string | null }
  | { ok: false };

function readDescricao(raw: string | null | undefined): DescricaoOutcome {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false };
  }
  const trimmed = raw.trim();
  if (trimmed.length > 500) {
    return { ok: false };
  }
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  return { ok: true, value: trimmed };
}

type ValidationOutcome =
  | { ok: true; descricao: string | null }
  | { ok: false; reason: ExpenseMalformedReason };

function validateInput(input: ConfirmedExpenseCreateInput): ValidationOutcome {
  const requiredIds: Array<keyof ConfirmedExpenseCreateInput> = [
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

  if (!isValidStateVersion(input.expectedStateVersion)) {
    return { ok: false, reason: "state_version_invalid" };
  }

  if (!isValidCategoria(input.categoria)) {
    return { ok: false, reason: "categoria_invalid" };
  }

  if (!isValidValor(input.valor)) {
    return { ok: false, reason: "valor_invalid" };
  }

  const descricao = readDescricao(input.descricao);
  if (!descricao.ok) {
    return { ok: false, reason: "descricao_invalid" };
  }

  return { ok: true, descricao: descricao.value };
}

// ---------------------------------------------------------------------------
// Logger seguro
// ---------------------------------------------------------------------------

function safeLog(
  logger: ConfirmedExpenseCreateLogger | undefined,
  fields: ConfirmedExpenseCreateLogFields,
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

export async function executeConfirmedExpenseCreate(
  input: ConfirmedExpenseCreateInput,
  deps: ConfirmedExpenseCreateDeps,
): Promise<ConfirmedExpenseCreateResult> {
  const clock = deps.clock ?? defaultClock;
  const startedAt = clock();

  safeLog(deps.logger, {
    event: "expense_create_started",
    actionType: EXPENSE_CREATE_ACTION_TYPE,
  });

  const validation = validateInput(input);
  if (!validation.ok) {
    safeLog(deps.logger, {
      event: "expense_create_validation_failed",
      actionType: EXPENSE_CREATE_ACTION_TYPE,
      reasonCode: validation.reason,
      durationMs: clock() - startedAt,
    });
    return { kind: "malformed", reason: validation.reason };
  }

  const command: ExpenseCreateExecutionCommand = {
    actionType: EXPENSE_CREATE_ACTION_TYPE,
    draftId: input.draftId,
    conversationStateId: input.conversationStateId,
    confirmationMessageId: input.confirmationMessageId,
    sourceMessageId: input.sourceMessageId,
    queueItemId: input.queueItemId,
    userId: input.userId,
    contactId: input.contactId,
    vehicleId: input.vehicleId,
    categoria: input.categoria,
    valor: input.valor,
    descricao: validation.descricao,
    expectedStateVersion: input.expectedStateVersion,
    orchestratorVersion: input.orchestratorVersion,
  };

  safeLog(deps.logger, {
    event: "expense_create_dispatched",
    actionType: EXPENSE_CREATE_ACTION_TYPE,
  });

  let executorResult: ExpenseCreateExecutorResult;
  try {
    executorResult = await deps.executor.executeExpenseCreate(command);
  } catch (err) {
    const category = classifyErrorCategory(err);
    safeLog(deps.logger, {
      event: "expense_create_outcome_unknown",
      actionType: EXPENSE_CREATE_ACTION_TYPE,
      reasonCode: category,
      durationMs: clock() - startedAt,
    });
    return { kind: "outcome_unknown", errorCategory: category };
  }

  const durationMs = clock() - startedAt;

  switch (executorResult.kind) {
    case "applied": {
      safeLog(deps.logger, {
        event: "expense_create_completed",
        actionType: EXPENSE_CREATE_ACTION_TYPE,
        outcome: "completed",
        durationMs,
      });
      return {
        kind: "completed",
        actionExecutionId: executorResult.actionExecutionId,
        valor: executorResult.valor,
        categoria: executorResult.categoria,
      };
    }
    case "replayed": {
      safeLog(deps.logger, {
        event: "expense_create_replayed",
        actionType: EXPENSE_CREATE_ACTION_TYPE,
        outcome: "replayed",
        durationMs,
      });
      return {
        kind: "replayed",
        actionExecutionId: executorResult.actionExecutionId,
        valor: executorResult.valor,
        categoria: executorResult.categoria,
      };
    }
    case "rejected": {
      safeLog(deps.logger, {
        event: "expense_create_rejected",
        actionType: EXPENSE_CREATE_ACTION_TYPE,
        outcome: "rejected",
        reasonCode: executorResult.reason,
        durationMs,
      });
      return { kind: "rejected", reason: executorResult.reason };
    }
    case "conflicted": {
      safeLog(deps.logger, {
        event: "expense_create_conflicted",
        actionType: EXPENSE_CREATE_ACTION_TYPE,
        outcome: "conflicted",
        reasonCode: executorResult.reason,
        durationMs,
      });
      return {
        kind: "conflicted",
        reason: executorResult.reason,
        ...(executorResult.currentStateVersion !== undefined
          ? { currentStateVersion: executorResult.currentStateVersion }
          : {}),
      };
    }
    case "transient_error": {
      safeLog(deps.logger, {
        event: "expense_create_transient_failure",
        actionType: EXPENSE_CREATE_ACTION_TYPE,
        outcome: "transient_failure",
        reasonCode: executorResult.reason,
        durationMs,
      });
      return { kind: "transient_failure", reason: executorResult.reason };
    }
  }
}
