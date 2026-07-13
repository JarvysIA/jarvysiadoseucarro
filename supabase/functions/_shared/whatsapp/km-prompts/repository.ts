// Build 5.7F2E1A.5-MJ1 — Repository TS estrito para km-prompts.
// Cinco wrappers sobre RPCs SECURITY DEFINER instaladas via migration MJ1.
// Backend-only. Não conectado ao runtime. Sem chamadas ao core, drafts,
// mapper, action service ou plan access mode.

import {
  CANCEL_KM_PROMPT_RESULTS,
  CREATE_KM_PROMPT_RESULTS,
  KmPromptMalformedResponseError,
  KmPromptRpcExceptionError,
  KmPromptTransportError,
  KmPromptUnknownResultError,
  PROMOTE_KM_PROMPT_RESULTS,
  RESERVE_KM_PROMPT_RESULTS,
  type CancelKmPromptRequestInput,
  type CancelKmPromptRequestResult,
  type CreateKmPromptRequestInput,
  type CreateKmPromptRequestResult,
  type ExpireKmPromptRequestsInput,
  type ExpireKmPromptRequestsResult,
  type PromoteKmPromptRequestInput,
  type PromoteKmPromptRequestResult,
  type ReserveKmPromptRequestInput,
  type ReserveKmPromptRequestResult,
} from "./types.ts";

// ------------------------------------------------------------
// Structural client — apenas .rpc().
// ------------------------------------------------------------

export type KmPromptRpcError = {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type KmPromptRpcResponse<T> = {
  data: T | null;
  error: KmPromptRpcError | null;
};

export type KmPromptRpcInvoker = <T = unknown>(
  fn: string,
  params: Record<string, unknown>,
) => Promise<KmPromptRpcResponse<T>>;

export type KmPromptSupabaseLike = {
  rpc: KmPromptRpcInvoker;
};

// ------------------------------------------------------------
// Utilidades — parsing estrito.
// ------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new KmPromptMalformedResponseError(`campo ${key} ausente ou vazio`);
  }
  return v;
}

function optionalString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const v = row[key];
  if (v == null) return null;
  if (typeof v !== "string" || v.length === 0) {
    throw new KmPromptMalformedResponseError(`campo ${key} inválido`);
  }
  return v;
}

function requireIsoTimestamp(row: Record<string, unknown>, key: string): string {
  const s = requireString(row, key);
  if (Number.isNaN(Date.parse(s))) {
    throw new KmPromptMalformedResponseError(`campo ${key} não é timestamp ISO`);
  }
  return s;
}

function optionalIsoTimestamp(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const v = row[key];
  if (v == null) return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
    throw new KmPromptMalformedResponseError(`campo ${key} não é timestamp ISO`);
  }
  return v;
}

function requireUuid(row: Record<string, unknown>, key: string): string {
  return requireString(row, key);
}

/** Extrai uma linha única do payload tabular. Rejeita null/undefined/[]/>1 row. */
function requireSingleRow(raw: unknown): Record<string, unknown> {
  if (raw == null) {
    throw new KmPromptMalformedResponseError("payload nulo");
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new KmPromptMalformedResponseError("array vazio");
    }
    if (raw.length > 1) {
      throw new KmPromptMalformedResponseError("múltiplas linhas quando se espera uma");
    }
    const first = raw[0];
    if (!isPlainObject(first)) {
      throw new KmPromptMalformedResponseError("linha não é objeto");
    }
    return first;
  }
  if (!isPlainObject(raw)) {
    throw new KmPromptMalformedResponseError("payload não é objeto");
  }
  return raw;
}

function toRpcError(err: KmPromptRpcError): KmPromptRpcExceptionError {
  return new KmPromptRpcExceptionError(err.code ?? null, err.message);
}

async function invokeRpc<T = unknown>(
  client: KmPromptSupabaseLike,
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  let res: KmPromptRpcResponse<T>;
  try {
    res = await client.rpc<T>(fn, params);
  } catch (err) {
    throw new KmPromptTransportError((err as Error)?.message ?? `${fn} failed`);
  }
  if (res.error) throw toRpcError(res.error);
  return res.data as T;
}

// ------------------------------------------------------------
// Parsers de resultado — nunca aceitam string arbitrária.
// ------------------------------------------------------------

const CREATE_SET: ReadonlySet<string> = new Set(CREATE_KM_PROMPT_RESULTS);
const PROMOTE_SET: ReadonlySet<string> = new Set(PROMOTE_KM_PROMPT_RESULTS);
const RESERVE_SET: ReadonlySet<string> = new Set(RESERVE_KM_PROMPT_RESULTS);
const CANCEL_SET: ReadonlySet<string> = new Set(CANCEL_KM_PROMPT_RESULTS);

function parseCreate(raw: unknown): CreateKmPromptRequestResult {
  const row = requireSingleRow(raw);
  const result = requireString(row, "result");
  if (!CREATE_SET.has(result)) throw new KmPromptUnknownResultError(result);
  switch (result) {
    case "created":
    case "replayed":
    case "already_exists_with_different_context":
      return {
        result: result as
          | "created"
          | "replayed"
          | "already_exists_with_different_context",
        requestId: requireUuid(row, "request_id"),
      };
    case "prompt_message_not_found":
    case "prompt_message_not_outbound":
    case "prompt_context_mismatch":
    case "vehicle_archived":
      return { result: result as
        | "prompt_message_not_found"
        | "prompt_message_not_outbound"
        | "prompt_context_mismatch"
        | "vehicle_archived" };
    default:
      throw new KmPromptUnknownResultError(result);
  }
}

function parsePromote(raw: unknown): PromoteKmPromptRequestResult {
  const row = requireSingleRow(raw);
  const result = requireString(row, "result");
  if (!PROMOTE_SET.has(result)) throw new KmPromptUnknownResultError(result);
  switch (result) {
    case "promoted":
    case "already_pending":
      return {
        result: result as "promoted" | "already_pending",
        requestId: requireUuid(row, "request_id"),
        pendingAt: requireIsoTimestamp(row, "pending_at"),
        expiresAt: requireIsoTimestamp(row, "expires_at"),
      };
    case "not_found":
      return { result: "not_found" };
    case "not_queued":
    case "prompt_message_not_sent":
    case "prompt_context_mismatch":
      return {
        result: result as
          | "not_queued"
          | "prompt_message_not_sent"
          | "prompt_context_mismatch",
        requestId: requireUuid(row, "request_id"),
      };
    default:
      throw new KmPromptUnknownResultError(result);
  }
}

function parseReserve(raw: unknown): ReserveKmPromptRequestResult {
  const row = requireSingleRow(raw);
  const result = requireString(row, "result");
  if (!RESERVE_SET.has(result)) throw new KmPromptUnknownResultError(result);
  switch (result) {
    case "reserved":
    case "replayed":
      return {
        result: result as "reserved" | "replayed",
        requestId: requireUuid(row, "request_id"),
        reservedDraftId: requireUuid(row, "reserved_draft_id"),
        reservedAt: requireIsoTimestamp(row, "reserved_at"),
      };
    case "prompt_not_found":
      return { result: "prompt_not_found" };
    case "prompt_not_pending":
    case "prompt_expired":
    case "prompt_cancelled":
    case "prompt_consumed":
    case "prompt_reserved_by_other_draft":
    case "prompt_context_mismatch":
    case "prompt_message_not_sent":
    case "draft_message_not_found":
    case "draft_message_not_inbound":
    case "draft_context_mismatch":
      return {
        result: result as
          | "prompt_not_pending"
          | "prompt_expired"
          | "prompt_cancelled"
          | "prompt_consumed"
          | "prompt_reserved_by_other_draft"
          | "prompt_context_mismatch"
          | "prompt_message_not_sent"
          | "draft_message_not_found"
          | "draft_message_not_inbound"
          | "draft_context_mismatch",
        requestId: requireUuid(row, "request_id"),
      };
    default:
      throw new KmPromptUnknownResultError(result);
  }
}

function parseCancel(raw: unknown): CancelKmPromptRequestResult {
  const row = requireSingleRow(raw);
  const result = requireString(row, "result");
  if (!CANCEL_SET.has(result)) throw new KmPromptUnknownResultError(result);
  switch (result) {
    case "cancelled":
      return {
        result: "cancelled",
        requestId: requireUuid(row, "request_id"),
        cancelledAt: requireIsoTimestamp(row, "cancelled_at"),
      };
    case "already_terminal":
      return {
        result: "already_terminal",
        requestId: requireUuid(row, "request_id"),
        cancelledAt: optionalIsoTimestamp(row, "cancelled_at"),
      };
    case "not_found":
      return { result: "not_found" };
    default:
      throw new KmPromptUnknownResultError(result);
  }
}

function parseExpire(raw: unknown): ExpireKmPromptRequestsResult {
  const row = requireSingleRow(raw);
  const raw_count = row.expired_count;
  if (typeof raw_count !== "number" || !Number.isInteger(raw_count) || raw_count < 0) {
    throw new KmPromptMalformedResponseError("expired_count inválido");
  }
  // optionalString não usado aqui — apenas garante que shape restante é sã.
  void optionalString;
  return { expiredCount: raw_count };
}

// ------------------------------------------------------------
// Repository
// ------------------------------------------------------------

export class WhatsappKmPromptRepository {
  private readonly client: KmPromptSupabaseLike;

  constructor(client: KmPromptSupabaseLike) {
    this.client = client;
  }

  async create(input: CreateKmPromptRequestInput): Promise<CreateKmPromptRequestResult> {
    const data = await invokeRpc(this.client, "create_whatsapp_km_prompt_request", {
      p_prompt_message_id: input.promptMessageId,
      p_contact_id: input.contactId,
      p_user_id: input.userId,
      p_vehicle_id: input.vehicleId,
    });
    return parseCreate(data);
  }

  async promoteToPending(
    input: PromoteKmPromptRequestInput,
  ): Promise<PromoteKmPromptRequestResult> {
    const data = await invokeRpc(
      this.client,
      "promote_whatsapp_km_prompt_request_to_pending",
      { p_prompt_message_id: input.promptMessageId },
    );
    return parsePromote(data);
  }

  async reserve(
    input: ReserveKmPromptRequestInput,
  ): Promise<ReserveKmPromptRequestResult> {
    const data = await invokeRpc(this.client, "reserve_whatsapp_km_prompt_request", {
      p_prompt_message_id: input.promptMessageId,
      p_contact_id: input.contactId,
      p_user_id: input.userId,
      p_vehicle_id: input.vehicleId,
      p_draft_id: input.draftId,
    });
    return parseReserve(data);
  }

  async cancel(
    input: CancelKmPromptRequestInput,
  ): Promise<CancelKmPromptRequestResult> {
    const data = await invokeRpc(this.client, "cancel_whatsapp_km_prompt_request", {
      p_prompt_message_id: input.promptMessageId,
    });
    return parseCancel(data);
  }

  async expire(
    input: ExpireKmPromptRequestsInput = {},
  ): Promise<ExpireKmPromptRequestsResult> {
    const data = await invokeRpc(this.client, "expire_whatsapp_km_prompt_requests", {
      p_batch: input.batch ?? 500,
    });
    return parseExpire(data);
  }
}
