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
import { mapConversationDecisionToTransitionInput } from "./transition-mapper.ts";
import { RepositoryError } from "./errors.ts";
import type {
  ConversationCoreDecision,
  ConversationCoreInput,
  ConversationResponseKey,
  ConversationResponseParams,
} from "../conversation/types.ts";
import type { ConfirmedKmUpdateDeps, ConfirmedKmUpdateInput } from "../actions/types.ts";
import { executeConfirmedKmUpdate } from "../actions/service.ts";
import { validateAwaitingConfirmationKmUpdateDraft } from "../conversation/km-update-draft.ts";
import type {
  ConfirmedExpenseCreateDeps,
  ConfirmedExpenseCreateInput,
} from "../actions/expense-types.ts";
import { executeConfirmedExpenseCreate } from "../actions/expense-service.ts";
import { validateAwaitingConfirmationExpenseDraft } from "../conversation/expense-create-draft.ts";
import { decideConversation } from "../conversation/core.ts";
import { renderResponse } from "../conversation/responses.ts";
import { canVehiclePerformFullAction } from "../conversation/vehicle-access-policy.ts";
import {
  buildFinalDescricao,
  buildKmVehicleLabel,
  buildKmFinalization,
  buildExpenseFinalization,
  type KmFinalization,
  type ExpenseFinalization,
} from "./action-finalization.ts";

export {
  buildFinalDescricao,
  buildKmVehicleLabel,
  buildKmFinalization,
  buildExpenseFinalization,
  type KmFinalization,
  type ExpenseFinalization,
};

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

// Ponto de extensão opcional do C8 — bifurcação para o Dr. Jarvys
// (conversation-handoff/, C1-C7) quando o core determinístico chega em
// fallback_second. test-service.ts NUNCA importa nada de
// conversation-handoff/ diretamente: a implementação real desta
// dependência (que chamaria executeConversationHandoffEntrypoint de
// verdade) é responsabilidade de quem conectar o C7 ao runtime — Fase 18,
// fora do escopo deste build.
export type ConversationHandoffFallbackParams = Readonly<{
  sourceMessageId: string;
  contactId: string;
  userId: string;
  vehicleId: string | null;
  originalText: string;
}>;

export type ConversationHandoffFallbackOutcome =
  | "blocked_authorization_required"
  | "blocked_vehicle_required"
  | "primary_succeeded"
  | "primary_failed"
  | "completed"
  | "partially_completed"
  | "uncertain";

export type ConversationHandoffFallbackResult = Readonly<{
  // true = já enfileirou a resposta sozinho (via C6) — test-service NÃO
  // deve construir response própria para este item.
  handled: boolean;
  // só para log/observabilidade — nunca usado para ramificar lógica além
  // do reset (ou não) da contagem de fallback.
  outcome?: ConversationHandoffFallbackOutcome;
}>;

export type TestCycleDeps = {
  repository: OrchestratorRepositoryPort;
  loadMessageText: (messageId: string) => Promise<string | null>;
  decide?: typeof decideConversation;
  render?: typeof renderResponse;
  clock: () => string;
  orchestratorVersion: string;
  kmActionDeps: ConfirmedKmUpdateDeps;
  expenseActionDeps: ConfirmedExpenseCreateDeps;
  logger?: TestServiceLogger;
  conversationHandoffFallback?: (
    params: ConversationHandoffFallbackParams,
  ) => Promise<ConversationHandoffFallbackResult>;
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
  | "conversation_handoff_attempted"
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

// Outcomes do handoff que contam como "o Dr. Jarvys resolveu de verdade" —
// só nesses casos a contagem de fallback é resetada. blocked_*,
// primary_failed e uncertain continuam contando como uma falha normal do
// ponto de vista da conversa determinística (o usuário não foi atendido).
const CONVERSATION_HANDOFF_RESET_OUTCOMES: ReadonlySet<ConversationHandoffFallbackOutcome> =
  new Set(["primary_succeeded", "completed", "partially_completed"]);

// I6 — chaves de resposta que disparam a bifurcação opcional pro Dr.
// Jarvys. "fallback_second" é o gatilho original do C8 (core
// determinístico esgotou 2 tentativas). "expense_quote_acknowledged"/
// "expense_technical_question_acknowledged" são o gatilho novo do I6
// (Opção C, já fechada): perguntas confiantes e imediatas vão direto,
// sem esperar fallback nenhum. "expense_future_service_acknowledged"
// fica DE FORA de propósito — é uma afirmação de intenção futura, não
// uma pergunta esperando resposta, não vale gastar uma chamada de IA.
const DIRECT_ROUTE_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "fallback_second",
  "expense_quote_acknowledged",
  "expense_technical_question_acknowledged",
]);

// C8 — bifurcação opcional para o Dr. Jarvys (C7) quando o core
// determinístico decide fallback_second (esgotou 2 tentativas), OU
// (I6) quando decide uma das perguntas confiantes e imediatas listadas
// em DIRECT_ROUTE_RESPONSE_KEYS. Só chama deps.conversationHandoffFallback
// quando: responseKey está em DIRECT_ROUTE_RESPONSE_KEYS, a dependência foi
// injetada, e item.userId não é null (fail-closed: sem userId, nem
// tenta). Qualquer erro da dependência é capturado e NUNCA propaga —
// o item segue o fluxo normal com a decisão original, como se a
// dependência não tivesse sido chamada.
//
// IMPORTANTE (achado do checkpoint, não uma decisão deste build): o reset
// da contagem de fallback usa o campo `nextFallbackCount` — TOP-LEVEL na
// ConversationCoreDecision, NUNCA dentro de statePatch. ConversationStatePatch
// (conversation/types.ts) não tem nenhum campo de fallback count; a RPC
// aceita uma chave `fallback_count` no patch (repository.ts,
// RPC_PATCH_KEYS_ALLOWED), mas nada em PATCH_KEY_MAP/transition-mapper.ts
// jamais copia decision.nextFallbackCount para dentro do patch — ou seja,
// hoje `nextFallbackCount` computado pelo core (e por este handoff) NUNCA
// chega a ser persistido em whatsapp_conversation_states.fallback_count.
// Essa é uma lacuna real, pré-existente, fora do escopo deste build
// (exigiria tocar em repository.ts/transition-mapper.ts, ambos
// protegidos) — setamos nextFallbackCount corretamente no nível da
// decisão mesmo assim, para que o campo já exista e esteja correto no
// dia em que essa lacuna for endereçada em outro build.
// Exportada (só para teste direto): o efeito de nextFallbackCount sobre a
// decisão retornada não é observável via runWhatsappOrchestratorTestCycle
// no estado atual do pipeline (mapConversationDecisionToTransitionInput
// nunca lê decision.nextFallbackCount — ver comentário acima e o
// checkpoint deste build). Exportar esta função pura permite testar
// diretamente, sem depender de um efeito colateral que hoje não existe.
export async function tryConversationHandoffFallback(
  item: ClaimedItem,
  ctx: Extract<LoadContextResult, { kind: "ok" }>,
  text: string,
  decision: ConversationCoreDecision,
  deps: TestCycleDeps,
  log: TestServiceLogger,
  workerId: string,
): Promise<ConversationCoreDecision> {
  if (!DIRECT_ROUTE_RESPONSE_KEYS.has(decision.responseKey ?? "")) return decision;
  if (deps.conversationHandoffFallback === undefined) return decision;
  if (item.userId === null) return decision;

  try {
    const result = await deps.conversationHandoffFallback({
      sourceMessageId: item.messageId,
      contactId: item.contactId,
      userId: item.userId,
      vehicleId: ctx.context.state.activeVehicleId,
      originalText: text,
    });

    log({
      event: "conversation_handoff_attempted",
      workerId,
      queueItemId: item.queueId,
      messageId: item.messageId,
      contactId: item.contactId,
      ok: result.handled,
      ...(result.outcome !== undefined ? { reasonCode: result.outcome } : {}),
    });

    if (result.handled !== true) return decision;

    const shouldReset =
      result.outcome !== undefined && CONVERSATION_HANDOFF_RESET_OUTCOMES.has(result.outcome);

    const handoffDecision: ConversationCoreDecision = {
      ...decision,
      responseKey: null,
      responseParams: {},
      ...(shouldReset ? { nextFallbackCount: 0 } : {}),
    };
    return handoffDecision;
  } catch (err) {
    log({
      event: "item_failed",
      workerId,
      queueItemId: item.queueId,
      errorCategory: classifyError(err),
      reasonCode: "conversation_handoff_failed",
    });
    return decision;
  }
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

  if (decision1.decisionKind === "confirm_km_update") {
    return await handleConfirmKmUpdate(item, ctx1.result, deps, render, log, workerId, 1);
  }

  if (decision1.decisionKind === "confirm_expense_create") {
    return await handleConfirmExpenseCreate(item, ctx1.result, deps, render, log, workerId, 1);
  }

  const effectiveDecision1 = await tryConversationHandoffFallback(
    item,
    ctx1.result,
    text1.text,
    decision1,
    deps,
    log,
    workerId,
  );

  const resp1 = buildResponse(effectiveDecision1, render, log, workerId, item);
  if (resp1.kind !== "ok") {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }

  const apply1 = await runApply(
    item,
    ctx1.result.context.stateVersion,
    effectiveDecision1,
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

  if (decision2.decisionKind === "confirm_km_update") {
    return await handleConfirmKmUpdate(item, ctx2.result, deps, render, log, workerId, 2);
  }

  if (decision2.decisionKind === "confirm_expense_create") {
    return await handleConfirmExpenseCreate(item, ctx2.result, deps, render, log, workerId, 2);
  }

  const effectiveDecision2 = await tryConversationHandoffFallback(
    item,
    ctx2.result,
    text2.text,
    decision2,
    deps,
    log,
    workerId,
  );

  const resp2 = buildResponse(effectiveDecision2, render, log, workerId, item);
  if (resp2.kind !== "ok") {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }

  const apply2 = await runApply(
    item,
    ctx2.result.context.stateVersion,
    effectiveDecision2,
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

async function finalizeRestrictedVehicleHandoff(
  item: ClaimedItem,
  ctx: Extract<LoadContextResult, { kind: "ok" }>,
  vehicleId: string,
  deps: TestCycleDeps,
  render: typeof renderResponse,
  log: TestServiceLogger,
  workerId: string,
  attempt: number,
): Promise<ItemOutcome> {
  const decision: ConversationCoreDecision = {
    eventKind: "confirm",
    decisionKind: "respond",
    previousState: ctx.context.state.state,
    nextState: "idle",
    outcome: "cancelled",
    statePatch: {
      state: "idle",
      currentIntent: null,
      awaitingField: null,
      requestSource: null,
      draftType: null,
      draftId: null,
      draftVersion: null,
      draftPayload: null,
      confirmedAt: null,
      executedAt: null,
      expiresAt: null,
      ...(ctx.context.state.activeVehicleId === vehicleId ? { activeVehicleId: null } : {}),
      lastMessageId: item.messageId,
    },
    responseKey: "vehicle_access_restricted",
    responseParams: {},
    nextFallbackCount: 0,
    deferToLegacyRouter: false,
    deferToLegacyOptOut: false,
    reasonCode: "vehicle_access_restricted",
  };
  const response = buildResponse(decision, render, log, workerId, item);
  if (response.kind !== "ok") {
    return await releaseAs(
      item,
      deps,
      "cancelled",
      "orchestrator_invariant",
      "malformed",
      log,
      workerId,
    );
  }
  const applied = await runApply(
    item,
    ctx.context.stateVersion,
    decision,
    response.payload,
    deps,
    log,
    workerId,
    attempt,
  );
  if (applied.kind === "conflict") {
    return await releaseAs(
      item,
      deps,
      "state_conflict",
      "state_version_conflict",
      "conflicted",
      log,
      workerId,
    );
  }
  return applied.outcome;
}

async function handleConfirmKmUpdate(
  item: ClaimedItem,
  ctx: Extract<LoadContextResult, { kind: "ok" }>,
  deps: TestCycleDeps,
  render: typeof renderResponse,
  log: TestServiceLogger,
  workerId: string,
  attempt: number,
): Promise<ItemOutcome> {
  const draftCheck = validateAwaitingConfirmationKmUpdateDraft(ctx.context.state.draftPayload);
  if (!draftCheck.ok) {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }
  const draft = draftCheck.value;
  const conversationStateId = ctx.context.conversationStateId;
  const draftId = ctx.context.state.draftId;
  const userId = item.userId;
  if (conversationStateId === null || draftId === null || userId === null) {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }
  const kmInput: ConfirmedKmUpdateInput = {
    draftId,
    conversationStateId,
    confirmationMessageId: item.messageId,
    sourceMessageId: draft.requestMessageId,
    queueItemId: item.queueId,
    userId,
    contactId: item.contactId,
    vehicleId: draft.vehicleId,
    expectedPreviousKm: draft.expectedPreviousKm,
    newKm: draft.newKm,
    correctionConfirmed: true,
    expectedStateVersion: ctx.context.stateVersion,
    orchestratorVersion: deps.orchestratorVersion,
    // Build 6c/9 do item 6 — carrega adiante o ID da despesa (se houver)
    // que o build 6a já preserva no draft. Ausente em km avulsa (item 1).
    ...(draft.linkedExpenseId !== undefined
      ? { linkedDespesaId: draft.linkedExpenseId }
      : {}),
  };
  const vehicle = ctx.context.vehicles.find((candidate) => candidate.id === draft.vehicleId);
  if (!canVehiclePerformFullAction(vehicle)) {
    return await finalizeRestrictedVehicleHandoff(
      item,
      ctx,
      draft.vehicleId,
      deps,
      render,
      log,
      workerId,
      attempt,
    );
  }
  const kmResult = await executeConfirmedKmUpdate(kmInput, deps.kmActionDeps);
  const finalization = buildKmFinalization(kmResult, ctx, draft.vehicleId);
  if (finalization.kind === "retry") {
    return await releaseAs(item, deps, "transient_error", "km_action_transient", "releasedForRetry", log, workerId);
  }
  if (finalization.kind === "invariant") {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }
  const resp = buildResponse(finalization.decision, render, log, workerId, item);
  if (resp.kind !== "ok") {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }
  const applyResult = await runApply(
    item,
    ctx.context.stateVersion,
    finalization.decision,
    resp.payload,
    deps,
    log,
    workerId,
    attempt,
  );
  if (applyResult.kind === "conflict") {
    return await releaseAs(item, deps, "state_conflict", "state_version_conflict", "conflicted", log, workerId);
  }
  return applyResult.outcome;
}

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
  let transitionInput: TransitionInput;
  try {
    transitionInput = mapConversationDecisionToTransitionInput({
      decision,
      queueItemId: item.queueId,
      leaseToken: item.leaseToken,
      expectedStateVersion,
      orchestratorVersion: deps.orchestratorVersion,
      response,
    });
  } catch (err) {
    log({
      event: "item_failed",
      workerId,
      queueItemId: item.queueId,
      reasonCode: "transition_mapping_failed",
      errorCategory: err instanceof RepositoryError ? err.code : classifyError(err),
    });
    const outcome = await releaseAs(
      item,
      deps,
      "cancelled",
      "orchestrator_invariant",
      "malformed",
      log,
      workerId,
    );
    return { kind: "terminal", outcome };
  }


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

async function handleConfirmExpenseCreate(
  item: ClaimedItem,
  ctx: Extract<LoadContextResult, { kind: "ok" }>,
  deps: TestCycleDeps,
  render: typeof renderResponse,
  log: TestServiceLogger,
  workerId: string,
  attempt: number,
): Promise<ItemOutcome> {
  const draftCheck = validateAwaitingConfirmationExpenseDraft(ctx.context.state.draftPayload);
  if (!draftCheck.ok) {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }
  const draft = draftCheck.value;
  const conversationStateId = ctx.context.conversationStateId;
  const draftId = ctx.context.state.draftId;
  const userId = item.userId;
  if (conversationStateId === null || draftId === null || userId === null) {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }
  const expenseInput: ConfirmedExpenseCreateInput = {
    draftId,
    conversationStateId,
    confirmationMessageId: item.messageId,
    sourceMessageId: draft.requestMessageId,
    queueItemId: item.queueId,
    userId,
    contactId: item.contactId,
    vehicleId: draft.vehicleId,
    categoria: draft.categoria,
    valor: draft.valor,
    descricao: buildFinalDescricao(
      "descricao" in draft ? draft.descricao : null,
      "recognizedTags" in draft ? draft.recognizedTags : undefined,
    ),
    expectedStateVersion: ctx.context.stateVersion,
    orchestratorVersion: deps.orchestratorVersion,
  };
  const vehicle = ctx.context.vehicles.find((candidate) => candidate.id === draft.vehicleId);
  if (!canVehiclePerformFullAction(vehicle)) {
    return await finalizeRestrictedVehicleHandoff(
      item,
      ctx,
      draft.vehicleId,
      deps,
      render,
      log,
      workerId,
      attempt,
    );
  }
  const expenseResult = await executeConfirmedExpenseCreate(expenseInput, deps.expenseActionDeps);
  const finalization = buildExpenseFinalization(expenseResult, ctx, draft.vehicleId);
  if (finalization.kind === "retry") {
    return await releaseAs(item, deps, "transient_error", "expense_action_transient", "releasedForRetry", log, workerId);
  }
  if (finalization.kind === "invariant") {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }
  const resp = buildResponse(finalization.decision, render, log, workerId, item);
  if (resp.kind !== "ok") {
    return await releaseAs(item, deps, "cancelled", "orchestrator_invariant", "malformed", log, workerId);
  }
  const applyResult = await runApply(
    item,
    ctx.context.stateVersion,
    finalization.decision,
    resp.payload,
    deps,
    log,
    workerId,
    attempt,
  );
  if (applyResult.kind === "conflict") {
    return await releaseAs(item, deps, "state_conflict", "state_version_conflict", "conflicted", log, workerId);
  }
  return applyResult.outcome;
}
