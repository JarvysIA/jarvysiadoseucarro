// Build 5.7F2D2 — Serviço determinístico do futuro modo test.
// TOTALMENTE DESCONECTADO. Nenhum Supabase, nenhum sender, nenhum provider,
// nenhuma IA/OCR, nenhum env, nenhum fetch, nenhuma leitura de secret.
// Coordena claim → context → texto → core → response → apply → release
// via um repository injetado (mocks nos testes; nunca ligado ao worker).
//
// Regras críticas:
//   - concorrência 1 (for…of); nunca Promise.all/allSettled;
//   - claimItems exatamente uma vez por ciclo;
//   - isReplay SEMPRE false (nunca deriva de wasRecovered);
//   - defer_* / eventKind media|explicit_opt_out|replay:
//     outcome=deferredUnsupported, SEM apply, SEM release, para não descartar
//     opt-out enquanto BLOCKED_NO_LEGACY_HANDOFF não estiver resolvido;
//   - qualquer exception de applyTransition => outcomeUnknown, sem release,
//     sem nova apply, sem matching por error.message;
//   - state_version_conflict permite exatamente UM recálculo;
//   - releaseItem no máximo 1 vez por item.

import type {
  ClaimedItem,
  LoadContextResult,
  OutboundResponsePayload,
  ReleaseInput,
  ReleaseResult,
  TransitionInput,
  TransitionResult,
} from "./types.ts";
import type { WhatsappOrchestratorRepository } from "./repository.ts";
import type {
  ConversationCoreDecision,
  ConversationCoreInput,
  ConversationResponseKey,
  ConversationResponseParams,
  ConversationStatePatch,
  ConversationVehicle,
} from "../conversation/types.ts";
import type {
  ConfirmedKmUpdateDeps,
  ConfirmedKmUpdateInput,
  ConfirmedKmUpdateResult,
} from "../actions/types.ts";
import { executeConfirmedKmUpdate } from "../actions/service.ts";
import { validateAwaitingConfirmationKmUpdateDraft } from "../conversation/km-update-draft.ts";
import { decideConversation } from "../conversation/core.ts";
import { renderResponse } from "../conversation/responses.ts";

// ============================================================
// Porta local do Repository — só o subconjunto usado aqui.
// ============================================================

type OrchestratorRepositoryPort = Pick<
  WhatsappOrchestratorRepository,
  "claimItems" | "loadContext" | "applyTransition" | "releaseItem"
>;

// ============================================================
// API pública
// ============================================================

export type TestCycleInput = {
  workerId: string;
  batch?: number;
  leaseSeconds?: number;
};

export type TestServiceLogger = (evt: TestServiceLogEvent) => void;

export type TestCycleDeps = {
  repository: OrchestratorRepositoryPort;
  loadMessageText: (messageId: string) => Promise<string | null>;
  decide?: typeof decideConversation;
  render?: typeof renderResponse;
  clock: () => string;
  orchestratorVersion: string;
  kmActionDeps: ConfirmedKmUpdateDeps;
  logger?: TestServiceLogger;
};

export type ItemOutcome =
  | "completed"
  | "replayed"
  | "releasedForRetry"
  | "cancelled"
  | "deferredUnsupported"
  | "conflicted"
  | "leaseLost"
  | "terminal"
  | "contextRejected"
  | "malformed"
  | "transientFailure"
  | "outcomeUnknown";

export type TestCycleCounts = Record<ItemOutcome, number>;

export type TestCycleResult = {
  workerId: string;
  status: "ok" | "empty" | "claim_failed";
  claimed: number;
  durationMs: number;
  counts: TestCycleCounts;
};

// Eventos de log permitidos. Campos sanitizados apenas.
export type TestServiceLogEventName =
  | "cycle_started"
  | "claim_completed"
  | "item_started"
  | "context_loaded"
  | "decision_computed"
  | "response_rendered"
  | "transition_applied"
  | "transition_replayed"
  | "state_conflict_recalculated"
  | "deferred_unsupported"
  | "item_released"
  | "lease_lost"
  | "outcome_unknown"
  | "item_failed"
  | "cycle_completed";

export type TestServiceLogEvent = {
  event: TestServiceLogEventName;
  workerId?: string;
  queueItemId?: string;
  messageId?: string;
  contactId?: string;
  provider?: string;
  instanceId?: string;
  orchestratorMode?: "test" | "active";
  decisionKind?: string;
  eventKind?: string;
  outcome?: ItemOutcome;
  responseKey?: string | null;
  reasonCode?: string;
  activeVehicleIssue?: "invalid" | "archived" | null;
  attemptNumber?: number;
  durationMs?: number;
  counts?: TestCycleCounts;
  errorCategory?: string;
  ok?: boolean;
  claimed?: number;
};

// ============================================================
// Constantes internas
// ============================================================

const REASON_REGEX = /^[a-z0-9_.:-]{1,120}$/;

const CONTEXT_DEFINITIVE_REASONS = new Set<string>([
  "message_mismatch",
  "message_missing",
  "message_contact_mismatch",
  "message_provider_mismatch",
  "message_instance_mismatch",
  "contact_missing",
  "ownership_mismatch",
  "instance_missing",
]);

const APPLY_CONTEXT_REASONS = new Set<string>([
  "source_message_missing",
  "contact_missing",
  "contact_not_verified",
  "contact_unlinked",
  "instance_not_found",
  "orchestrator_not_active",
  "message_mismatch",
  "message_direction_invalid",
  "message_type_unsupported",
]);

const APPLY_INVARIANT_REASONS = new Set<string>([
  "invariant_violation",
  "patch_invalid_key",
  "patch_invalid_value",
  "draft_transition_invalid",
  "vehicle_invalid",
  "result_summary_invalid",
  "response_invalid",
]);

function emptyCounts(): TestCycleCounts {
  return {
    completed: 0,
    replayed: 0,
    releasedForRetry: 0,
    cancelled: 0,
    deferredUnsupported: 0,
    conflicted: 0,
    leaseLost: 0,
    terminal: 0,
    contextRejected: 0,
    malformed: 0,
    transientFailure: 0,
    outcomeUnknown: 0,
  };
}

function classifyError(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    typeof (err as { name: unknown }).name === "string"
  ) {
    return (err as { name: string }).name;
  }
  return "Error";
}

function isDeferred(d: ConversationCoreDecision): boolean {
  return (
    d.deferToLegacyRouter === true ||
    d.deferToLegacyOptOut === true ||
    d.decisionKind === "defer_legacy_media" ||
    d.decisionKind === "defer_legacy_opt_out" ||
    d.eventKind === "media" ||
    d.eventKind === "explicit_opt_out" ||
    d.eventKind === "replay"
  );
}

// ============================================================
// Serviço
// ============================================================

export async function runWhatsappOrchestratorTestCycle(
  input: TestCycleInput,
  deps: TestCycleDeps,
): Promise<TestCycleResult> {
  const log = deps.logger ?? (() => {});
  const decide = deps.decide ?? decideConversation;
  const render = deps.render ?? renderResponse;
  const workerId = input.workerId;
  const started = Date.now();
  const counts = emptyCounts();

  log({ event: "cycle_started", workerId });

  let items: ClaimedItem[];
  try {
    items = await deps.repository.claimItems({
      workerId,
      batch: input.batch ?? 10,
      leaseSeconds: input.leaseSeconds ?? 300,
    });
  } catch (err) {
    log({
      event: "item_failed",
      workerId,
      errorCategory: classifyError(err),
      reasonCode: "claim_failed",
    });
    const durationMs = Date.now() - started;
    log({ event: "cycle_completed", workerId, durationMs, counts });
    return { workerId, status: "claim_failed", claimed: 0, durationMs, counts };
  }

  log({ event: "claim_completed", workerId, claimed: items.length });

  if (items.length === 0) {
    const durationMs = Date.now() - started;
    log({ event: "cycle_completed", workerId, durationMs, counts });
    return { workerId, status: "empty", claimed: 0, durationMs, counts };
  }

  for (const item of items) {
    const outcome = await processItem(item, deps, decide, render, log, workerId);
    counts[outcome] += 1;
  }

  const durationMs = Date.now() - started;
  log({ event: "cycle_completed", workerId, durationMs, counts });
  return {
    workerId,
    status: "ok",
    claimed: items.length,
    durationMs,
    counts,
  };
}

// ============================================================
// processItem
// ============================================================

async function processItem(
  item: ClaimedItem,
  deps: TestCycleDeps,
  decide: typeof decideConversation,
  render: typeof renderResponse,
  log: TestServiceLogger,
  workerId: string,
): Promise<ItemOutcome> {
  log({
    event: "item_started",
    workerId,
    queueItemId: item.queueId,
    messageId: item.messageId,
    contactId: item.contactId,
    provider: item.provider,
    instanceId: item.instanceId,
    orchestratorMode: item.orchestratorMode,
  });

  // Gate defensivo: só processamos texto. Claim atual já filtra, mas o
  // tipo permite qualquer string.
  if (item.messageType !== "text") {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }

  // ---------- 1ª rodada ----------
  const ctx1 = await runContext(item, deps, log, workerId);
  if (ctx1.kind !== "ok") return ctx1.outcome;

  const text1 = await runMessageText(item, deps, log, workerId);
  if (text1.kind !== "ok") return text1.outcome;

  const core1 = runCore(item, ctx1.result, text1.text, deps.clock, decide, log, workerId);
  if (core1.kind !== "ok") {
    return await releaseAs(item, deps, core1.retryKind, core1.reason, core1.outcomeOnRelease, log, workerId);
  }
  const decision1 = core1.decision;

  if (isDeferred(decision1)) {
    log({
      event: "deferred_unsupported",
      workerId,
      queueItemId: item.queueId,
      messageId: item.messageId,
      decisionKind: decision1.decisionKind,
      eventKind: decision1.eventKind,
      reasonCode: "legacy_handoff_unavailable",
      outcome: "deferredUnsupported",
    });
    return "deferredUnsupported";
  }

  const resp1 = buildResponse(decision1, render, log, workerId, item);
  if (resp1.kind !== "ok") {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }

  const apply1 = await runApply(
    item,
    ctx1.result.context.stateVersion,
    decision1,
    resp1.payload,
    deps,
    log,
    workerId,
    1,
  );

  if (apply1.kind !== "conflict") return apply1.outcome;

  // ---------- Recálculo único ----------
  log({ event: "state_conflict_recalculated", workerId, queueItemId: item.queueId });

  const ctx2 = await runContext(item, deps, log, workerId);
  if (ctx2.kind !== "ok") return ctx2.outcome;

  const text2 = await runMessageText(item, deps, log, workerId);
  if (text2.kind !== "ok") return text2.outcome;

  const core2 = runCore(item, ctx2.result, text2.text, deps.clock, decide, log, workerId);
  if (core2.kind !== "ok") {
    return await releaseAs(item, deps, core2.retryKind, core2.reason, core2.outcomeOnRelease, log, workerId);
  }
  const decision2 = core2.decision;

  if (isDeferred(decision2)) {
    log({
      event: "deferred_unsupported",
      workerId,
      queueItemId: item.queueId,
      messageId: item.messageId,
      decisionKind: decision2.decisionKind,
      eventKind: decision2.eventKind,
      reasonCode: "legacy_handoff_unavailable",
      outcome: "deferredUnsupported",
    });
    return "deferredUnsupported";
  }

  const resp2 = buildResponse(decision2, render, log, workerId, item);
  if (resp2.kind !== "ok") {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }

  const apply2 = await runApply(
    item,
    ctx2.result.context.stateVersion,
    decision2,
    resp2.payload,
    deps,
    log,
    workerId,
    2,
  );

  if (apply2.kind === "conflict") {
    return await releaseAs(item, deps, "state_conflict", "state_version_conflict", "conflicted", log, workerId);
  }
  return apply2.outcome;
}

// ============================================================
// helpers
// ============================================================

type ContextOk = { kind: "ok"; result: Extract<LoadContextResult, { kind: "ok" }> };
type ContextFail = { kind: "fail"; outcome: ItemOutcome };

async function runContext(
  item: ClaimedItem,
  deps: TestCycleDeps,
  log: TestServiceLogger,
  workerId: string,
): Promise<ContextOk | ContextFail> {
  let res: LoadContextResult;
  try {
    res = await deps.repository.loadContext(item);
  } catch (err) {
    const category = classifyError(err);
    if (category === "MalformedResponseError" || category === "UnknownReasonError") {
      const outcome = await releaseAs(
        item,
        deps,
        "cancelled",
        "orchestrator_invariant",
        "malformed",
        log,
        workerId,
      );
      return { kind: "fail", outcome };
    }
    log({ event: "item_failed", workerId, queueItemId: item.queueId, errorCategory: category });
    const outcome = await releaseAs(
      item,
      deps,
      "transient_error",
      "load_context_failed",
      "releasedForRetry",
      log,
      workerId,
    );
    return { kind: "fail", outcome };
  }

  if (res.kind === "ok") {
    log({
      event: "context_loaded",
      workerId,
      queueItemId: item.queueId,
      activeVehicleIssue: res.activeVehicleIssue,
    });
    return { kind: "ok", result: res };
  }

  const reason = res.reason;
  if (reason === "lease_lost") {
    log({ event: "lease_lost", workerId, queueItemId: item.queueId, reasonCode: reason });
    return { kind: "fail", outcome: "leaseLost" };
  }
  if (reason === "queue_not_found" || reason === "queue_not_running") {
    log({
      event: "item_failed",
      workerId,
      queueItemId: item.queueId,
      reasonCode: reason,
      outcome: "terminal",
    });
    return { kind: "fail", outcome: "terminal" };
  }
  if (CONTEXT_DEFINITIVE_REASONS.has(reason)) {
    const safeReason = REASON_REGEX.test(reason) ? reason : "orchestrator_invariant";
    const outcome = await releaseAs(item, deps, "cancelled", safeReason, "contextRejected", log, workerId);
    return { kind: "fail", outcome };
  }
  const outcome = await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  return { kind: "fail", outcome };
}

type TextOk = { kind: "ok"; text: string };
type TextFail = { kind: "fail"; outcome: ItemOutcome };

async function runMessageText(
  item: ClaimedItem,
  deps: TestCycleDeps,
  log: TestServiceLogger,
  workerId: string,
): Promise<TextOk | TextFail> {
  let text: unknown;
  try {
    text = await deps.loadMessageText(item.messageId);
  } catch (err) {
    log({ event: "item_failed", workerId, queueItemId: item.queueId, errorCategory: classifyError(err) });
    const outcome = await releaseAs(
      item,
      deps,
      "transient_error",
      "message_text_load_failed",
      "releasedForRetry",
      log,
      workerId,
    );
    return { kind: "fail", outcome };
  }

  if (text === null) {
    const outcome = await releaseAs(item, deps, "cancelled", "message_text_missing", "contextRejected", log, workerId);
    return { kind: "fail", outcome };
  }
  if (typeof text !== "string") {
    const outcome = await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
    return { kind: "fail", outcome };
  }
  if (text.trim().length === 0) {
    const outcome = await releaseAs(item, deps, "cancelled", "message_text_missing", "contextRejected", log, workerId);
    return { kind: "fail", outcome };
  }
  return { kind: "ok", text };
}

type CoreOk = { kind: "ok"; decision: ConversationCoreDecision };
type CoreFail = {
  kind: "fail";
  retryKind: ReleaseInput["retryKind"];
  reason: string;
  outcomeOnRelease: ItemOutcome;
};

function runCore(
  item: ClaimedItem,
  ctx: Extract<LoadContextResult, { kind: "ok" }>,
  text: string,
  clock: () => string,
  decide: typeof decideConversation,
  log: TestServiceLogger,
  workerId: string,
): CoreOk | CoreFail {
  const coreInput: ConversationCoreInput = {
    sourceMessageId: item.messageId,
    messageType: "text",
    originalText: text,
    now: clock(),
    state: ctx.context.state,
    vehicles: ctx.context.vehicles,
    fallbackCount: ctx.context.fallbackCount,
    isReplay: false,
  };
  let decision: ConversationCoreDecision;
  try {
    decision = decide(coreInput);
  } catch (err) {
    log({ event: "item_failed", workerId, queueItemId: item.queueId, errorCategory: classifyError(err) });
    return {
      kind: "fail",
      retryKind: "transient_error",
      reason: "core_execution_failed",
      outcomeOnRelease: "releasedForRetry",
    };
  }
  log({
    event: "decision_computed",
    workerId,
    queueItemId: item.queueId,
    decisionKind: decision.decisionKind,
    eventKind: decision.eventKind,
    responseKey: decision.responseKey,
    reasonCode: decision.reasonCode,
  });
  return { kind: "ok", decision };
}

type ResponseOk = { kind: "ok"; payload: OutboundResponsePayload | null };
type ResponseFail = { kind: "fail" };

function buildResponse(
  decision: ConversationCoreDecision,
  render: typeof renderResponse,
  log: TestServiceLogger,
  workerId: string,
  item: ClaimedItem,
): ResponseOk | ResponseFail {
  if (decision.responseKey === null) return { kind: "ok", payload: null };
  const key: ConversationResponseKey = decision.responseKey;
  const params: ConversationResponseParams = decision.responseParams;
  let text: unknown;
  try {
    text = render(key, params);
  } catch (err) {
    log({
      event: "item_failed",
      workerId,
      queueItemId: item.queueId,
      errorCategory: classifyError(err),
      reasonCode: "render_failed",
    });
    return { kind: "fail" };
  }
  if (typeof text !== "string" || text.length === 0 || text.length > 4000) {
    log({
      event: "item_failed",
      workerId,
      queueItemId: item.queueId,
      reasonCode: "render_invalid_output",
    });
    return { kind: "fail" };
  }
  log({ event: "response_rendered", workerId, queueItemId: item.queueId, responseKey: key });
  return {
    kind: "ok",
    payload: {
      responseKey: key,
      messageType: "text",
      purpose: "general",
      textBody: text,
    },
  };
}

type ApplyOutcome =
  | { kind: "terminal"; outcome: ItemOutcome }
  | { kind: "conflict" };

async function runApply(
  item: ClaimedItem,
  expectedStateVersion: number,
  decision: ConversationCoreDecision,
  response: OutboundResponsePayload | null,
  deps: TestCycleDeps,
  log: TestServiceLogger,
  workerId: string,
  attempt: number,
): Promise<ApplyOutcome> {
  const transitionInput: TransitionInput = {
    queueItemId: item.queueId,
    leaseToken: item.leaseToken,
    expectedStateVersion,
    patch: decision.statePatch,
    orchestratorVersion: deps.orchestratorVersion,
    resultSummary: {
      decisionKind: decision.decisionKind,
      eventKind: decision.eventKind,
      outcome: decision.outcome,
    },
    response,
  };

  let res: TransitionResult;
  try {
    res = await deps.repository.applyTransition(transitionInput);
  } catch (err) {
    log({
      event: "outcome_unknown",
      workerId,
      queueItemId: item.queueId,
      attemptNumber: attempt,
      errorCategory: classifyError(err),
    });
    return { kind: "terminal", outcome: "outcomeUnknown" };
  }

  if (res.ok === true) {
    if (res.wasReplay === true) {
      log({ event: "transition_replayed", workerId, queueItemId: item.queueId, attemptNumber: attempt });
      return { kind: "terminal", outcome: "replayed" };
    }
    log({ event: "transition_applied", workerId, queueItemId: item.queueId, attemptNumber: attempt });
    return { kind: "terminal", outcome: "completed" };
  }

  const reason = res.reason;
  if (reason === "state_version_conflict") return { kind: "conflict" };
  if (reason === "queue_already_terminal" || reason === "queue_item_not_found") {
    log({
      event: "item_failed",
      workerId,
      queueItemId: item.queueId,
      reasonCode: reason,
      outcome: "terminal",
    });
    return { kind: "terminal", outcome: "terminal" };
  }
  if (reason === "lease_lost") {
    log({ event: "lease_lost", workerId, queueItemId: item.queueId, reasonCode: reason });
    return { kind: "terminal", outcome: "leaseLost" };
  }
  if (reason === "idempotency_payload_mismatch") {
    log({
      event: "item_failed",
      workerId,
      queueItemId: item.queueId,
      reasonCode: reason,
      outcome: "conflicted",
    });
    return { kind: "terminal", outcome: "conflicted" };
  }
  if (APPLY_CONTEXT_REASONS.has(reason)) {
    const safeReason = REASON_REGEX.test(reason) ? reason : "orchestrator_invariant";
    const outcome = await releaseAs(item, deps, "cancelled", safeReason, "contextRejected", log, workerId);
    return { kind: "terminal", outcome };
  }
  if (APPLY_INVARIANT_REASONS.has(reason)) {
    const outcome = await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
    return { kind: "terminal", outcome };
  }
  const outcome = await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  return { kind: "terminal", outcome };
}

// ============================================================
// release helper — no máximo 1 chamada por item
// ============================================================

async function releaseAs(
  item: ClaimedItem,
  deps: TestCycleDeps,
  retryKind: ReleaseInput["retryKind"],
  reason: string,
  outcomeOnSuccess: ItemOutcome,
  log: TestServiceLogger,
  workerId: string,
): Promise<ItemOutcome> {
  const safeReason = REASON_REGEX.test(reason) ? reason : "orchestrator_invariant";
  let res: ReleaseResult;
  try {
    res = await deps.repository.releaseItem({
      queueItemId: item.queueId,
      leaseToken: item.leaseToken,
      reason: safeReason,
      retryKind,
    });
  } catch (err) {
    log({
      event: "item_failed",
      workerId,
      queueItemId: item.queueId,
      errorCategory: classifyError(err),
      reasonCode: "release_failed",
    });
    return "transientFailure";
  }
  log({
    event: "item_released",
    workerId,
    queueItemId: item.queueId,
    reasonCode: safeReason,
    ok: res.ok,
  });
  if (!res.ok) return "transientFailure";
  return outcomeOnSuccess;
}
