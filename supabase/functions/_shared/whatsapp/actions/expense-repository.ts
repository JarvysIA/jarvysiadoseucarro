// Build expense-repository — Repository TS estrito para
// execute_whatsapp_expense_create. Mirror estrutural de actions/repository.ts
// (KM), adaptado ao domínio de despesa. Backend-only. Não conectado ao runtime.
// Não importa Deno, fetch, React, node:crypto.

import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseCreateConflictReason,
  type ExpenseCreateExecutionCommand,
  type ExpenseCreateExecutorPort,
  type ExpenseCreateExecutorResult,
  type ExpenseCreateRejectedReason,
} from "./expense-types.ts";

// ---------------------------------------------------------------------------
// Structural client — apenas .rpc().
// ---------------------------------------------------------------------------

export type ExpenseActionRpcError = {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type ExpenseActionRpcResponse<T> = {
  data: T | null;
  error: ExpenseActionRpcError | null;
};

export type ExpenseActionRpcInvoker = <T = unknown>(
  fn: string,
  params: Record<string, unknown>,
) => Promise<ExpenseActionRpcResponse<T>>;

export type ExpenseActionSupabaseLike = {
  rpc: ExpenseActionRpcInvoker;
};

// ---------------------------------------------------------------------------
// Erros tipados (locais deste domínio).
// ---------------------------------------------------------------------------

export class ExpenseActionTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpenseActionTransportError";
  }
}

export class ExpenseActionRpcExceptionError extends Error {
  readonly code: string | null;
  constructor(code: string | null, message: string) {
    super(message);
    this.name = "ExpenseActionRpcExceptionError";
    this.code = code;
  }
}

export class ExpenseActionMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpenseActionMalformedResponseError";
  }
}

export class ExpenseActionUnknownResultError extends Error {
  readonly value: string;
  constructor(value: string) {
    super(`unknown result: ${value}`);
    this.name = "ExpenseActionUnknownResultError";
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// Conjuntos fechados (locais).
// ---------------------------------------------------------------------------

// SEM "no_op": a RPC de despesa é INSERT puro, não existe no-op.
const KIND_SET: ReadonlySet<string> = new Set([
  "applied",
  "replayed",
  "rejected",
  "conflicted",
]);

const REJECTED_REASON_SET: ReadonlySet<ExpenseCreateRejectedReason> = new Set<
  ExpenseCreateRejectedReason
>([
  "contact_missing",
  "contact_unlinked",
  "vehicle_not_found",
  "vehicle_not_owned",
  "vehicle_archived",
  "invariant_violation",
  "categoria_invalid",
  "valor_invalid",
]);

// SEM "km_conflict" (não existe pra INSERT).
// SEM "idempotency_payload_mismatch" (existe no tipo TS mas a RPC real nunca
// emite — se um mock devolver, o parser deve subir UnknownResultError).
const CONFLICT_REASON_SET: ReadonlySet<ExpenseCreateConflictReason> = new Set<
  ExpenseCreateConflictReason
>([
  "state_version_conflict",
  "action_execution_conflict",
]);

const CATEGORY_SET: ReadonlySet<string> = new Set<string>(
  EXPENSE_CATEGORIES as ReadonlyArray<string>,
);

// ---------------------------------------------------------------------------
// Helpers de parsing.
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireSingleRow(raw: unknown): Record<string, unknown> {
  if (raw == null) {
    throw new ExpenseActionMalformedResponseError("payload nulo");
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new ExpenseActionMalformedResponseError("array vazio");
    }
    if (raw.length > 1) {
      throw new ExpenseActionMalformedResponseError(
        "múltiplas linhas quando se espera uma",
      );
    }
    const first = raw[0];
    if (!isPlainObject(first)) {
      throw new ExpenseActionMalformedResponseError("linha não é objeto");
    }
    return first;
  }
  if (!isPlainObject(raw)) {
    throw new ExpenseActionMalformedResponseError("payload não é objeto");
  }
  return raw;
}

function requireString(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ExpenseActionMalformedResponseError(
      `campo ${key} ausente ou vazio`,
    );
  }
  return v;
}

function requireUuid(row: Record<string, unknown>, key: string): string {
  return requireString(row, key);
}

function requireInteger(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new ExpenseActionMalformedResponseError(
      `campo ${key} não é inteiro`,
    );
  }
  return v;
}

function requireNumber(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ExpenseActionMalformedResponseError(
      `campo ${key} não é número finito`,
    );
  }
  return v;
}

function requireCategory(
  row: Record<string, unknown>,
  key: string,
): ExpenseCategory {
  const v = requireString(row, key);
  if (!CATEGORY_SET.has(v)) {
    throw new ExpenseActionMalformedResponseError(
      `campo ${key} fora da whitelist`,
    );
  }
  return v as ExpenseCategory;
}

// ---------------------------------------------------------------------------
// Parser principal.
// ---------------------------------------------------------------------------

export function parseExecuteExpenseCreate(
  raw: unknown,
): ExpenseCreateExecutorResult {
  const row = requireSingleRow(raw);
  const kind = requireString(row, "kind");
  if (!KIND_SET.has(kind)) throw new ExpenseActionUnknownResultError(kind);

  switch (kind) {
    case "applied":
      return {
        kind: "applied",
        actionExecutionId: requireUuid(row, "actionExecutionId"),
        despesaId: requireUuid(row, "despesaId"),
        valor: requireNumber(row, "valor"),
        categoria: requireCategory(row, "categoria"),
      };
    case "replayed":
      return {
        kind: "replayed",
        actionExecutionId: requireUuid(row, "actionExecutionId"),
        despesaId: requireUuid(row, "despesaId"),
        valor: requireNumber(row, "valor"),
        categoria: requireCategory(row, "categoria"),
      };
    case "rejected": {
      const reason = requireString(row, "reason");
      if (!REJECTED_REASON_SET.has(reason as ExpenseCreateRejectedReason)) {
        throw new ExpenseActionUnknownResultError(reason);
      }
      return {
        kind: "rejected",
        reason: reason as ExpenseCreateRejectedReason,
      };
    }
    case "conflicted": {
      const reason = requireString(row, "reason");
      if (!CONFLICT_REASON_SET.has(reason as ExpenseCreateConflictReason)) {
        throw new ExpenseActionUnknownResultError(reason);
      }
      if (reason === "state_version_conflict") {
        return {
          kind: "conflicted",
          reason: "state_version_conflict",
          currentStateVersion: requireInteger(row, "currentStateVersion"),
        };
      }
      // action_execution_conflict — sem campos extras.
      return {
        kind: "conflicted",
        reason: "action_execution_conflict",
      };
    }
    default:
      throw new ExpenseActionUnknownResultError(kind);
  }
}

// ---------------------------------------------------------------------------
// invokeRpc.
// ---------------------------------------------------------------------------

async function invokeRpc<T = unknown>(
  client: ExpenseActionSupabaseLike,
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  let res: ExpenseActionRpcResponse<T>;
  try {
    res = await client.rpc<T>(fn, params);
  } catch (err) {
    throw new ExpenseActionTransportError(
      (err as Error)?.message ?? `${fn} failed`,
    );
  }
  if (res.error) {
    throw new ExpenseActionRpcExceptionError(
      res.error.code ?? null,
      res.error.message,
    );
  }
  return res.data as T;
}

// ---------------------------------------------------------------------------
// Repository.
// ---------------------------------------------------------------------------

export class WhatsappExpenseActionRepository
  implements ExpenseCreateExecutorPort {
  private readonly client: ExpenseActionSupabaseLike;

  constructor(client: ExpenseActionSupabaseLike) {
    this.client = client;
  }

  async executeExpenseCreate(
    command: ExpenseCreateExecutionCommand,
  ): Promise<ExpenseCreateExecutorResult> {
    const data = await invokeRpc(
      this.client,
      "execute_whatsapp_expense_create",
      {
        p_draft_id: command.draftId,
        p_conversation_state_id: command.conversationStateId,
        p_confirmation_message_id: command.confirmationMessageId,
        p_source_message_id: command.sourceMessageId,
        p_queue_item_id: command.queueItemId,
        p_user_id: command.userId,
        p_contact_id: command.contactId,
        p_vehicle_id: command.vehicleId,
        p_categoria: command.categoria,
        p_valor: command.valor,
        p_descricao: command.descricao,
        p_expected_state_version: command.expectedStateVersion,
        p_orchestrator_version: command.orchestratorVersion,
      },
    );
    return parseExecuteExpenseCreate(data);
  }
}
