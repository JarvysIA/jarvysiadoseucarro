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
  parseMaintenanceItemsText,
  type MaintenanceTriggerTag,
} from "./expense-maintenance-items-parser.ts";
import {
  KM_UPDATE_INITIAL_DRAFT_VERSION,
  KM_UPDATE_PROMOTED_DRAFT_VERSION,
  validateAwaitingConfirmationKmUpdateDraft,
  validateAwaitingVehicleKmUpdateDraft,
} from "./km-update-draft.ts";
import {
  CONFIRM_KM_UPDATE_HANDOFF_KIND,
  KM_REPORTED_EVENT_KIND,
} from "./km-update-protocol.ts";
import {
  parseExpenseValorText,
  parseExpenseValorBareNumber,
  matchExpenseCategoria,
} from "./expense-create-parser.ts";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  EXPENSE_CREATE_INITIAL_DRAFT_VERSION,
  validateAwaitingCategoryExpenseDraft,
  validateAwaitingVehicleExpenseDraft,
  validateAwaitingConfirmationExpenseDraft,
} from "./expense-create-draft.ts";
import {
  CONFIRM_EXPENSE_CREATE_HANDOFF_KIND,
  EXPENSE_REPORTED_EVENT_KIND,
} from "./expense-create-protocol.ts";

function isEligibleKmConfirmationState(state: ConversationState): boolean {
  if (
    state.state !== "awaiting_km_confirmation" &&
    state.state !== "awaiting_km_correction"
  ) return false;
  if (state.draftType !== "km_update") return false;
  const v = validateAwaitingConfirmationKmUpdateDraft(state.draftPayload);
  return v.ok;
}

function isEligibleExpenseConfirmationState(state: ConversationState): boolean {
  if (
    state.state !== "awaiting_expense_confirmation" &&
    state.state !== "awaiting_expense_correction"
  ) return false;
  if (state.draftType !== "expense") return false;
  const v = validateAwaitingConfirmationExpenseDraft(state.draftPayload);
  return v.ok;
}

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

const MAINTENANCE_DESCRIPTION_MIN_LETTERS = 15;

function countLetters(text: string): number {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const matches = normalized.match(/[a-zA-Z]/g);
  return matches ? matches.length : 0;
}

/**
 * Build 4c/9 do item 6 — cálculo puro dos itens de manutenção, independente
 * de categoria (o parser não precisa saber a categoria pra funcionar).
 * Usado tanto quando a categoria já é conhecida (build 4a/4b) quanto
 * especulativamente, ANTES de saber a categoria (build 4c, quando a
 * mensagem original vai para awaiting_category).
 */
function computeMaintenanceItemsRaw(originalText: string): {
  recognizedTags: ReadonlyArray<MaintenanceTriggerTag>;
  descricaoPreliminar: string | null;
  ambiguousFilterMention: boolean;
} {
  const parsed = parseMaintenanceItemsText(originalText);
  const recognizedTags = parsed.items.map((i) => i.tag);
  const trimmed = originalText.trim();
  const sufficient =
    recognizedTags.length > 0 ||
    countLetters(trimmed) >= MAINTENANCE_DESCRIPTION_MIN_LETTERS;
  return {
    recognizedTags,
    descricaoPreliminar: sufficient ? trimmed : null,
    ambiguousFilterMention: parsed.ambiguousFilterMention,
  };
}

/**
 * Build 4a-4b/9 do item 6 — quando a categoria for Revisão/Manutenção, roda
 * o parser de itens sobre a mensagem original. Fora dessas 2 categorias,
 * devolve null — nenhum campo novo é adicionado ao draft.
 */
function computeMaintenanceDraftExtras(
  categoria: ExpenseCategory,
  originalText: string,
): ReturnType<typeof computeMaintenanceItemsRaw> | null {
  if (categoria !== "Revisão" && categoria !== "Manutenção") return null;
  return computeMaintenanceItemsRaw(originalText);
}

/**
 * Build 4c/9 do item 6 — aplica o mesmo filtro de categoria (só Revisão/
 * Manutenção) sobre dados JÁ calculados especulativamente (vindos do
 * draft awaiting_category), em vez de reparsear o texto original.
 */
function gateMaintenanceItemsByCategory(
  categoria: ExpenseCategory,
  raw:
    | {
        recognizedTags?: ReadonlyArray<MaintenanceTriggerTag>;
        descricaoPreliminar?: string | null;
        ambiguousFilterMention?: boolean;
      }
    | undefined,
): ReturnType<typeof computeMaintenanceItemsRaw> | null {
  if (!raw) return null;
  if (categoria !== "Revisão" && categoria !== "Manutenção") return null;
  if (raw.recognizedTags === undefined) return null;
  return {
    recognizedTags: raw.recognizedTags,
    descricaoPreliminar: raw.descricaoPreliminar ?? null,
    ambiguousFilterMention: raw.ambiguousFilterMention === true,
  };
}

/**
 * Build 4b/9 do item 6 — deriva os sinais que a MENSAGEM de confirmação
 * precisa (não persistidos, só usados no responseParams desta resposta):
 * lista de itens reconhecidos (pra mostrar), se deve perguntar qual filtro
 * (prioridade máxima) e se deve convidar a descrever (só quando não há
 * nem itens nem descrição suficiente, e não há pergunta de filtro pendente).
 */
function buildMaintenanceResponseExtras(data: {
  recognizedTags?: ReadonlyArray<MaintenanceTriggerTag>;
  descricao: string | null | undefined;
  ambiguousFilterMention?: boolean;
} | null): Pick<
  ConversationResponseParams,
  "recognizedTags" | "needsDescriptionInvite" | "needsFilterClarification"
> {
  if (data === null) return {};
  const needsFilterClarification = data.ambiguousFilterMention === true;
  const hasDescricao = data.descricao !== null && data.descricao !== undefined;
  return {
    recognizedTags: data.recognizedTags,
    needsFilterClarification,
    needsDescriptionInvite: !needsFilterClarification && !hasDescricao,
  };
}


// Build corretivo 6/6 — "revisão dos 40 mil" (ou variações) não deve ser
// lida como um valor literal (nem km, nem dinheiro) — é uma referência a
// um marco de manutenção, não um número de verdade a ser gravado.
// Build corretivo 6/6 (revisado) — "revisão dos 40 mil" ou "revisão
// 20.000km" não devem ser lidos como valor literal (nem km, nem dinheiro)
// — são referências a um marco de manutenção, não um número de verdade a
// ser gravado. Em vez de tentar cobrir cada formato manualmente (mil, km,
// ponto, etc.), reaproveita o próprio parser de KM: se "revisao" aparece
// E o texto TAMBÉM parece conter um valor de km (em qualquer formato que
// o parser de KM já reconheça), trata como marco.
function looksLikeMaintenanceMilestoneReference(text: string): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!/\brevisao\b/.test(normalized)) return false;
  const kmLike = parseKmUpdateText(text, "explicit_report");
  return kmLike.ok;
}

const REQUESTED_KM_UNKNOWN_PHRASES = new Set<string>([
  "NAO SEI",
  "NAO SEI AGORA",
  "AGORA NAO SEI",
  "NAO LEMBRO",
  "NAO ME LEMBRO",
  "NAO TENHO CERTEZA",
  "SEI LA",
  "NAO ANOTEI",
  "DEPOIS TE FALO",
  "DEPOIS EU FALO",
  "DEPOIS FALO",
  "TE FALO DEPOIS",
  "MAIS TARDE",
]);

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
  // Um draft parcial persistido é sempre um draft novo (versão INITIAL=0).
  if (state.draftVersion !== KM_UPDATE_INITIAL_DRAFT_VERSION) return null;
  if (!isUuid(state.draftId)) return null;
  const v = validateAwaitingVehicleKmUpdateDraft(state.draftPayload);
  if (!v.ok) return null;
  if (v.value.requestMessageId !== state.draftId) return null;
  return { newKm: v.value.newKm, requestMessageId: v.value.requestMessageId };
}

/**
 * Extrai draft parcial de expense do state atual (fase awaiting_vehicle).
 * Aceita draftVersion 0 (categoria reconhecida direto no idle) ou 1
 * (promovido depois de awaiting_expense_category).
 */
function extractPartialExpenseDraft(
  state: ConversationState,
): {
  categoria: ExpenseCategory;
  valor: number;
  requestMessageId: string;
  recognizedTags?: ReadonlyArray<MaintenanceTriggerTag>;
  descricaoPreliminar?: string | null;
  ambiguousFilterMention?: boolean;
} | null {
  if (state.draftType !== "expense") return null;
  if (state.draftVersion !== 0 && state.draftVersion !== 1) return null;
  if (!isUuid(state.draftId)) return null;
  const v = validateAwaitingVehicleExpenseDraft(state.draftPayload);
  if (!v.ok) return null;
  if (v.value.requestMessageId !== state.draftId) return null;
  return {
    categoria: v.value.categoria,
    valor: v.value.valor,
    requestMessageId: v.value.requestMessageId,
    ...("recognizedTags" in v.value ? { recognizedTags: v.value.recognizedTags } : {}),
    ...("descricaoPreliminar" in v.value
      ? { descricaoPreliminar: v.value.descricaoPreliminar }
      : {}),
    ...("ambiguousFilterMention" in v.value
      ? { ambiguousFilterMention: v.value.ambiguousFilterMention }
      : {}),
  };
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

  // 4) Mídia — defer para roteador legado, exceto durante confirmação pendente
  if (MEDIA_TYPES.has(input.messageType)) {
    const isDuringConfirmation =
      effectiveState.state === "awaiting_km_confirmation" ||
      effectiveState.state === "awaiting_km_correction" ||
      effectiveState.state === "awaiting_expense_confirmation" ||
      effectiveState.state === "awaiting_expense_correction";

    if (isDuringConfirmation) {
      return buildDecision({
        eventKind: "media",
        decisionKind: "respond",
        previousState,
        nextState: effectiveState.state,
        outcome: expiredOutcome,
        statePatch: withLastMessage(basePatch, input.sourceMessageId),
        responseKey: "media_unclear_during_confirmation",
        nextFallbackCount: fallbackCount,
        reasonCode: expiredHandled
          ? "expired_then_media_during_confirmation"
          : "media_during_confirmation_nudge",
      });
    }

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

  // 4.1) messageType "unknown" SEM nenhum texto (figurinha, reação,
  // contato, localização, etc.) durante confirmação pendente — mesmo
  // aviso gentil do bloco de mídia acima, já que não há texto a processar.
  if (
    input.messageType === "unknown" &&
    (input.originalText === null || input.originalText.trim() === "")
  ) {
    const isDuringConfirmation =
      effectiveState.state === "awaiting_km_confirmation" ||
      effectiveState.state === "awaiting_km_correction" ||
      effectiveState.state === "awaiting_expense_confirmation" ||
      effectiveState.state === "awaiting_expense_correction";

    if (isDuringConfirmation) {
      return buildDecision({
        eventKind: "media",
        decisionKind: "respond",
        previousState,
        nextState: effectiveState.state,
        outcome: expiredOutcome,
        statePatch: withLastMessage(basePatch, input.sourceMessageId),
        responseKey: "media_unclear_during_confirmation",
        nextFallbackCount: fallbackCount,
        reasonCode: expiredHandled
          ? "expired_then_unknown_notext_during_confirmation"
          : "unknown_notext_during_confirmation_nudge",
      });
    }
  }

  // Somente texto (ou tipo desconhecido / system) daqui em diante
  const normalized = normalizeCommandText(input.originalText);

  // 4.2) Explicit opt-out (match exato) — defer para roteador legado
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
      // Preservação/completação de draft parcial de km_update
      const partial = extractPartialKmDraft(effectiveState);
      if (partial !== null) {
        const veh = resolved.vehicle;
        const prev = veh.kmAtual;
        const isCorrection = prev !== null && partial.newKm < prev;
        const completeCandidate = {
          phase: "awaiting_confirmation" as const,
          vehicleId: veh.id,
          expectedPreviousKm: prev,
          newKm: partial.newKm,
          requestMessageId: partial.requestMessageId,
          isCorrection,
        };
        const validated =
          validateAwaitingConfirmationKmUpdateDraft(completeCandidate);
        if (validated.ok && isUuid(veh.id)) {
          const nextState: ConversationStateName = isCorrection
            ? "awaiting_km_correction"
            : "awaiting_km_confirmation";
          return buildDecision({
            eventKind: "vehicle_reply",
            decisionKind: "transition",
            previousState,
            nextState,
            statePatch: withLastMessage(
              mergePatch(basePatch, {
                state: nextState,
                currentIntent: "km_update",
                awaitingField: "confirmation",
                draftType: "km_update",
                draftId: partial.requestMessageId,
                draftVersion: KM_UPDATE_PROMOTED_DRAFT_VERSION,
                draftPayload: validated.value as unknown as Record<string, unknown>,
                activeVehicleId: veh.id,
              }),
              input.sourceMessageId,
            ),
            responseKey: isCorrection
              ? "km_update_correction_confirmation"
              : "km_update_confirmation",
            responseParams: {
              vehicleLabel: labelFor(veh),
              newKm: partial.newKm,
              previousKm: prev,
            },
            nextFallbackCount: 0,
            reasonCode: isCorrection
              ? "km_update_complete_from_vehicle_reply_correction"
              : "km_update_complete_from_vehicle_reply",
          });
        }
        // Invariante violada — não persistir draft inválido; segue caminho legado.
      }
      const expensePartial = extractPartialExpenseDraft(effectiveState);
      if (expensePartial !== null) {
        const veh = resolved.vehicle;
        const candidate = {
          phase: "awaiting_confirmation" as const,
          categoria: expensePartial.categoria,
          valor: expensePartial.valor,
          vehicleId: veh.id,
          requestMessageId: expensePartial.requestMessageId,
          ...("recognizedTags" in expensePartial
            ? { recognizedTags: expensePartial.recognizedTags }
            : {}),
          ...("descricaoPreliminar" in expensePartial
            ? { descricao: expensePartial.descricaoPreliminar }
            : {}),
        };
        const validated =
          validateAwaitingConfirmationExpenseDraft(candidate);
        if (validated.ok && isUuid(veh.id)) {
          const nextVersion = (effectiveState.draftVersion ?? 0) + 1;
          return buildDecision({
            eventKind: "vehicle_reply",
            decisionKind: "transition",
            previousState,
            nextState: "awaiting_expense_confirmation",
            statePatch: withLastMessage(
              mergePatch(basePatch, {
                state: "awaiting_expense_confirmation",
                currentIntent: "expense",
                awaitingField: "confirmation",
                draftType: "expense",
                draftId: expensePartial.requestMessageId,
                draftVersion: nextVersion,
                draftPayload: validated.value as unknown as Record<string, unknown>,
                activeVehicleId: veh.id,
              }),
              input.sourceMessageId,
            ),
            responseKey: "expense_create_confirmation",
            responseParams: {
              vehicleLabel: labelFor(veh),
              valor: expensePartial.valor,
              categoria: expensePartial.categoria,
            },
            nextFallbackCount: 0,
            reasonCode: "expense_create_complete_from_vehicle_reply",
          });
        }
        // Invariante violada — cai no select_vehicle genérico abaixo.
      }
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

  // 6.5) Resposta a state pendente (awaiting_expense_category)
  if (effectiveState.state === "awaiting_expense_category") {
    const currentDraft = validateAwaitingCategoryExpenseDraft(
      effectiveState.draftPayload,
    );
    if (
      effectiveState.draftType === "expense" &&
      isUuid(effectiveState.draftId) &&
      currentDraft.ok &&
      typeof input.originalText === "string"
    ) {
      const categoriaMatch = matchExpenseCategoria(input.originalText);
      if (categoriaMatch.ok) {
        const resolvedVeh = resolveVehicle({
          text: null,
          vehicles: input.vehicles,
          activeVehicleId: effectiveState.activeVehicleId,
        });
        const nextVersion = (effectiveState.draftVersion ?? 0) + 1;
        if (resolvedVeh.kind === "matched") {
          const veh = resolvedVeh.vehicle;
          const gated = gateMaintenanceItemsByCategory(
            categoriaMatch.categoria,
            currentDraft.value,
          );
          const candidate = {
            phase: "awaiting_confirmation" as const,
            categoria: categoriaMatch.categoria,
            valor: currentDraft.value.valor,
            vehicleId: veh.id,
            requestMessageId: effectiveState.draftId,
            ...(gated
              ? {
                  recognizedTags: gated.recognizedTags,
                  descricao: gated.descricaoPreliminar,
                  ambiguousFilterMention: gated.ambiguousFilterMention,
                }
              : {}),
          };
          const validated =
            validateAwaitingConfirmationExpenseDraft(candidate);
          if (validated.ok && isUuid(veh.id)) {
            return buildDecision({
              eventKind: "category_reply",
              decisionKind: "transition",
              previousState,
              nextState: "awaiting_expense_confirmation",
              statePatch: withLastMessage(
                mergePatch(basePatch, {
                  state: "awaiting_expense_confirmation",
                  currentIntent: "expense",
                  awaitingField: "confirmation",
                  draftType: "expense",
                  draftId: effectiveState.draftId,
                  draftVersion: nextVersion,
                  draftPayload: validated.value as unknown as Record<string, unknown>,
                  activeVehicleId: veh.id,
                }),
                input.sourceMessageId,
              ),
              responseKey: "expense_create_confirmation",
              responseParams: {
                vehicleLabel: labelFor(veh),
                valor: currentDraft.value.valor,
                categoria: categoriaMatch.categoria,
                ...buildMaintenanceResponseExtras(
                  gated
                    ? {
                        recognizedTags: gated.recognizedTags,
                        descricao: gated.descricaoPreliminar,
                        ambiguousFilterMention: gated.ambiguousFilterMention,
                      }
                    : null,
                ),
              },
              nextFallbackCount: 0,
              reasonCode: "expense_category_resolved_complete",
            });
          }
        } else if (
          resolvedVeh.kind === "ambiguous" ||
          resolvedVeh.kind === "not_found"
        ) {
          const gated = gateMaintenanceItemsByCategory(
            categoriaMatch.categoria,
            currentDraft.value,
          );
          const candidate = {
            phase: "awaiting_vehicle" as const,
            categoria: categoriaMatch.categoria,
            valor: currentDraft.value.valor,
            requestMessageId: effectiveState.draftId,
            ...(gated
              ? {
                  recognizedTags: gated.recognizedTags,
                  descricaoPreliminar: gated.descricaoPreliminar,
                  ambiguousFilterMention: gated.ambiguousFilterMention,
                }
              : {}),
          };
          const validated = validateAwaitingVehicleExpenseDraft(candidate);
          if (validated.ok) {
            const pool = firstEligible(input.vehicles);
            return buildDecision({
              eventKind: "category_reply",
              decisionKind: "transition",
              previousState,
              nextState: "awaiting_vehicle",
              statePatch: withLastMessage(
                mergePatch(basePatch, {
                  state: "awaiting_vehicle",
                  currentIntent: "expense",
                  awaitingField: "vehicle",
                  draftType: "expense",
                  draftId: effectiveState.draftId,
                  draftVersion: nextVersion,
                  draftPayload: validated.value as unknown as Record<string, unknown>,
                }),
                input.sourceMessageId,
              ),
              responseKey: "vehicle_ambiguous",
              responseParams: { options: pool.map(labelFor) },
              nextFallbackCount: 0,
              reasonCode: "expense_category_resolved_awaiting_vehicle",
            });
          }
        } else {
          return buildDecision({
            eventKind: "category_reply",
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
            reasonCode: "expense_category_no_eligible_vehicle",
          });
        }
      }
      // categoria não reconhecida — repete a pergunta, sem contar fallback.
      return buildDecision({
        eventKind: "category_reply",
        decisionKind: "respond",
        previousState,
        nextState: "awaiting_expense_category",
        statePatch: withLastMessage(basePatch, input.sourceMessageId),
        responseKey: "expense_category_prompt",
        responseParams: {
          valor: currentDraft.value.valor,
          options: [...EXPENSE_CATEGORIES],
        },
        nextFallbackCount: 0,
        reasonCode: "expense_category_unrecognized_retry",
      });
    }
    // draft corrompido — cai no fluxo geral abaixo.
  }

  // 6.6) Resposta a state pendente (awaiting_requested_km) — gatilho pós-despesa.
  // Não há draft nesse estado (draftId permanece null). Só interceptamos se o
  // parseKmUpdateText tiver sucesso; parse falhando cai no fallback genérico
  // da seção 10 (que já tem contador/reset). "Deny" puro (usuário responde
  // só "não") cai no nothing_to_confirm da seção 7 e permanece no mesmo
  // estado — escopo deliberadamente não coberto neste microbuild.
  if (
    effectiveState.state === "awaiting_requested_km" &&
    typeof input.originalText === "string" &&
    isUuid(input.sourceMessageId)
  ) {
    const requestedKmUnknownNormalized = normalizeCommandText(input.originalText).normalizedText;
    if (REQUESTED_KM_UNKNOWN_PHRASES.has(requestedKmUnknownNormalized)) {
      return buildDecision({
        eventKind: KM_REPORTED_EVENT_KIND,
        decisionKind: "respond",
        previousState,
        nextState: "idle",
        outcome: "cancelled",
        statePatch: withLastMessage(
          mergePatch(basePatch, { ...CLEAR_TASK_PATCH, state: "idle" }),
          input.sourceMessageId,
        ),
        responseKey: "requested_km_unknown",
        nextFallbackCount: 0,
        reasonCode: "requested_km_declined_unknown",
      });
    }
    const parsed = parseKmUpdateText(input.originalText, "value_reply");
    if (parsed.ok) {
      const activeId = effectiveState.activeVehicleId;
      const veh = activeId === null
        ? null
        : input.vehicles.find(
            (v) => v.id === activeId && v.isEligible && !v.isArchived,
          ) ?? null;
      if (veh === null) {
        return buildDecision({
          eventKind: KM_REPORTED_EVENT_KIND,
          decisionKind: "respond",
          previousState,
          nextState: "idle",
          outcome: "cancelled",
          statePatch: withLastMessage(
            mergePatch(basePatch, { ...CLEAR_TASK_PATCH, state: "idle" }),
            input.sourceMessageId,
          ),
          responseKey: "no_eligible_vehicle",
          nextFallbackCount: 0,
          reasonCode: "requested_km_active_vehicle_unavailable",
        });
      }
      const prev = veh.kmAtual;
      const isCorrection = prev !== null && parsed.newKm < prev;
      const completeCandidate = {
        phase: "awaiting_confirmation" as const,
        vehicleId: veh.id,
        expectedPreviousKm: prev,
        newKm: parsed.newKm,
        requestMessageId: input.sourceMessageId,
        isCorrection,
      };
      const validated =
        validateAwaitingConfirmationKmUpdateDraft(completeCandidate);
      if (validated.ok && isUuid(veh.id)) {
        const nextState: ConversationStateName = isCorrection
          ? "awaiting_km_correction"
          : "awaiting_km_confirmation";
        return buildDecision({
          eventKind: KM_REPORTED_EVENT_KIND,
          decisionKind: "transition",
          previousState,
          nextState,
          statePatch: withLastMessage(
            mergePatch(basePatch, {
              state: nextState,
              currentIntent: "km_update",
              awaitingField: "confirmation",
              draftType: "km_update",
              draftId: input.sourceMessageId,
              draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
              draftPayload: validated.value as unknown as Record<string, unknown>,
              activeVehicleId: veh.id,
            }),
            input.sourceMessageId,
          ),
          responseKey: isCorrection
            ? "km_update_correction_confirmation"
            : "km_update_confirmation",
          responseParams: {
            vehicleLabel: labelFor(veh),
            newKm: parsed.newKm,
            previousKm: prev,
          },
          nextFallbackCount: 0,
          reasonCode: isCorrection
            ? "requested_km_reply_correction"
            : "requested_km_reply_complete",
        });
      }
      // Invariante violada — cai no fallback genérico.
    }
    // parse falhou — cai no fallback genérico da seção 10.
  }

  // 7) Confirmação / negação
  if (command === "confirm" && isEligibleKmConfirmationState(effectiveState)) {
    return buildDecision({
      eventKind: "confirm",
      decisionKind: CONFIRM_KM_UPDATE_HANDOFF_KIND,
      previousState,
      nextState: effectiveState.state,
      outcome: "none",
      statePatch: withLastMessage(basePatch, input.sourceMessageId),
      responseKey: null,
      nextFallbackCount: 0,
      reasonCode: effectiveState.state === "awaiting_km_correction"
        ? "km_update_correction_confirmed_handoff"
        : "km_update_confirmed_handoff",
    });
  }
  if (command === "deny" && isEligibleKmConfirmationState(effectiveState)) {
    return buildDecision({
      eventKind: "deny",
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
      reasonCode: effectiveState.state === "awaiting_km_correction"
        ? "km_update_correction_denied"
        : "km_update_denied",
    });
  }
  if (command === "confirm" && isEligibleExpenseConfirmationState(effectiveState)) {
    return buildDecision({
      eventKind: "confirm",
      decisionKind: CONFIRM_EXPENSE_CREATE_HANDOFF_KIND,
      previousState,
      nextState: effectiveState.state,
      outcome: "none",
      statePatch: withLastMessage(basePatch, input.sourceMessageId),
      responseKey: null,
      nextFallbackCount: 0,
      reasonCode: effectiveState.state === "awaiting_expense_correction"
        ? "expense_create_correction_confirmed_handoff"
        : "expense_create_confirmed_handoff",
    });
  }
  if (command === "deny" && isEligibleExpenseConfirmationState(effectiveState)) {
    return buildDecision({
      eventKind: "deny",
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
      reasonCode: effectiveState.state === "awaiting_expense_correction"
        ? "expense_create_correction_denied"
        : "expense_create_denied",
    });
  }
  // Correção de categoria em awaiting_expense_confirmation/correction.
  if (
    (effectiveState.state === "awaiting_expense_confirmation" ||
      effectiveState.state === "awaiting_expense_correction") &&
    isEligibleExpenseConfirmationState(effectiveState) &&
    command !== "confirm" &&
    command !== "deny" &&
    typeof input.originalText === "string"
  ) {
    const currentDraft = validateAwaitingConfirmationExpenseDraft(
      effectiveState.draftPayload,
    );
    if (currentDraft.ok) {
      const categoriaMatch = matchExpenseCategoria(input.originalText);
      if (
        categoriaMatch.ok &&
        categoriaMatch.categoria !== currentDraft.value.categoria
      ) {
        const candidate = {
          phase: "awaiting_confirmation" as const,
          categoria: categoriaMatch.categoria,
          valor: currentDraft.value.valor,
          vehicleId: currentDraft.value.vehicleId,
          requestMessageId: currentDraft.value.requestMessageId,
        };
        const validated =
          validateAwaitingConfirmationExpenseDraft(candidate);
        if (validated.ok) {
          const veh = input.vehicles.find(
            (v) => v.id === currentDraft.value.vehicleId,
          );
          return buildDecision({
            eventKind: "category_reply",
            decisionKind: "transition",
            previousState,
            nextState: "awaiting_expense_correction",
            statePatch: withLastMessage(
              mergePatch(basePatch, {
                state: "awaiting_expense_correction",
                draftPayload: validated.value as unknown as Record<string, unknown>,
              }),
              input.sourceMessageId,
            ),
            responseKey: "expense_create_correction_confirmation",
            responseParams: {
              vehicleLabel: veh ? labelFor(veh) : undefined,
              valor: currentDraft.value.valor,
              categoria: categoriaMatch.categoria,
            },
            nextFallbackCount: 0,
            reasonCode: "expense_category_corrected_at_confirmation",
          });
        }
      }
    }
    // sem categoria nova válida — segue fluxo padrão abaixo.
  }
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

  // 9.5) Detecção T1 de despesa (idle, só se KM não reconheceu).
  if (
    effectiveState.state === "idle" &&
    typeof input.originalText === "string" &&
    isUuid(input.sourceMessageId)
  ) {
    let parsedValor = parseExpenseValorText(input.originalText);
    if (!parsedValor.ok) {
      const categoriaHint = matchExpenseCategoria(input.originalText);
      if (categoriaHint.ok && !looksLikeMaintenanceMilestoneReference(input.originalText)) {
        const bareValor = parseExpenseValorBareNumber(input.originalText);
        if (bareValor.ok) {
          parsedValor = bareValor;
        }
      }
    }
    if (parsedValor.ok) {
      const pool = firstEligible(input.vehicles);
      if (pool.length === 0) {
        return buildDecision({
          eventKind: EXPENSE_REPORTED_EVENT_KIND,
          decisionKind: "respond",
          previousState,
          nextState: "idle",
          outcome: expiredOutcome,
          statePatch: withLastMessage(basePatch, input.sourceMessageId),
          responseKey: "no_eligible_vehicle",
          nextFallbackCount: 0,
          reasonCode: "expense_reported_no_eligible_vehicle",
        });
      }
      const categoriaMatch = matchExpenseCategoria(input.originalText);
      if (!categoriaMatch.ok) {
        const candidate = {
          phase: "awaiting_category" as const,
          valor: parsedValor.valor,
          requestMessageId: input.sourceMessageId,
        };
        const validated = validateAwaitingCategoryExpenseDraft(candidate);
        if (validated.ok) {
          return buildDecision({
            eventKind: EXPENSE_REPORTED_EVENT_KIND,
            decisionKind: "transition",
            previousState,
            nextState: "awaiting_expense_category",
            statePatch: withLastMessage(
              mergePatch(basePatch, {
                state: "awaiting_expense_category",
                currentIntent: "expense",
                awaitingField: "categoria",
                draftType: "expense",
                draftId: input.sourceMessageId,
                draftVersion: EXPENSE_CREATE_INITIAL_DRAFT_VERSION,
                draftPayload: validated.value as unknown as Record<string, unknown>,
              }),
              input.sourceMessageId,
            ),
            responseKey: "expense_category_prompt",
            responseParams: {
              valor: parsedValor.valor,
              options: [...EXPENSE_CATEGORIES],
            },
            nextFallbackCount: 0,
            reasonCode: "expense_reported_awaiting_category",
          });
        }
      } else {
        const resolvedVeh = resolveVehicle({
          text: null,
          vehicles: input.vehicles,
          activeVehicleId: effectiveState.activeVehicleId,
        });
        if (resolvedVeh.kind === "matched") {
          const veh = resolvedVeh.vehicle;
          const extras = computeMaintenanceDraftExtras(
            categoriaMatch.categoria,
            input.originalText,
          );
          const candidate = {
            phase: "awaiting_confirmation" as const,
            categoria: categoriaMatch.categoria,
            valor: parsedValor.valor,
            vehicleId: veh.id,
            requestMessageId: input.sourceMessageId,
            ...(extras
              ? {
                  recognizedTags: extras.recognizedTags,
                  descricao: extras.descricaoPreliminar,
                }
              : {}),
          };
          const validated =
            validateAwaitingConfirmationExpenseDraft(candidate);
          if (validated.ok && isUuid(veh.id)) {
            return buildDecision({
              eventKind: EXPENSE_REPORTED_EVENT_KIND,
              decisionKind: "transition",
              previousState,
              nextState: "awaiting_expense_confirmation",
              statePatch: withLastMessage(
                mergePatch(basePatch, {
                  state: "awaiting_expense_confirmation",
                  currentIntent: "expense",
                  awaitingField: "confirmation",
                  draftType: "expense",
                  draftId: input.sourceMessageId,
                  draftVersion: EXPENSE_CREATE_INITIAL_DRAFT_VERSION,
                  draftPayload: validated.value as unknown as Record<string, unknown>,
                  activeVehicleId: veh.id,
                }),
                input.sourceMessageId,
              ),
              responseKey: "expense_create_confirmation",
              responseParams: {
                vehicleLabel: labelFor(veh),
                valor: parsedValor.valor,
                categoria: categoriaMatch.categoria,
              },
              nextFallbackCount: 0,
              reasonCode: "expense_reported_complete",
            });
          }
        } else {
          const extras = computeMaintenanceDraftExtras(
            categoriaMatch.categoria,
            input.originalText,
          );
          const candidate = {
            phase: "awaiting_vehicle" as const,
            categoria: categoriaMatch.categoria,
            valor: parsedValor.valor,
            requestMessageId: input.sourceMessageId,
            ...(extras
              ? {
                  recognizedTags: extras.recognizedTags,
                  descricaoPreliminar: extras.descricaoPreliminar,
                }
              : {}),
          };
          const validated = validateAwaitingVehicleExpenseDraft(candidate);
          if (validated.ok) {
            return buildDecision({
              eventKind: EXPENSE_REPORTED_EVENT_KIND,
              decisionKind: "transition",
              previousState,
              nextState: "awaiting_vehicle",
              statePatch: withLastMessage(
                mergePatch(basePatch, {
                  state: "awaiting_vehicle",
                  currentIntent: "expense",
                  awaitingField: "vehicle",
                  draftType: "expense",
                  draftId: input.sourceMessageId,
                  draftVersion: EXPENSE_CREATE_INITIAL_DRAFT_VERSION,
                  draftPayload: validated.value as unknown as Record<string, unknown>,
                }),
                input.sourceMessageId,
              ),
              responseKey: "vehicle_ambiguous",
              responseParams: { options: pool.map(labelFor) },
              nextFallbackCount: 0,
              reasonCode: "expense_reported_partial_awaiting_vehicle",
            });
          }
        }
      }
    }
  }

  // 9.6) Detecção T1 de atualização de KM (somente em state neutro)
  if (
    effectiveState.state === "idle" &&
    typeof input.originalText === "string" &&
    isUuid(input.sourceMessageId) &&
    !looksLikeMaintenanceMilestoneReference(input.originalText)
  ) {
    const parsed = parseKmUpdateText(input.originalText, "explicit_report");
    if (parsed.ok) {
      const pool = firstEligible(input.vehicles);
      if (pool.length === 0) {
        return buildDecision({
          eventKind: KM_REPORTED_EVENT_KIND,
          decisionKind: "respond",
          previousState,
          nextState: "idle",
          outcome: expiredOutcome,
          statePatch: withLastMessage(basePatch, input.sourceMessageId),
          responseKey: "no_eligible_vehicle",
          nextFallbackCount: 0,
          reasonCode: "km_reported_no_eligible_vehicle",
        });
      }
      // Resolver sem texto de veículo — usa activeVehicleId ou único elegível.
      const resolvedVeh = resolveVehicle({
        text: null,
        vehicles: input.vehicles,
        activeVehicleId: effectiveState.activeVehicleId,
      });
      if (resolvedVeh.kind === "matched") {
        const veh = resolvedVeh.vehicle;
        const prev = veh.kmAtual;
        const isCorrection = prev !== null && parsed.newKm < prev;
        const completeCandidate = {
          phase: "awaiting_confirmation" as const,
          vehicleId: veh.id,
          expectedPreviousKm: prev,
          newKm: parsed.newKm,
          requestMessageId: input.sourceMessageId,
          isCorrection,
        };
        const validated =
          validateAwaitingConfirmationKmUpdateDraft(completeCandidate);
        if (validated.ok && isUuid(veh.id)) {
          const nextState: ConversationStateName = isCorrection
            ? "awaiting_km_correction"
            : "awaiting_km_confirmation";
          return buildDecision({
            eventKind: KM_REPORTED_EVENT_KIND,
            decisionKind: "transition",
            previousState,
            nextState,
            statePatch: withLastMessage(
              mergePatch(basePatch, {
                state: nextState,
                currentIntent: "km_update",
                awaitingField: "confirmation",
                draftType: "km_update",
                draftId: input.sourceMessageId,
                draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
                draftPayload: validated.value as unknown as Record<string, unknown>,
                activeVehicleId: veh.id,
              }),
              input.sourceMessageId,
            ),
            responseKey: isCorrection
              ? "km_update_correction_confirmation"
              : "km_update_confirmation",
            responseParams: {
              vehicleLabel: labelFor(veh),
              newKm: parsed.newKm,
              previousKm: prev,
            },
            nextFallbackCount: 0,
            reasonCode: isCorrection
              ? "km_reported_complete_correction"
              : "km_reported_complete",
          });
        }
        // Invariante violada — segue caminho de fallback.
      } else {
        // Draft parcial: pedir seleção de veículo.
        const partialCandidate = {
          phase: "awaiting_vehicle" as const,
          newKm: parsed.newKm,
          requestMessageId: input.sourceMessageId,
        };
        const validated =
          validateAwaitingVehicleKmUpdateDraft(partialCandidate);
        if (validated.ok) {
          return buildDecision({
            eventKind: KM_REPORTED_EVENT_KIND,
            decisionKind: "transition",
            previousState,
            nextState: "awaiting_vehicle",
            statePatch: withLastMessage(
              mergePatch(basePatch, {
                state: "awaiting_vehicle",
                currentIntent: "km_update",
                awaitingField: "vehicle",
                draftType: "km_update",
                draftId: input.sourceMessageId,
                draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
                draftPayload: validated.value as unknown as Record<string, unknown>,
              }),
              input.sourceMessageId,
            ),
            responseKey: "vehicle_ambiguous",
            responseParams: { options: pool.map(labelFor) },
            nextFallbackCount: 0,
            reasonCode: "km_reported_partial_awaiting_vehicle",
          });
        }
        // Invariante violada — segue caminho de fallback.
      }
    }
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
