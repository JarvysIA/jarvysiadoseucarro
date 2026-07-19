// Build 5.7F2E1C — Repository TS estrito para execute_whatsapp_km_update.
// Wrapper sobre a RPC SECURITY DEFINER instalada nas migrations 5.7F2E1B/-fix2.
// Backend-only. Não conectado ao runtime. Sem chamadas ao service/core.
//
// Estilo espelha km-prompts/repository.ts, mas os erros são LOCAIS deste
// domínio para não acoplar actions a km-prompts.

import {
  type KmUpdateConflictReason,
  type KmUpdateExecutionCommand,
  type KmUpdateExecutorPort,
  type KmUpdateExecutorResult,
  type KmUpdateRejectedReason,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Structural client — apenas .rpc().
// ---------------------------------------------------------------------------

export type KmActionRpcError = {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type KmActionRpcResponse<T> = {
  data: T | null;
  error: KmActionRpcError | null;
};

export type KmActionRpcInvoker = <T = unknown>(
  fn: string,
  params: Record<string, unknown>,
) => Promise<KmActionRpcResponse<T>>;

export type KmActionSupabaseLike = {
  rpc: KmActionRpcInvoker;
};

// ---------------------------------------------------------------------------
// Erros tipados (locais deste domínio).
// ---------------------------------------------------------------------------

export class KmActionTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmActionTransportError";
  }
}

export class KmActionRpcExceptionError extends Error {
  readonly code: string | null;
  constructor(code: string | null, message: string) {
    super(message);
    this.name = "KmActionRpcExceptionError";
    this.code = code;
  }
}

export class KmActionMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmActionMalformedResponseError";
  }
}

export class KmActionUnknownResultError extends Error {
  readonly value: string;
  constructor(value: string) {
    super(`unknown result: ${value}`);
    this.name = "KmActionUnknownResultError";
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// Conjuntos fechados (locais).
// ---------------------------------------------------------------------------

const KIND_SET: ReadonlySet<string> = new Set([
  "applied",
  "replayed",
  "no_op",
  "rejected",
  "conflicted",
]);

const REJECTED_REASON_SET: ReadonlySet<KmUpdateRejectedReason> = new Set<
  KmUpdateRejectedReason
>([
  "contact_missing",
  "contact_unlinked",
  "vehicle_not_found",
  "vehicle_not_owned",
  "vehicle_archived",
  "km_invalid",
  "correction_not_confirmed",
  "invariant_violation",
]);

const CONFLICT_REASON_SET: ReadonlySet<KmUpdateConflictReason> = new Set<
  KmUpdateConflictReason
>([
  "km_conflict",
  "state_version_conflict",
  "action_execution_conflict",
]);

// ---------------------------------------------------------------------------
// Helpers de parsing.
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireSingleRow(raw: unknown): Record<string, unknown> {
  if (raw == null) {
    throw new KmActionMalformedResponseError("payload nulo");
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new KmActionMalformedResponseError("array vazio");
    }
    if (raw.length > 1) {
      throw new KmActionMalformedResponseError(
        "múltiplas linhas quando se espera uma",
      );
    }
    const first = raw[0];
    if (!isPlainObject(first)) {
      throw new KmActionMalformedResponseError("linha não é objeto");
    }
    return first;
  }
  if (!isPlainObject(raw)) {
    throw new KmActionMalformedResponseError("payload não é objeto");
  }
  return raw;
}

function requireString(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new KmActionMalformedResponseError(`campo ${key} ausente ou vazio`);
  }
  return v;
}

function requireUuid(row: Record<string, unknown>, key: string): string {
  return requireString(row, key);
}

function requireInteger(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new KmActionMalformedResponseError(
      `campo ${key} não é inteiro`,
    );
  }
  return v;
}

function requireBoolean(row: Record<string, unknown>, key: string): boolean {
  const v = row[key];
  if (typeof v !== "boolean") {
    throw new KmActionMalformedResponseError(`campo ${key} não é boolean`);
  }
  return v;
}

/**
 * Aceita inteiro OU null explícito. Rejeita ausente (undefined) ou tipo
 * errado. Usado para previousKm/currentKm, que podem ser jsonb null.
 */
function requireIntegerOrNull(
  row: Record<string, unknown>,
  key: string,
): number | null {
  if (!(key in row)) {
    throw new KmActionMalformedResponseError(`campo ${key} ausente`);
  }
  const v = row[key];
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new KmActionMalformedResponseError(
      `campo ${key} não é inteiro nem null`,
    );
  }
  return v;
}

// ---------------------------------------------------------------------------
// Parser principal.
// ---------------------------------------------------------------------------

export function parseExecuteKmUpdate(raw: unknown): KmUpdateExecutorResult {
  const row = requireSingleRow(raw);
  const kind = requireString(row, "kind");
  if (!KIND_SET.has(kind)) throw new KmActionUnknownResultError(kind);

  switch (kind) {
    case "applied":
      return {
        kind: "applied",
        actionExecutionId: requireUuid(row, "actionExecutionId"),
        previousKm: requireIntegerOrNull(row, "previousKm"),
        newKm: requireInteger(row, "newKm"),
      };
    case "replayed":
      return {
        kind: "replayed",
        actionExecutionId: requireUuid(row, "actionExecutionId"),
        previousKm: requireIntegerOrNull(row, "previousKm"),
        newKm: requireInteger(row, "newKm"),
        noChange: requireBoolean(row, "noChange"),
      };
    case "no_op":
      return {
        kind: "no_op",
        actionExecutionId: requireUuid(row, "actionExecutionId"),
        currentKm: requireIntegerOrNull(row, "currentKm"),
      };
    case "rejected": {
      const reason = requireString(row, "reason");
      if (!REJECTED_REASON_SET.has(reason as KmUpdateRejectedReason)) {
        throw new KmActionUnknownResultError(reason);
      }
      return { kind: "rejected", reason: reason as KmUpdateRejectedReason };
    }
    case "conflicted": {
      const reason = requireString(row, "reason");
      if (!CONFLICT_REASON_SET.has(reason as KmUpdateConflictReason)) {
        throw new KmActionUnknownResultError(reason);
      }
      if (reason === "state_version_conflict") {
        return {
          kind: "conflicted",
          reason: "state_version_conflict",
          currentStateVersion: requireInteger(row, "currentStateVersion"),
        };
      }
      if (reason === "km_conflict") {
        return {
          kind: "conflicted",
          reason: "km_conflict",
          currentKm: requireIntegerOrNull(row, "currentKm"),
        };
      }
      // action_execution_conflict — sem campos extras.
      return {
        kind: "conflicted",
        reason: "action_execution_conflict",
      };
    }
    default:
      throw new KmActionUnknownResultError(kind);
  }
}

// ---------------------------------------------------------------------------
// invokeRpc.
// ---------------------------------------------------------------------------

async function invokeRpc<T = unknown>(
  client: KmActionSupabaseLike,
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  let res: KmActionRpcResponse<T>;
  try {
    res = await client.rpc<T>(fn, params);
  } catch (err) {
    throw new KmActionTransportError(
      (err as Error)?.message ?? `${fn} failed`,
    );
  }
  if (res.error) {
    throw new KmActionRpcExceptionError(
      res.error.code ?? null,
      res.error.message,
    );
  }
  return res.data as T;
}

// ---------------------------------------------------------------------------
// Repository.
// ---------------------------------------------------------------------------

export class WhatsappKmActionRepository implements KmUpdateExecutorPort {
  private readonly client: KmActionSupabaseLike;

  constructor(client: KmActionSupabaseLike) {
    this.client = client;
  }

  async executeKmUpdate(
    command: KmUpdateExecutionCommand,
  ): Promise<KmUpdateExecutorResult> {
    const baseParams = {
      p_draft_id: command.draftId,
      p_conversation_state_id: command.conversationStateId,
      p_confirmation_message_id: command.confirmationMessageId,
      p_source_message_id: command.sourceMessageId,
      p_queue_item_id: command.queueItemId,
      p_user_id: command.userId,
      p_contact_id: command.contactId,
      p_vehicle_id: command.vehicleId,
      p_expected_previous_km: command.expectedPreviousKm,
      p_new_km: command.newKm,
      p_is_correction: command.isCorrection,
      p_correction_confirmed: command.correctionConfirmed,
      p_correction_reason: command.correctionReason,
      p_expected_state_version: command.expectedStateVersion,
      p_orchestrator_version: command.orchestratorVersion,
    };

    // Build 7/9 do item 6 — decisão de qual RPC chamar, com base
    // exclusivamente na presença de linkedDespesaId no comando. A RPC nova
    // (execute_whatsapp_km_update_with_expense_link) chama por dentro a RPC
    // original e devolve o MESMO shape de jsonb — por isso parseExecuteKmUpdate
    // não precisa de nenhuma mudança, serve para as duas.
    const data = command.linkedDespesaId !== undefined
      ? await invokeRpc(
          this.client,
          "execute_whatsapp_km_update_with_expense_link",
          { ...baseParams, p_linked_despesa_id: command.linkedDespesaId },
        )
      : await invokeRpc(this.client, "execute_whatsapp_km_update", baseParams);
    return parseExecuteKmUpdate(data);
  }
}
