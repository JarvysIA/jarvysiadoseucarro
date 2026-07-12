// Build 5.7F2A — Núcleo determinístico do orquestrador WhatsApp.
// Puro: sem Supabase, sem Deno, sem fetch, sem Date.now, sem logs, sem I/O.
// Recebe entrada estruturada e devolve uma decisão estruturada.

import type {
  ConversationCoreDecision,
  ConversationCoreInput,
  ConversationDecisionKind,
  ConversationEventKind,
  ConversationOutcome,
  ConversationResponseKey,
  ConversationResponseParams,
  ConversationState,
  ConversationStateName,
  ConversationStatePatch,
  ConversationVehicle,
} from "./types.ts";
import { normalizeCommandText } from "./normalize.ts";
import { classifyCommand } from "./commands.ts";
import { resolveVehicle, vehicleLabel } from "./vehicles.ts";
import { parseKmUpdateText } from "./km-update-parser.ts";
import {
  KM_UPDATE_COMPLETE_DRAFT_VERSION,
  KM_UPDATE_PARTIAL_DRAFT_VERSION,
  validateAwaitingConfirmationKmUpdateDraft,
  validateAwaitingVehicleKmUpdateDraft,
} from "./km-update-draft.ts";
import { KM_REPORTED_EVENT_KIND } from "./km-update-protocol.ts";

const CLEAR_TASK_PATCH: ConversationStatePatch = {
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
};

function isExpired(state: ConversationState, nowIso: string): boolean {
  if (!state.expiresAt) return false;
  const exp = Date.parse(state.expiresAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(exp) || !Number.isFinite(now)) return false;
  return exp <= now;
}

function buildDecision(args: {
  eventKind: ConversationEventKind;
  decisionKind: ConversationDecisionKind;
  previousState: ConversationStateName;
  nextState: ConversationStateName;
  outcome?: ConversationOutcome;
  statePatch?: ConversationStatePatch;
  responseKey?: ConversationResponseKey | null;
  responseParams?: ConversationResponseParams;
  nextFallbackCount: number;
  deferToLegacyRouter?: boolean;
  deferToLegacyOptOut?: boolean;
  reasonCode: string;
}): ConversationCoreDecision {
  return {
    eventKind: args.eventKind,
    decisionKind: args.decisionKind,
    previousState: args.previousState,
    nextState: args.nextState,
    outcome: args.outcome ?? "none",
    statePatch: args.statePatch ?? {},
    responseKey: args.responseKey ?? null,
    responseParams: args.responseParams ?? {},
    nextFallbackCount: args.nextFallbackCount,
    deferToLegacyRouter: args.deferToLegacyRouter ?? false,
    deferToLegacyOptOut: args.deferToLegacyOptOut ?? false,
    reasonCode: args.reasonCode,
  };
}

function hasPendingDraft(state: ConversationState): boolean {
  return (
    state.state === "awaiting_vehicle" ||
    state.draftId !== null ||
    state.awaitingField !== null ||
    state.currentIntent !== null
  );
}

function mergePatch(
  base: ConversationStatePatch,
  extra: ConversationStatePatch,
): ConversationStatePatch {
  return { ...base, ...extra };
}

const MEDIA_TYPES = new Set<string>(["image", "pdf", "audio", "video", "file", "document"]);

/**
 * Aplica idempotente do sourceMessageId em lastMessageId no patch final.
 */
function withLastMessage(
  patch: ConversationStatePatch,
  sourceMessageId: string,
): ConversationStatePatch {
  return { ...patch, lastMessageId: sourceMessageId };
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function firstEligible(vehicles: ConversationVehicle[]): ConversationVehicle[] {
  return vehicles.filter((v) => v.isEligible && !v.isArchived);
}

function labelFor(v: ConversationVehicle): string {
  return vehicleLabel(v);
}

/**
 * Extrai draft parcial de km_update do state atual, se e somente se todas as
 * invariantes forem verdadeiras: draftType km_update, versão 0, draftId UUID,
 * payload válido e draftId === payload.requestMessageId.
 */
function extractPartialKmDraft(
  state: ConversationState,
): { newKm: number; requestMessageId: string } | null {
  if (state.draftType !== "km_update") return null;
  if (state.draftVersion !== KM_UPDATE_PARTIAL_DRAFT_VERSION) return null;
  if (!isUuid(state.draftId)) return null;
  const v = validateAwaitingVehicleKmUpdateDraft(state.draftPayload);
  if (!v.ok) return null;
  if (v.value.requestMessageId !== state.draftId) return null;
  return { newKm: v.value.newKm, requestMessageId: v.value.requestMessageId };
}

export function decideConversation(
  input: ConversationCoreInput,
): ConversationCoreDecision {
  const previousState = input.state.state;
  const fallbackCount = Math.max(0, Math.floor(input.fallbackCount ?? 0));

  // 1) Validação básica de input
  if (!input.sourceMessageId) {
    return buildDecision({
      eventKind: "unknown",
      decisionKind: "no_op",
      previousState,
      nextState: previousState,
      nextFallbackCount: fallbackCount,
      reasonCode: "invalid_input_missing_source_message_id",
    });
  }

  // 2) Replay (idempotência informada externamente)
  if (input.isReplay === true) {
    return buildDecision({
      eventKind: "replay",
      decisionKind: "no_op",
      previousState,
      nextState: previousState,
      nextFallbackCount: fallbackCount,
      reasonCode: "replay_detected_by_caller",
    });
  }

  // 3) Expiração: se expirado, aplicar reset de tarefa (preservando veículo)
  // e continuar roteando a mensagem atual sobre o state "virtual" já limpo.
  let effectiveState: ConversationState = input.state;
  let basePatch: ConversationStatePatch = {};
  let expiredOutcome: ConversationOutcome = "none";
  let expiredHandled = false;
  if (isExpired(input.state, input.now)) {
    effectiveState = {
      ...input.state,
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
    };
    basePatch = mergePatch(basePatch, { ...CLEAR_TASK_PATCH, state: "idle" });
    expiredOutcome = "expired";
    expiredHandled = true;
  }

  // 4) Mídia — defer para roteador legado
  if (MEDIA_TYPES.has(input.messageType)) {
    return buildDecision({
      eventKind: "media",
      decisionKind: "defer_legacy_media",
      previousState,
      nextState: effectiveState.state,
      outcome: expiredOutcome,
      statePatch: basePatch, // nunca grava lastMessageId (defer)
      responseKey: null,
      nextFallbackCount: fallbackCount,
      deferToLegacyRouter: true,
      reasonCode: expiredHandled ? "expired_then_media" : "media_deferred_to_legacy",
    });
  }

  // Somente texto (ou tipo desconhecido / system) daqui em diante
  const normalized = normalizeCommandText(input.originalText);

  // 4.1) Explicit opt-out (match exato) — defer para roteador legado
  const command = classifyCommand(normalized);
  if (command === "explicit_opt_out") {
    return buildDecision({
      eventKind: "explicit_opt_out",
      decisionKind: "defer_legacy_opt_out",
      previousState,
      nextState: effectiveState.state,
      outcome: expiredOutcome,
      statePatch: basePatch,
      responseKey: null,
      nextFallbackCount: 0,
      deferToLegacyOptOut: true,
      reasonCode: expiredHandled ? "expired_then_opt_out" : "explicit_opt_out",
    });
  }

  // 5) Cancelamento / reset explícito
  if (command === "cancel_task") {
    if (hasPendingDraft(effectiveState)) {
      return buildDecision({
        eventKind: "cancel_task",
        decisionKind: "reset_task",
        previousState,
        nextState: "idle",
        outcome: "cancelled",
        statePatch: withLastMessage(
          mergePatch(basePatch, { ...CLEAR_TASK_PATCH, state: "idle" }),
          input.sourceMessageId,
        ),
        responseKey: "task_cancelled",
        nextFallbackCount: 0,
        reasonCode: "cancel_task_with_pending",
      });
    }
    return buildDecision({
      eventKind: "cancel_task",
      decisionKind: "respond",
      previousState,
      nextState: effectiveState.state,
      outcome: expiredOutcome,
      statePatch: withLastMessage(basePatch, input.sourceMessageId),
      responseKey: "nothing_to_cancel",
      nextFallbackCount: 0,
      reasonCode: "cancel_task_without_pending",
    });
  }

  if (command === "reset_conversation") {
    return buildDecision({
      eventKind: "reset_conversation",
      decisionKind: "reset_conversation",
      previousState,
      nextState: "idle",
      outcome: expiredOutcome === "expired" ? "expired" : "cancelled",
      statePatch: withLastMessage(
        mergePatch(basePatch, {
          ...CLEAR_TASK_PATCH,
          state: "idle",
          activeVehicleId: null,
        }),
        input.sourceMessageId,
      ),
      responseKey: "conversation_reset",
      nextFallbackCount: 0,
      reasonCode: "reset_conversation_requested",
    });
  }

  // 6) Resposta a state pendente (awaiting_vehicle) — antes de confirm/help/greeting
  if (effectiveState.state === "awaiting_vehicle") {
    // Se o texto for uma confirmação/negação/greeting isolada, o resolver
    // provavelmente falhará; deixamos o vehicle resolver decidir.
    const resolved = resolveVehicle({
      text: input.originalText,
      vehicles: input.vehicles,
      activeVehicleId: effectiveState.activeVehicleId,
    });
    if (resolved.kind === "matched") {
      return buildDecision({
        eventKind: "vehicle_reply",
        decisionKind: "select_vehicle",
        previousState,
        nextState: "idle",
        outcome: "completed",
        statePatch: withLastMessage(
          mergePatch(basePatch, {
            ...CLEAR_TASK_PATCH,
            state: "idle",
            activeVehicleId: resolved.vehicle.id,
          }),
          input.sourceMessageId,
        ),
        responseKey: "vehicle_selected",
        responseParams: { vehicleLabel: vehicleLabel(resolved.vehicle) },
        nextFallbackCount: 0,
        reasonCode: "awaiting_vehicle_matched",
      });
    }
    if (resolved.kind === "ambiguous") {
      return buildDecision({
        eventKind: "vehicle_reply",
        decisionKind: "respond",
        previousState,
        nextState: "awaiting_vehicle",
        statePatch: withLastMessage(basePatch, input.sourceMessageId),
        responseKey: "vehicle_ambiguous",
        responseParams: { options: resolved.options },
        nextFallbackCount: 0,
        reasonCode: "awaiting_vehicle_ambiguous",
      });
    }
    if (resolved.kind === "no_eligible_vehicle") {
      return buildDecision({
        eventKind: "vehicle_reply",
        decisionKind: "respond",
        previousState,
        nextState: "idle",
        outcome: "completed",
        statePatch: withLastMessage(
          mergePatch(basePatch, { ...CLEAR_TASK_PATCH, state: "idle" }),
          input.sourceMessageId,
        ),
        responseKey: "no_eligible_vehicle",
        nextFallbackCount: 0,
        reasonCode: "awaiting_vehicle_no_eligible",
      });
    }
    // not_found
    return buildDecision({
      eventKind: "vehicle_reply",
      decisionKind: "respond",
      previousState,
      nextState: "awaiting_vehicle",
      statePatch: withLastMessage(basePatch, input.sourceMessageId),
      responseKey: "vehicle_not_found",
      nextFallbackCount: 0,
      reasonCode: "awaiting_vehicle_not_found",
    });
  }

  // 7) Confirmação / negação
  if (command === "confirm") {
    // Nenhuma pendência real neste build (awaiting_vehicle já capturado acima).
    return buildDecision({
      eventKind: "confirm",
      decisionKind: "respond",
      previousState,
      nextState: effectiveState.state,
      outcome: expiredOutcome,
      statePatch: withLastMessage(basePatch, input.sourceMessageId),
      responseKey: "nothing_to_confirm",
      nextFallbackCount: 0,
      reasonCode: expiredHandled
        ? "expired_then_confirm_without_pending"
        : "confirm_without_pending",
    });
  }
  if (command === "deny") {
    return buildDecision({
      eventKind: "deny",
      decisionKind: "respond",
      previousState,
      nextState: effectiveState.state,
      outcome: expiredOutcome,
      statePatch: withLastMessage(basePatch, input.sourceMessageId),
      responseKey: "nothing_to_confirm",
      nextFallbackCount: 0,
      reasonCode: expiredHandled
        ? "expired_then_deny_without_pending"
        : "deny_without_pending",
    });
  }

  // 8) Ajuda
  if (command === "help") {
    return buildDecision({
      eventKind: "help",
      decisionKind: "respond",
      previousState,
      nextState: effectiveState.state,
      outcome: expiredOutcome,
      statePatch: withLastMessage(basePatch, input.sourceMessageId),
      responseKey: "help",
      nextFallbackCount: 0,
      reasonCode: "help_command",
    });
  }

  // 9) Saudação (NÃO pergunta veículo automaticamente)
  if (command === "greeting") {
    return buildDecision({
      eventKind: "greeting",
      decisionKind: "respond",
      previousState,
      nextState: effectiveState.state,
      outcome: expiredOutcome,
      statePatch: withLastMessage(basePatch, input.sourceMessageId),
      responseKey: "greeting",
      nextFallbackCount: 0,
      reasonCode: "greeting_no_auto_vehicle_prompt",
    });
  }

  // 10) Fallback (unknown)
  const nextFallback = fallbackCount + 1;
  if (nextFallback >= 3) {
    return buildDecision({
      eventKind: "unknown",
      decisionKind: "fallback",
      previousState,
      nextState: "idle",
      outcome: "cancelled",
      statePatch: withLastMessage(
        mergePatch(basePatch, { ...CLEAR_TASK_PATCH, state: "idle" }),
        input.sourceMessageId,
      ),
      responseKey: "fallback_reset",
      nextFallbackCount: 0,
      reasonCode: "fallback_reset_after_third_failure",
    });
  }
  return buildDecision({
    eventKind: "unknown",
    decisionKind: "fallback",
    previousState,
    nextState: effectiveState.state,
    outcome: expiredOutcome,
    statePatch: withLastMessage(basePatch, input.sourceMessageId),
    responseKey: nextFallback === 1 ? "fallback_first" : "fallback_second",
    nextFallbackCount: nextFallback,
    reasonCode: `fallback_attempt_${nextFallback}`,
  });
}
