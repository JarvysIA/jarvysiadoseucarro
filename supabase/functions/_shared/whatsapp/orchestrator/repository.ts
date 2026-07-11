// Build 5.7F2B3 — Repository TypeScript do orquestrador WhatsApp.
// Wrappers tipados sobre as RPCs SECURITY DEFINER instaladas.
// NÃO conectado ao worker. Nenhuma alteração de banco. Nenhuma UI.
//
// Fonte de verdade (auditada via pg_get_functiondef em 2026-07-11):
//   - public.apply_whatsapp_orchestrator_transition
//     migration: 20260711215610_1c7f3907-fd04-4e41-aed2-320f8358c362.sql
//   - public.claim_whatsapp_orchestrator_items
//     public.release_whatsapp_orchestrator_item
//     migration: 20260711194052_9c80bb6f-35d6-4538-bd7c-bbc39c0b979b.sql
// A migration 20260711202942_... foi substituída integralmente e NÃO define
// o contrato de runtime.

import type {
  ApplyReasonCode,
  ClaimInput,
  ClaimedItem,
  OrchestratorResultOk,
  ReleaseInput,
  ReleaseReasonCode,
  ReleaseResult,
  TransitionInput,
  TransitionOptions,
  TransitionResult,
} from "./types.ts";
import type { ConversationStatePatch } from "../conversation/types.ts";
import {
  AmbiguousTimeoutError,
  MalformedResponseError,
  RepositoryError,
  RpcExceptionError,
  TransportError,
  UnknownReasonError,
} from "./errors.ts";

// ============================================================
// Structural client — evita acoplar a supabase-js@X.Y.Z. Basta expor .rpc().
// Em produção o caller passa `createClient(...)` normal. Em testes, um mock.
// ============================================================

export type RpcResponse<T> = {
  data: T | null;
  error: RpcError | null;
};

export type RpcError = {
  message: string;
  code?: string | null;   // SQLSTATE quando é erro de banco
  details?: string | null;
  hint?: string | null;
};

export type RpcInvoker = <T = unknown>(
  fn: string,
  params: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<RpcResponse<T>>;

export type SupabaseLike = {
  rpc: RpcInvoker;
};

// ============================================================
// Logger — sanitizado. NUNCA aceita phone/text_body/nome.
// ============================================================

export type OrchestratorLogEvent = {
  event: string;
  workerId?: string;
  queueItemId?: string;
  reasonCode?: string;
  attempt?: number;
  durationMs?: number;
  ok?: boolean;
};

export type OrchestratorLogger = (evt: OrchestratorLogEvent) => void;

const noopLogger: OrchestratorLogger = () => {};

// ============================================================
// Enum de reasons — usados para detectar unknown_reason em runtime.
// Deve permanecer alinhado com types.ts::ApplyReasonCode.
// ============================================================

const APPLY_REASONS: ReadonlySet<ApplyReasonCode> = new Set<ApplyReasonCode>([
  "queue_item_not_found",
  "source_message_missing",
  "contact_missing",
  "contact_not_verified",
  "contact_unlinked",
  "instance_not_found",
  "orchestrator_not_active",
  "invariant_violation",
  "queue_already_terminal",
  "lease_lost",
  "message_mismatch",
  "message_direction_invalid",
  "message_type_unsupported",
  "state_version_conflict",
  "patch_invalid_key",
  "patch_invalid_value",
  "draft_transition_invalid",
  "vehicle_invalid",
  "result_summary_invalid",
  "response_invalid",
  "idempotency_payload_mismatch",
]);

const RELEASE_REASONS: ReadonlySet<ReleaseReasonCode> = new Set<ReleaseReasonCode>([
  "queue_item_not_found",
  "invariant_violation",
  "already_terminal",
  "lease_lost",
]);

// ============================================================
// Utilidades
// ============================================================

const DEFAULT_TIMEOUT_MS = 8000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isAbortLike(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: unknown; message?: unknown };
  if (typeof e.name === "string" && (e.name === "AbortError" || e.name === "TimeoutError")) return true;
  if (typeof e.message === "string" && /aborted|timeout/i.test(e.message)) return true;
  return false;
}

/**
 * Encadeia signal externo + timeout interno. Retorna signal composto e cleanup.
 * A RPC recebe o signal composto. Se qualquer origem abortar, cancela o request.
 */
function composeSignal(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOutFlag = false;

  const onExternal = () => controller.abort(new Error("external_abort"));
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(new Error("external_abort"));
    else externalSignal.addEventListener("abort", onExternal, { once: true });
  }

  const t = setTimeout(() => {
    timedOutFlag = true;
    controller.abort(new Error("timeout"));
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(t);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternal);
  };

  return { signal: controller.signal, cleanup, timedOut: () => timedOutFlag };
}

// ============================================================
// Serialização de patch: TS camelCase → SQL snake_case ESTRITO.
// Chave omitida = preservar valor atual (semântica da RPC).
// Chave presente com valor null = limpar.
// Presente com undefined é tratado como omitido.
// ============================================================

const PATCH_KEY_MAP: Record<keyof ConversationStatePatch, string> = {
  state: "next_state",
  currentIntent: "current_intent",
  awaitingField: "awaiting_field",
  requestSource: "request_source",
  draftType: "draft_type",
  draftId: "draft_id",
  draftVersion: "draft_version",
  draftPayload: "draft_payload",
  activeVehicleId: "active_vehicle_id",
  confirmedAt: "confirmed_at",
  executedAt: "executed_at",
  expiresAt: "expires_at",
  lastMessageId: "last_message_id", // não aceito pela RPC; ver validação abaixo
};

// Somente estas chaves são aceitas pela RPC.
// `next_state` é obrigatório; `last_message_id` NÃO é aceito no patch (a RPC
// escreve last_message_id automaticamente a partir de v_msg.id).
const RPC_PATCH_KEYS_ALLOWED: ReadonlySet<string> = new Set([
  "next_state",
  "current_intent",
  "awaiting_field",
  "request_source",
  "active_vehicle_id",
  "draft_type",
  "draft_id",
  "draft_version",
  "draft_payload",
  "confirmed_at",
  "executed_at",
  "expires_at",
  "fallback_count",
]);

export function serializePatch(patch: ConversationStatePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (patch.state === undefined || patch.state === null) {
    throw new RepositoryError(
      "invalid_patch",
      "patch.state (next_state) é obrigatório e não pode ser null",
    );
  }
  out.next_state = patch.state;

  for (const [tsKey, value] of Object.entries(patch) as [
    keyof ConversationStatePatch,
    unknown,
  ][]) {
    if (tsKey === "state") continue;
    if (value === undefined) continue; // omitido
    const sqlKey = PATCH_KEY_MAP[tsKey];
    if (!sqlKey || !RPC_PATCH_KEYS_ALLOWED.has(sqlKey)) {
      throw new RepositoryError("invalid_patch", `patch key not accepted by RPC: ${tsKey}`);
    }
    out[sqlKey] = value; // null é permitido → limpa campo
  }

  // fallback_count não está no ConversationStatePatch original; o caller precisa
  // passá-lo via `unsafeExtraPatch` se quiser controlá-lo (não implementado
  // aqui para manter type safety).
  return out;
}

/** Serializa response TS→SQL. Retorna null quando input é null/undefined. */
export function serializeResponse(
  response: TransitionInput["response"] | undefined,
): Record<string, unknown> | null {
  if (!response) return null;
  const out: Record<string, unknown> = {
    response_key: response.responseKey,
    text_body: response.textBody,
  };
  if (response.messageType !== undefined) out.message_type = response.messageType;
  if (response.purpose !== undefined) out.purpose = response.purpose;
  if (response.priority !== undefined) out.priority = response.priority;
  if (response.scheduledAt !== undefined) out.scheduled_at = response.scheduledAt;
  if (response.expiresAt !== undefined) out.expires_at = response.expiresAt;
  return out;
}

// ============================================================
// Parsing das respostas jsonb da RPC → tipos TS.
// ============================================================

function parseOrchestratorResult(raw: unknown): OrchestratorResultOk {
  if (!isPlainObject(raw)) throw new MalformedResponseError("orchestratorResult ausente ou não-objeto");
  const {
    decisionKind,
    eventKind,
    outcome,
    responseKey,
    nextState,
    stateVersion,
    outboundQueueId,
  } = raw;
  if (
    typeof decisionKind !== "string" ||
    typeof eventKind !== "string" ||
    typeof outcome !== "string" ||
    typeof nextState !== "string" ||
    typeof stateVersion !== "number"
  ) {
    throw new MalformedResponseError("orchestratorResult com campos ausentes ou tipos errados");
  }
  return {
    decisionKind: decisionKind as OrchestratorResultOk["decisionKind"],
    eventKind: eventKind as OrchestratorResultOk["eventKind"],
    outcome: outcome as OrchestratorResultOk["outcome"],
    responseKey: typeof responseKey === "string" ? responseKey : null,
    nextState: nextState as OrchestratorResultOk["nextState"],
    stateVersion,
    outboundQueueId: typeof outboundQueueId === "string" ? outboundQueueId : null,
  };
}

function parseTransitionResult(raw: unknown): TransitionResult {
  if (!isPlainObject(raw)) throw new MalformedResponseError("transition response não é objeto");
  if (raw.ok === true) {
    const wasReplay = raw.wasReplay === true;
    const orchestratorResult = parseOrchestratorResult(raw.orchestratorResult);
    return { ok: true, wasReplay, orchestratorResult };
  }
  if (raw.ok === false) {
    const reason = raw.reason;
    if (typeof reason !== "string") {
      throw new MalformedResponseError("transition ok=false sem reason string");
    }
    if (!APPLY_REASONS.has(reason as ApplyReasonCode)) {
      throw new UnknownReasonError(reason);
    }
    const out: TransitionResult = { ok: false, reason: reason as ApplyReasonCode };
    if (reason === "state_version_conflict" && typeof raw.currentStateVersion === "number") {
      out.currentStateVersion = raw.currentStateVersion;
    }
    return out;
  }
  throw new MalformedResponseError("transition response sem campo ok booleano");
}

function parseReleaseResult(raw: unknown): ReleaseResult {
  if (!isPlainObject(raw)) throw new MalformedResponseError("release response não é objeto");
  if (raw.ok === true) {
    if (raw.wasReplay === true) {
      const orchestratorResult = parseOrchestratorResult(raw.orchestratorResult);
      return { ok: true, wasReplay: true, orchestratorResult };
    }
    const status = raw.status;
    if (status !== "queued" && status !== "failed" && status !== "cancelled") {
      throw new MalformedResponseError("release ok=true com status inesperado");
    }
    if (typeof raw.attempts !== "number" || typeof raw.willRetry !== "boolean") {
      throw new MalformedResponseError("release ok=true com attempts/willRetry inválidos");
    }
    return { ok: true, status, attempts: raw.attempts, willRetry: raw.willRetry };
  }
  if (raw.ok === false) {
    const reason = raw.reason;
    if (typeof reason !== "string") throw new MalformedResponseError("release ok=false sem reason");
    if (!RELEASE_REASONS.has(reason as ReleaseReasonCode)) throw new UnknownReasonError(reason);
    return { ok: false, reason: reason as ReleaseReasonCode };
  }
  throw new MalformedResponseError("release response sem campo ok booleano");
}

function parseClaimedRows(raw: unknown): ClaimedItem[] {
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw new MalformedResponseError("claim response não é array");
  return raw.map((row, i) => {
    if (!isPlainObject(row)) {
      throw new MalformedResponseError(`claim row ${i} não é objeto`);
    }
    const mode = row.orchestrator_mode;
    if (mode !== "test" && mode !== "active") {
      throw new MalformedResponseError(`claim row ${i} com orchestrator_mode inválido`);
    }
    return {
      queueId: String(row.queue_id),
      messageId: String(row.message_id),
      contactId: String(row.contact_id),
      userId: row.user_id == null ? null : String(row.user_id),
      instancePk: String(row.instance_pk),
      provider: String(row.provider),
      instanceId: String(row.instance_id),
      queueType: String(row.queue_type),
      messageType: String(row.message_type),
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      leaseToken: String(row.lease_token),
      leaseExpiresAt: String(row.lease_expires_at),
      wasRecovered: Boolean(row.was_recovered),
      orchestratorMode: mode,
    };
  });
}

// ============================================================
// Repository
// ============================================================

export type RepositoryOptions = {
  logger?: OrchestratorLogger;
  defaultTimeoutMs?: number;
};

export class WhatsappOrchestratorRepository {
  private readonly client: SupabaseLike;
  private readonly log: OrchestratorLogger;
  private readonly defaultTimeoutMs: number;

  constructor(client: SupabaseLike, opts: RepositoryOptions = {}) {
    this.client = client;
    this.log = opts.logger ?? noopLogger;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // --------------------------------------------------------
  // CLAIM
  // --------------------------------------------------------

  async claim(input: ClaimInput, options: TransitionOptions = {}): Promise<ClaimedItem[]> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const { signal, cleanup, timedOut } = composeSignal(options.signal, timeoutMs);
    const started = Date.now();
    try {
      const res = await this.client.rpc<unknown>(
        "claim_whatsapp_orchestrator_items",
        {
          p_worker_id: input.workerId,
          p_batch: input.batch ?? 10,
          p_lease_seconds: input.leaseSeconds ?? 300,
        },
        { signal },
      );
      if (res.error) throw toRpcError(res.error);
      const items = parseClaimedRows(res.data);
      this.log({
        event: "orchestrator.claim.ok",
        workerId: input.workerId,
        durationMs: Date.now() - started,
      });
      return items;
    } catch (err) {
      if (isAbortLike(err) && timedOut()) {
        // claim é idempotente (não muda estado além do lease); pode retentar
        // no próximo tick sem replay dedicado.
        throw new TransportError("claim timeout", { workerId: input.workerId });
      }
      if (isAbortLike(err)) {
        throw new TransportError("claim aborted", { workerId: input.workerId });
      }
      throw err instanceof RepositoryError
        ? err
        : new TransportError((err as Error)?.message ?? "claim failed", { workerId: input.workerId });
    } finally {
      cleanup();
    }
  }

  // --------------------------------------------------------
  // APPLY TRANSITION — com durable replay em timeout ambíguo
  // --------------------------------------------------------

  async applyTransition(
    input: TransitionInput,
    options: TransitionOptions = {},
  ): Promise<TransitionResult> {
    const params = {
      p_queue_item_id: input.queueItemId,
      p_lease_token: input.leaseToken,
      p_expected_state_version: input.expectedStateVersion,
      p_patch: serializePatch(input.patch),
      p_orchestrator_version: input.orchestratorVersion,
      p_result_summary: {
        // camelCase ESTRITO — validado contra c_summary_keys da RPC instalada.
        decisionKind: input.resultSummary.decisionKind,
        eventKind: input.resultSummary.eventKind,
        outcome: input.resultSummary.outcome,
      },
      p_response: serializeResponse(input.response),
    };

    // Tentativa 1
    try {
      return await this.callApply(params, options, 1);
    } catch (err) {
      if (err instanceof AmbiguousTimeoutError) {
        // Durable replay: um único retry idêntico. A RPC detecta o queue item
        // já finalizado (status='done' + orchestrator_result presente) e devolve
        // wasReplay=true SEM reprocessar. Se o commit anterior falhou, a RPC
        // recomeça normalmente do zero.
        this.log({
          event: "orchestrator.apply.replay_attempt",
          queueItemId: input.queueItemId,
          attempt: 2,
        });
        try {
          return await this.callApply(params, options, 2);
        } catch (err2) {
          if (err2 instanceof AmbiguousTimeoutError) {
            // Depois de 2 timeouts, promover para erro definitivo.
            throw new TransportError("apply timeout after replay", {
              queueItemId: input.queueItemId,
            });
          }
          throw err2;
        }
      }
      throw err;
    }
  }

  private async callApply(
    params: Record<string, unknown>,
    options: TransitionOptions,
    attempt: number,
  ): Promise<TransitionResult> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const { signal, cleanup, timedOut } = composeSignal(options.signal, timeoutMs);
    const started = Date.now();
    const queueItemId = String(params.p_queue_item_id);
    try {
      const res = await this.client.rpc<unknown>(
        "apply_whatsapp_orchestrator_transition",
        params,
        { signal },
      );
      if (res.error) throw toRpcError(res.error);
      const parsed = parseTransitionResult(res.data);
      this.log({
        event: "orchestrator.apply.result",
        queueItemId,
        attempt,
        durationMs: Date.now() - started,
        ok: parsed.ok,
        reasonCode: parsed.ok ? undefined : parsed.reason,
      });
      return parsed;
    } catch (err) {
      if (isAbortLike(err) && timedOut()) {
        this.log({
          event: "orchestrator.apply.timeout",
          queueItemId,
          attempt,
          durationMs: Date.now() - started,
        });
        throw new AmbiguousTimeoutError("apply timeout", { queueItemId, attempt });
      }
      if (isAbortLike(err)) {
        // Abort externo: caller decidiu parar. Comporta-se como ambíguo pois
        // não sabemos se a RPC commitou.
        throw new AmbiguousTimeoutError("apply aborted", { queueItemId, attempt });
      }
      if (err instanceof RepositoryError) throw err;
      throw new TransportError((err as Error)?.message ?? "apply failed", { queueItemId, attempt });
    } finally {
      cleanup();
    }
  }

  // --------------------------------------------------------
  // RELEASE
  // --------------------------------------------------------

  async release(input: ReleaseInput, options: TransitionOptions = {}): Promise<ReleaseResult> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const { signal, cleanup, timedOut } = composeSignal(options.signal, timeoutMs);
    const started = Date.now();
    try {
      const res = await this.client.rpc<unknown>(
        "release_whatsapp_orchestrator_item",
        {
          p_queue_item_id: input.queueItemId,
          p_lease_token: input.leaseToken,
          p_reason: input.reason,
          p_retry_kind: input.retryKind,
          p_delay_seconds: input.delaySeconds ?? 5,
        },
        { signal },
      );
      if (res.error) throw toRpcError(res.error);
      const parsed = parseReleaseResult(res.data);
      this.log({
        event: "orchestrator.release.result",
        queueItemId: input.queueItemId,
        attempt: 1,
        durationMs: Date.now() - started,
        ok: parsed.ok,
        reasonCode: parsed.ok ? undefined : parsed.reason,
      });
      return parsed;
    } catch (err) {
      if (isAbortLike(err) && timedOut()) {
        // release muta estado (queued/failed/cancelled). Não é seguro replay
        // automático porque o segundo call vê status já terminal e retorna
        // already_terminal — o caller precisa decidir manualmente.
        throw new TransportError("release timeout", { queueItemId: input.queueItemId });
      }
      if (isAbortLike(err)) {
        throw new TransportError("release aborted", { queueItemId: input.queueItemId });
      }
      if (err instanceof RepositoryError) throw err;
      throw new TransportError((err as Error)?.message ?? "release failed", {
        queueItemId: input.queueItemId,
      });
    } finally {
      cleanup();
    }
  }
}

// ============================================================
// Erros vindos do PostgREST/supabase-js → RpcExceptionError.
// ============================================================
function toRpcError(err: RpcError): RepositoryError {
  return new RpcExceptionError(err.code ?? null, err.message);
}
