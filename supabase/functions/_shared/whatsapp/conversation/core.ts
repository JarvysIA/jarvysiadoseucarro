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
import { canVehiclePerformFullAction, fullAccessVehicles } from "./vehicle-access-policy.ts";
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
import { CONFIRM_KM_UPDATE_HANDOFF_KIND, KM_REPORTED_EVENT_KIND } from "./km-update-protocol.ts";
import { parseExpenseValorText, parseExpenseValorBareNumber } from "./expense-create-parser.ts";
import {
  type ExpenseCategory,
  EXPENSE_CREATE_INITIAL_DRAFT_VERSION,
  validateAwaitingCategoryExpenseDraft,
  validateAwaitingVehicleExpenseDraft,
  validateAwaitingConfirmationExpenseDraft,
  validateAwaitingItemSpecificationDraft,
} from "./expense-create-draft.ts";
import {
  CONFIRM_EXPENSE_CREATE_HANDOFF_KIND,
  EXPENSE_REPORTED_EVENT_KIND,
} from "./expense-create-protocol.ts";
import { recognizeExpenseSemantics } from "../../expenses/semantics/expense-category-recognizer.ts";
import { recognizeEngineConcepts } from "../../expenses/semantics/engine-concept-recognizer.ts";
import { recognizeExpenseIntent } from "../../expenses/semantics/expense-intent-recognizer.ts";

function isEligibleKmConfirmationState(state: ConversationState): boolean {
  if (state.state !== "awaiting_km_confirmation" && state.state !== "awaiting_km_correction")
    return false;
  if (state.draftType !== "km_update") return false;
  const v = validateAwaitingConfirmationKmUpdateDraft(state.draftPayload);
  return v.ok;
}

function isEligibleExpenseConfirmationState(state: ConversationState): boolean {
  if (
    state.state !== "awaiting_expense_confirmation" &&
    state.state !== "awaiting_expense_correction"
  )
    return false;
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

function assertNever(value: never): never {
  throw new Error(`Unexpected semantic result status: ${String(value)}`);
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
    recognizedTags.length > 0 || countLetters(trimmed) >= MAINTENANCE_DESCRIPTION_MIN_LETTERS;
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
function buildMaintenanceResponseExtras(
  data: {
    recognizedTags?: ReadonlyArray<MaintenanceTriggerTag>;
    descricao: string | null | undefined;
    ambiguousFilterMention?: boolean;
  } | null,
): Pick<
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

// Build corretivo (item 6 — ponta solta 2) — reconhecimento amplo de recusa/
// adiamento em awaiting_requested_km. Substitui a lista fechada de match
// exato por reconhecimento de padrões (substring/regex) sobre o texto
// normalizado: cobre incerteza ("não sei", "não faço ideia", "sem ideia",
// "não conferi" etc.) e adiamento ("depois eu confirmo", "mais tarde", "já
// te aviso"). Verificado SOMENTE depois de tentar reconhecer um número de
// km explícito (ver ordem no bloco 6.6 abaixo) — assim "não sei, acho que é
// uns 50000" não perde o número por causa da hesitação ao redor.
const REQUESTED_KM_UNCERTAINTY_SUBSTRINGS: ReadonlyArray<string> = [
  "NAO SEI",
  "NAO LEMBRO",
  "NAO ME LEMBRO",
  "NAO TENHO CERTEZA",
  "NAO FACO IDEIA",
  "NAO FACO A MENOR IDEIA",
  "NAO FACO A MINIMA IDEIA",
  "SEI LA",
  "SEM IDEIA",
  "NENHUMA IDEIA",
  "NAO ANOTEI",
  "NAO CHEQUEI",
  "NAO CONFERI",
  "NAO VERIFIQUEI",
  "NAO OLHEI",
  "NAO MEDI",
  "NAO SEI DE CABECA",
  "NAO SEI DE MEMORIA",
];

const REQUESTED_KM_DEFER_VERBS_RE = /\b(FALO|AVISO|DIGO|CONTO|CHECO|CONFIRMO|MANDO|VERIFICO)\b/;

function looksLikeRequestedKmUnclearResponse(normalizedText: string): boolean {
  if (normalizedText === "") return false;
  for (const s of REQUESTED_KM_UNCERTAINTY_SUBSTRINGS) {
    if (normalizedText.includes(s)) return true;
  }
  if (/\bMAIS TARDE\b/.test(normalizedText)) return true;
  if (/\bDEPOIS\b/.test(normalizedText) && REQUESTED_KM_DEFER_VERBS_RE.test(normalizedText))
    return true;
  if (/\bJA\b/.test(normalizedText) && REQUESTED_KM_DEFER_VERBS_RE.test(normalizedText))
    return true;
  return false;
}

/**
 * Aplica idempotente do sourceMessageId em lastMessageId no patch final.
 */
function withLastMessage(
  patch: ConversationStatePatch,
  sourceMessageId: string,
): ConversationStatePatch {
  return { ...patch, lastMessageId: sourceMessageId };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function firstEligible(vehicles: ConversationVehicle[]): ConversationVehicle[] {
  return fullAccessVehicles(vehicles);
}

function draftVehicleId(state: ConversationState): string | null {
  const value = state.draftPayload?.vehicleId;
  return typeof value === "string" ? value : null;
}

function isVehicleAccessRestricted(
  state: ConversationState,
  vehicles: ConversationVehicle[],
): boolean {
  const focalId = draftVehicleId(state) ?? state.activeVehicleId;
  if (focalId !== null) {
    return !canVehiclePerformFullAction(vehicles.find((v) => v.id === focalId));
  }
  const available = vehicles.filter((v) => v.isEligible && !v.isArchived);
  return available.length > 0 && fullAccessVehicles(available).length === 0;
}

function isMediaAccessRestricted(
  state: ConversationState,
  vehicles: ConversationVehicle[],
): boolean {
  const focalId = draftVehicleId(state) ?? state.activeVehicleId;
  if (focalId !== null) {
    return !canVehiclePerformFullAction(vehicles.find((v) => v.id === focalId));
  }
  const available = vehicles.filter((v) => v.isEligible && !v.isArchived);
  return available.length !== 1 || !canVehiclePerformFullAction(available[0]);
}

function restrictedDecision(args: {
  eventKind: ConversationEventKind;
  previousState: ConversationStateName;
  effectiveState: ConversationState;
  basePatch: ConversationStatePatch;
  sourceMessageId: string;
}): ConversationCoreDecision {
  const blockedVehicleId =
    draftVehicleId(args.effectiveState) ?? args.effectiveState.activeVehicleId;
  const shouldInvalidateTask = hasPendingDraft(args.effectiveState);
  const restrictedPatch = shouldInvalidateTask
    ? mergePatch(args.basePatch, {
        ...CLEAR_TASK_PATCH,
        state: "idle",
        ...(blockedVehicleId !== null && args.effectiveState.activeVehicleId === blockedVehicleId
          ? { activeVehicleId: null }
          : {}),
      })
    : args.basePatch;
  return buildDecision({
    eventKind: args.eventKind,
    decisionKind: "respond",
    previousState: args.previousState,
    nextState: shouldInvalidateTask ? "idle" : args.effectiveState.state,
    outcome: shouldInvalidateTask ? "cancelled" : "none",
    statePatch: withLastMessage(restrictedPatch, args.sourceMessageId),
    responseKey: "vehicle_access_restricted",
    nextFallbackCount: 0,
    reasonCode: "vehicle_access_restricted",
  });
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
function extractPartialExpenseDraft(state: ConversationState): {
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

export function decideConversation(input: ConversationCoreInput): ConversationCoreDecision {
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
    if (isMediaAccessRestricted(effectiveState, input.vehicles)) {
      return restrictedDecision({
        eventKind: "media",
        previousState,
        effectiveState,
        basePatch,
        sourceMessageId: input.sourceMessageId,
      });
    }
    const isDuringConfirmation =
      effectiveState.state === "awaiting_km_confirmation" ||
      effectiveState.state === "awaiting_km_correction" ||
      effectiveState.state === "awaiting_expense_confirmation" ||
      effectiveState.state === "awaiting_expense_correction" ||
      effectiveState.state === "awaiting_item_specification";

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
      effectiveState.state === "awaiting_expense_correction" ||
      effectiveState.state === "awaiting_item_specification";

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
  if (
    command !== "cancel_task" &&
    command !== "reset_conversation" &&
    effectiveState.state !== "awaiting_vehicle" &&
    isVehicleAccessRestricted(effectiveState, input.vehicles)
  ) {
    const eventKind: ConversationEventKind =
      command === "greeting" || command === "help" || command === "confirm" || command === "deny"
        ? command
        : "unknown";
    return restrictedDecision({
      eventKind,
      previousState,
      effectiveState,
      basePatch,
      sourceMessageId: input.sourceMessageId,
    });
  }
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
        const validated = validateAwaitingConfirmationKmUpdateDraft(completeCandidate);
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
        const validated = validateAwaitingConfirmationExpenseDraft(candidate);
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
              ...buildMaintenanceResponseExtras(
                "recognizedTags" in expensePartial || "ambiguousFilterMention" in expensePartial
                  ? {
                      recognizedTags: expensePartial.recognizedTags,
                      descricao: expensePartial.descricaoPreliminar,
                      ambiguousFilterMention: expensePartial.ambiguousFilterMention,
                    }
                  : null,
              ),
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
    if (resolved.kind === "restricted") {
      return restrictedDecision({
        eventKind: "vehicle_reply",
        previousState,
        effectiveState,
        basePatch,
        sourceMessageId: input.sourceMessageId,
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
    const currentDraft = validateAwaitingCategoryExpenseDraft(effectiveState.draftPayload);
    if (
      effectiveState.draftType === "expense" &&
      isUuid(effectiveState.draftId) &&
      currentDraft.ok &&
      typeof input.originalText === "string"
    ) {
      const semanticResult = recognizeExpenseSemantics({ originalText: input.originalText });
      switch (semanticResult.status) {
        case "resolved": {
          const conceptualCategory = semanticResult.conceptualCategory;
          const resolvedVeh = resolveVehicle({
            text: null,
            vehicles: input.vehicles,
            activeVehicleId: effectiveState.activeVehicleId,
          });
          const nextVersion = (effectiveState.draftVersion ?? 0) + 1;
          if (resolvedVeh.kind === "matched") {
            const veh = resolvedVeh.vehicle;
            const gated = gateMaintenanceItemsByCategory(conceptualCategory, currentDraft.value);
            const candidate = {
              phase: "awaiting_confirmation" as const,
              categoria: conceptualCategory,
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
            const validated = validateAwaitingConfirmationExpenseDraft(candidate);
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
                  categoria: conceptualCategory,
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
          } else if (resolvedVeh.kind === "ambiguous" || resolvedVeh.kind === "not_found") {
            const gated = gateMaintenanceItemsByCategory(conceptualCategory, currentDraft.value);
            const candidate = {
              phase: "awaiting_vehicle" as const,
              categoria: conceptualCategory,
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
          break;
        }

        case "needs_item_specification": {
          const nextVersion = (effectiveState.draftVersion ?? 0) + 1;
          const candidate = {
            phase: "awaiting_item_specification" as const,
            valor: currentDraft.value.valor,
            requestMessageId: effectiveState.draftId,
            trigger: semanticResult.trigger,
            fallbackCategory: semanticResult.fallbackCategory,
            allowRetry: true,
            retriedOnce: false,
          };
          const validated = validateAwaitingItemSpecificationDraft(candidate);
          if (validated.ok) {
            return buildDecision({
              eventKind: "category_reply",
              decisionKind: "transition",
              previousState,
              nextState: "awaiting_item_specification",
              statePatch: withLastMessage(
                mergePatch(basePatch, {
                  state: "awaiting_item_specification",
                  currentIntent: "expense",
                  awaitingField: "item_specification",
                  draftType: "expense",
                  draftId: effectiveState.draftId,
                  draftVersion: nextVersion,
                  draftPayload: validated.value as unknown as Record<string, unknown>,
                }),
                input.sourceMessageId,
              ),
              responseKey: "expense_item_specification_prompt",
              responseParams: {
                valor: currentDraft.value.valor,
                itemSpecificationTrigger: semanticResult.trigger,
              },
              nextFallbackCount: 0,
              reasonCode: "expense_category_resolved_awaiting_item_specification",
            });
          }
          break;
        }

        // needs_clarification (categoria não-motor ambígua) e unsupported
        // (nenhuma categoria reconhecida) caem no MESMO branch hoje — repete
        // a pergunta de categoria genericamente, sem contar fallback.
        // Diferenciar usando candidateCategories de needs_clarification fica
        // para um sub-passo futuro de melhoria de UX (fora de escopo aqui) —
        // mesma decisão já replicada no Passo D-2.
        case "needs_clarification":
        case "unsupported":
          break;

        // Defensivo — nunca deveria ocorrer na prática. conversation_only é
        // uma garantia estrutural de recognizeExpenseSemantics (o cabeçalho
        // do próprio arquivo confirma que essa função nunca produz esse
        // status) — mas precisa de um case explícito para o switch ser
        // exaustivo (ver assertNever no default). Fail-closed: mesmo
        // comportamento de needs_clarification/unsupported acima.
        case "conversation_only":
          break;

        default:
          return assertNever(semanticResult);
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
        },
        nextFallbackCount: 0,
        reasonCode: "expense_category_unrecognized_retry",
      });
    }
    // draft corrompido — cai no fluxo geral abaixo.
  }

  // 6.55) Resposta a state pendente (awaiting_item_specification) — turno 2
  // do gatilho "revisão"/"ar condicionado"/"manutenção" bare (P0-3B-R, Passo
  // C). Se a resposta não reconhecer nenhum conceito de motor, o draft pode
  // ganhar UMA repetição da mesma pergunta antes de finalizar com
  // fallbackCategory — só quando allowRetry===true e retriedOnce===false
  // (drafts criados em T1/Passo B e awaiting_expense_category/Passo D-3; o
  // Passo D-4, correção de categoria durante confirmação, ainda não
  // implementado, criará drafts com allowRetry: false, sem repetição, para
  // nunca "fingir" na tela uma categoria diferente da que será gravada).
  if (effectiveState.state === "awaiting_item_specification") {
    const currentDraft = validateAwaitingItemSpecificationDraft(effectiveState.draftPayload);
    if (
      effectiveState.draftType === "expense" &&
      isUuid(effectiveState.draftId) &&
      currentDraft.ok &&
      typeof input.originalText === "string"
    ) {
      const engineConcepts = recognizeEngineConcepts(input.originalText);
      if (
        engineConcepts.length === 0 &&
        currentDraft.value.allowRetry &&
        !currentDraft.value.retriedOnce
      ) {
        const retryCandidate = {
          phase: "awaiting_item_specification" as const,
          valor: currentDraft.value.valor,
          requestMessageId: currentDraft.value.requestMessageId,
          trigger: currentDraft.value.trigger,
          fallbackCategory: currentDraft.value.fallbackCategory,
          allowRetry: currentDraft.value.allowRetry,
          retriedOnce: true,
        };
        const validatedRetry = validateAwaitingItemSpecificationDraft(retryCandidate);
        if (validatedRetry.ok) {
          const nextVersion = (effectiveState.draftVersion ?? 0) + 1;
          return buildDecision({
            eventKind: "category_reply",
            decisionKind: "respond",
            previousState,
            nextState: "awaiting_item_specification",
            statePatch: withLastMessage(
              mergePatch(basePatch, {
                state: "awaiting_item_specification",
                currentIntent: "expense",
                awaitingField: "item_specification",
                draftType: "expense",
                draftId: effectiveState.draftId,
                draftVersion: nextVersion,
                draftPayload: validatedRetry.value as unknown as Record<string, unknown>,
              }),
              input.sourceMessageId,
            ),
            responseKey: "expense_item_specification_prompt",
            responseParams: {
              valor: currentDraft.value.valor,
              itemSpecificationTrigger: currentDraft.value.trigger,
            },
            nextFallbackCount: 0,
            reasonCode: "item_specification_retry_prompted",
          });
        }
      }
      const categoria: ExpenseCategory =
        engineConcepts.length > 0 ? "Revisão" : currentDraft.value.fallbackCategory;
      const extras = computeMaintenanceDraftExtras(categoria, input.originalText);
      const resolvedVeh = resolveVehicle({
        text: null,
        vehicles: input.vehicles,
        activeVehicleId: effectiveState.activeVehicleId,
      });
      const nextVersion = (effectiveState.draftVersion ?? 0) + 1;
      if (resolvedVeh.kind === "matched") {
        const veh = resolvedVeh.vehicle;
        const candidate = {
          phase: "awaiting_confirmation" as const,
          categoria,
          valor: currentDraft.value.valor,
          vehicleId: veh.id,
          requestMessageId: effectiveState.draftId,
          ...(extras
            ? {
                recognizedTags: extras.recognizedTags,
                descricao: extras.descricaoPreliminar,
                ambiguousFilterMention: extras.ambiguousFilterMention,
              }
            : {}),
        };
        const validated = validateAwaitingConfirmationExpenseDraft(candidate);
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
              categoria,
              ...buildMaintenanceResponseExtras(
                extras
                  ? {
                      recognizedTags: extras.recognizedTags,
                      descricao: extras.descricaoPreliminar,
                      ambiguousFilterMention: extras.ambiguousFilterMention,
                    }
                  : null,
              ),
            },
            nextFallbackCount: 0,
            reasonCode:
              engineConcepts.length > 0
                ? "item_specification_reply_engine_recognized"
                : "item_specification_reply_fallback_category",
          });
        }
      } else if (resolvedVeh.kind === "ambiguous" || resolvedVeh.kind === "not_found") {
        const candidate = {
          phase: "awaiting_vehicle" as const,
          categoria,
          valor: currentDraft.value.valor,
          requestMessageId: effectiveState.draftId,
          ...(extras
            ? {
                recognizedTags: extras.recognizedTags,
                descricaoPreliminar: extras.descricaoPreliminar,
                ambiguousFilterMention: extras.ambiguousFilterMention,
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
            reasonCode: "item_specification_reply_awaiting_vehicle",
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
          reasonCode: "item_specification_reply_no_eligible_vehicle",
        });
      }
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
    const parsed = parseKmUpdateText(input.originalText, "value_reply");
    if (parsed.ok) {
      const activeId = effectiveState.activeVehicleId;
      const veh =
        activeId === null
          ? null
          : (input.vehicles.find((v) => v.id === activeId && v.isEligible && !v.isArchived) ??
            null);
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
      // Build 6a/9 do item 6 — o ID da despesa que originou esta pergunta de
      // km (se houver) foi guardado em effectiveState.draftId por
      // buildExpenseFinalization. Carrega adiante pro draft de km, pra ser
      // recuperado quando a km for confirmada (builds 6b/6c ligam a RPC).
      const linkedExpenseId = isUuid(effectiveState.draftId) ? effectiveState.draftId : undefined;
      const completeCandidate = {
        phase: "awaiting_confirmation" as const,
        vehicleId: veh.id,
        expectedPreviousKm: prev,
        newKm: parsed.newKm,
        requestMessageId: input.sourceMessageId,
        isCorrection,
        ...(linkedExpenseId !== undefined ? { linkedExpenseId } : {}),
      };
      const validated = validateAwaitingConfirmationKmUpdateDraft(completeCandidate);
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
      // Invariante violada — cai no fallback genérico da seção 10.
    } else {
      // Não reconheceu km — verifica se é uma recusa/adiamento reconhecível
      // (padrão amplo) antes de cair no fallback genérico.
      const requestedKmNormalized = normalizeCommandText(input.originalText).normalizedText;
      if (looksLikeRequestedKmUnclearResponse(requestedKmNormalized)) {
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
      // nem número nem recusa reconhecida — cai no fallback genérico da seção 10.
    }
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
      reasonCode:
        effectiveState.state === "awaiting_km_correction"
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
      reasonCode:
        effectiveState.state === "awaiting_km_correction"
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
      reasonCode:
        effectiveState.state === "awaiting_expense_correction"
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
      reasonCode:
        effectiveState.state === "awaiting_expense_correction"
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
    const currentDraft = validateAwaitingConfirmationExpenseDraft(effectiveState.draftPayload);
    if (currentDraft.ok) {
      const semanticResult = recognizeExpenseSemantics({ originalText: input.originalText });
      switch (semanticResult.status) {
        case "resolved": {
          const conceptualCategory = semanticResult.conceptualCategory;
          if (conceptualCategory !== currentDraft.value.categoria) {
            const candidate = {
              phase: "awaiting_confirmation" as const,
              categoria: conceptualCategory,
              valor: currentDraft.value.valor,
              vehicleId: currentDraft.value.vehicleId,
              requestMessageId: currentDraft.value.requestMessageId,
            };
            const validated = validateAwaitingConfirmationExpenseDraft(candidate);
            if (validated.ok) {
              const veh = input.vehicles.find((v) => v.id === currentDraft.value.vehicleId);
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
                  categoria: conceptualCategory,
                },
                nextFallbackCount: 0,
                reasonCode: "expense_category_corrected_at_confirmation",
              });
            }
          }
          // categoria igual à atual (ou validated.ok falhando defensivamente)
          // — mesmo comportamento de hoje: não faz nada, cai no fluxo padrão.
          break;
        }

        // Passo D-4 (P0-3B-R): tentar corrigir a categoria com "revisão"/"ar
        // condicionado"/"manutenção" sozinha agora dispara o mecanismo de
        // especificação de item já existente (D-2/D-3), em vez de ser
        // silenciosamente ignorado. allowRetry: false por decisão de
        // produto — nunca mostrar na tela uma categoria diferente da que
        // será de fato gravada, então não há 2ª chance aqui (diferente das
        // origens de criação, que ganham retry once).
        case "needs_item_specification": {
          const nextVersion = (effectiveState.draftVersion ?? 0) + 1;
          const candidate = {
            phase: "awaiting_item_specification" as const,
            valor: currentDraft.value.valor,
            requestMessageId: currentDraft.value.requestMessageId,
            trigger: semanticResult.trigger,
            fallbackCategory: semanticResult.fallbackCategory,
            allowRetry: false,
            retriedOnce: false,
          };
          const validated = validateAwaitingItemSpecificationDraft(candidate);
          if (validated.ok) {
            return buildDecision({
              eventKind: "category_reply",
              decisionKind: "transition",
              previousState,
              nextState: "awaiting_item_specification",
              statePatch: withLastMessage(
                mergePatch(basePatch, {
                  state: "awaiting_item_specification",
                  currentIntent: "expense",
                  awaitingField: "item_specification",
                  draftType: "expense",
                  draftId: effectiveState.draftId,
                  draftVersion: nextVersion,
                  draftPayload: validated.value as unknown as Record<string, unknown>,
                }),
                input.sourceMessageId,
              ),
              responseKey: "expense_item_specification_prompt",
              responseParams: {
                valor: currentDraft.value.valor,
                itemSpecificationTrigger: semanticResult.trigger,
              },
              nextFallbackCount: 0,
              reasonCode: "expense_category_correction_awaiting_item_specification",
            });
          }
          break;
        }

        // needs_clarification, unsupported e conversation_only: nenhuma
        // mudança de comportamento — mesmo tratamento fail-open de hoje, cai
        // no "sem categoria nova válida" abaixo sem nenhum branch novo.
        case "needs_clarification":
        case "unsupported":
        case "conversation_only":
          break;

        default:
          return assertNever(semanticResult);
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
      reasonCode: expiredHandled ? "expired_then_deny_without_pending" : "deny_without_pending",
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
      // Passo D-1 (P0-3B-R): categoriaHint é só um sinal auxiliar — decide se
      // vale tentar reinterpretar um número solto como valor de despesa, não
      // decide a categoria final (isso é categoriaMatch, mais abaixo, ainda
      // no legado). Por isso "status !== unsupported" é a condição certa
      // aqui: qualquer sinal de categoria, incluindo needs_clarification e
      // needs_item_specification, já justifica tentar a reinterpretação —
      // não precisa ser uma resolução completa (status "resolved").
      const categoriaHint = recognizeExpenseSemantics({ originalText: input.originalText });
      if (
        categoriaHint.status !== "unsupported" &&
        !looksLikeMaintenanceMilestoneReference(input.originalText)
      ) {
        const bareValor = parseExpenseValorBareNumber(input.originalText);
        if (bareValor.ok) {
          parsedValor = bareValor;
        }
      }
      // I4b — simétrico ao I4a, no ramo contrário: só roda quando,
      // genuinamente, nenhum valor foi encontrado nem pela tentativa de
      // reinterpretação acima. Guarda por sinal automotivo (2ª tentativa,
      // corrige a 1ª: usar parseKmUpdateText como guarda era amplo demais —
      // o Ramo 3 dessa regex aceita qualquer "N mil" solto, suprimindo
      // orçamento/futuro/pergunta genuínos que mencionem quilometragem).
      // Mesmo critério já usado no Passo D-1 acima (status !== "unsupported")
      // — só intercepta com a resposta nova se recognizeExpenseSemantics
      // encontrar ALGUM sinal automotivo no texto. Sem sinal automotivo
      // nenhum, ou intenção record_completed_expense/ambiguous: NENHUMA
      // mudança, segue pro fluxo já existente (seção 9.6 KM, depois 10
      // fallback).
      const categoryHintForNoValue = recognizeExpenseSemantics({
        originalText: input.originalText,
      });
      if (categoryHintForNoValue.status !== "unsupported") {
        const noValueIntent = recognizeExpenseIntent(input.originalText);
        if (
          noValueIntent === "request_quote" ||
          noValueIntent === "discuss_future_service" ||
          noValueIntent === "ask_question"
        ) {
          // Duplicado localmente, não extraído pro escopo compartilhado com
          // o mapeamento equivalente do I4a (mais abaixo, dentro de
          // `if (parsedValor.ok)`) — mesma justificativa: extrair exigiria
          // tocar num bloco já mesclado/testado/em produção (PR #61) só pra
          // economizar linhas, sem ganho real. Mesmos 3 valores, mesmo texto.
          const responseKeyByIntent: Record<
            "request_quote" | "discuss_future_service" | "ask_question",
            ConversationResponseKey
          > = {
            request_quote: "expense_quote_acknowledged",
            discuss_future_service: "expense_future_service_acknowledged",
            ask_question: "expense_technical_question_acknowledged",
          };
          const reasonCodeByIntent: Record<
            "request_quote" | "discuss_future_service" | "ask_question",
            string
          > = {
            request_quote: "expense_reported_quote_acknowledged",
            discuss_future_service: "expense_reported_future_service_acknowledged",
            ask_question: "expense_reported_technical_question_acknowledged",
          };
          return buildDecision({
            eventKind: EXPENSE_REPORTED_EVENT_KIND,
            decisionKind: "respond",
            previousState,
            nextState: "idle",
            outcome: expiredOutcome,
            statePatch: withLastMessage(basePatch, input.sourceMessageId),
            responseKey: responseKeyByIntent[noValueIntent],
            nextFallbackCount: 0,
            reasonCode: reasonCodeByIntent[noValueIntent],
          });
        }
      }
    }
    if (parsedValor.ok) {
      // I4a — curto-circuito por intenção explícita, logo que um valor
      // numérico é confirmado. Só os 3 sinais CONFIANTES de não-conclusão
      // (orçamento/futuro/pergunta técnica) desviam do fluxo normal —
      // "ambiguous" é tratado igual a "record_completed_expense" aqui
      // dentro do T1: a própria presença de um valor numérico (condição de
      // entrada deste bloco) já é evidência estrutural suficiente de
      // despesa, mesmo sem verbo de conclusão explícito (ex.: "gasolina
      // 80", "coxim do motor 30" — nenhum dos dois tem verbo, e os dois
      // sempre foram despesas válidas). "ambiguous" só passa a significar
      // algo diferente no I4b (mensagens SEM valor numérico, onde não há
      // essa evidência estrutural). expense_occurrence_clarification
      // (response key já criada e testada) fica SEM USO neste build —
      // reservada para o I4b.
      const expenseIntent = recognizeExpenseIntent(input.originalText);
      if (
        expenseIntent === "request_quote" ||
        expenseIntent === "discuss_future_service" ||
        expenseIntent === "ask_question"
      ) {
        const responseKeyByIntent: Record<
          "request_quote" | "discuss_future_service" | "ask_question",
          ConversationResponseKey
        > = {
          request_quote: "expense_quote_acknowledged",
          discuss_future_service: "expense_future_service_acknowledged",
          ask_question: "expense_technical_question_acknowledged",
        };
        const reasonCodeByIntent: Record<
          "request_quote" | "discuss_future_service" | "ask_question",
          string
        > = {
          request_quote: "expense_reported_quote_acknowledged",
          discuss_future_service: "expense_reported_future_service_acknowledged",
          ask_question: "expense_reported_technical_question_acknowledged",
        };
        return buildDecision({
          eventKind: EXPENSE_REPORTED_EVENT_KIND,
          decisionKind: "respond",
          previousState,
          nextState: "idle",
          outcome: expiredOutcome,
          statePatch: withLastMessage(basePatch, input.sourceMessageId),
          responseKey: responseKeyByIntent[expenseIntent],
          nextFallbackCount: 0,
          reasonCode: reasonCodeByIntent[expenseIntent],
        });
      }

      // expenseIntent === "record_completed_expense" OU "ambiguous": segue
      // EXATAMENTE o comportamento já existente antes deste build, sem
      // nenhuma mudança de lógica de Passo D-1/D-2 abaixo.
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
      // Correção escopada de comportamento desatualizado do parser legado:
      // "revisão"/"revisão preventiva" e "ar condicionado" bare já eram
      // reconhecidos por matchExpenseCategoria (resolvendo direto para uma
      // categoria, sem perguntar qual item), então checar
      // needs_item_specification só DEPOIS de matchExpenseCategoria falhar
      // nunca disparava — matchExpenseCategoria sempre vencia primeiro. Por
      // isso recognizeExpenseSemantics roda ANTES, com prioridade explícita.
      // Para qualquer outro status (resolved, needs_clarification,
      // conversation_only, unsupported) o fluxo abaixo é idêntico ao de
      // antes desta mudança — matchExpenseCategoria decide normalmente.
      const semanticResult = recognizeExpenseSemantics({ originalText: input.originalText });
      if (semanticResult.status === "needs_item_specification") {
        const candidate = {
          phase: "awaiting_item_specification" as const,
          valor: parsedValor.valor,
          requestMessageId: input.sourceMessageId,
          trigger: semanticResult.trigger,
          fallbackCategory: semanticResult.fallbackCategory,
          allowRetry: true,
          retriedOnce: false,
        };
        const validated = validateAwaitingItemSpecificationDraft(candidate);
        if (validated.ok) {
          return buildDecision({
            eventKind: EXPENSE_REPORTED_EVENT_KIND,
            decisionKind: "transition",
            previousState,
            nextState: "awaiting_item_specification",
            statePatch: withLastMessage(
              mergePatch(basePatch, {
                state: "awaiting_item_specification",
                currentIntent: "expense",
                awaitingField: "item_specification",
                draftType: "expense",
                draftId: input.sourceMessageId,
                draftVersion: EXPENSE_CREATE_INITIAL_DRAFT_VERSION,
                draftPayload: validated.value as unknown as Record<string, unknown>,
              }),
              input.sourceMessageId,
            ),
            responseKey: "expense_item_specification_prompt",
            responseParams: {
              valor: parsedValor.valor,
              itemSpecificationTrigger: semanticResult.trigger,
            },
            nextFallbackCount: 0,
            reasonCode: "expense_reported_awaiting_item_specification",
          });
        }
      }
      // Passo D-2 (P0-3B-R): reaproveita semanticResult (já calculado acima
      // para o check de needs_item_specification) em vez de chamar
      // matchExpenseCategoria de novo. switch + assertNever no default, mesmo
      // padrão do adapter (PR #16) — qualquer status futuro não tratado
      // explicitamente aqui quebra a build em vez de cair num branch errado.
      switch (semanticResult.status) {
        case "resolved": {
          const conceptualCategory = semanticResult.conceptualCategory;
          const resolvedVeh = resolveVehicle({
            text: null,
            vehicles: input.vehicles,
            activeVehicleId: effectiveState.activeVehicleId,
          });
          if (resolvedVeh.kind === "matched") {
            const veh = resolvedVeh.vehicle;
            const extras = computeMaintenanceDraftExtras(conceptualCategory, input.originalText);
            const candidate = {
              phase: "awaiting_confirmation" as const,
              categoria: conceptualCategory,
              valor: parsedValor.valor,
              vehicleId: veh.id,
              requestMessageId: input.sourceMessageId,
              ...(extras
                ? {
                    recognizedTags: extras.recognizedTags,
                    descricao: extras.descricaoPreliminar,
                    ambiguousFilterMention: extras.ambiguousFilterMention,
                  }
                : {}),
            };
            const validated = validateAwaitingConfirmationExpenseDraft(candidate);
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
                  categoria: conceptualCategory,
                  ...buildMaintenanceResponseExtras(
                    extras
                      ? {
                          recognizedTags: extras.recognizedTags,
                          descricao: extras.descricaoPreliminar,
                          ambiguousFilterMention: extras.ambiguousFilterMention,
                        }
                      : null,
                  ),
                },
                nextFallbackCount: 0,
                reasonCode: "expense_reported_complete",
              });
            }
          } else {
            const extras = computeMaintenanceDraftExtras(conceptualCategory, input.originalText);
            const candidate = {
              phase: "awaiting_vehicle" as const,
              categoria: conceptualCategory,
              valor: parsedValor.valor,
              requestMessageId: input.sourceMessageId,
              ...(extras
                ? {
                    recognizedTags: extras.recognizedTags,
                    descricaoPreliminar: extras.descricaoPreliminar,
                    ambiguousFilterMention: extras.ambiguousFilterMention,
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
          break;
        }

        // needs_clarification (categoria não-motor ambígua) e unsupported
        // (nenhuma categoria reconhecida) caem no MESMO branch hoje — pede a
        // categoria genericamente com as 8 opções fixas. Diferenciar usando
        // candidateCategories de needs_clarification fica para um sub-passo
        // futuro de melhoria de UX (fora de escopo aqui).
        case "needs_clarification":
        case "unsupported": {
          const rawItems = computeMaintenanceItemsRaw(input.originalText);
          const candidate = {
            phase: "awaiting_category" as const,
            valor: parsedValor.valor,
            requestMessageId: input.sourceMessageId,
            recognizedTags: rawItems.recognizedTags,
            descricaoPreliminar: rawItems.descricaoPreliminar,
            ambiguousFilterMention: rawItems.ambiguousFilterMention,
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
              },
              nextFallbackCount: 0,
              reasonCode: "expense_reported_awaiting_category",
            });
          }
          break;
        }

        // Defensivo — nunca deveria ocorrer neste ponto. needs_item_specification
        // já foi interceptado no bloco logo acima (sempre retorna cedo quando
        // esse status ocorre, então o switch nunca deveria vê-lo aqui).
        // conversation_only é uma garantia estrutural de recognizeExpenseSemantics
        // (o cabeçalho do próprio arquivo confirma que essa função nunca produz
        // esse status) — mas precisa de um case explícito para o switch ser
        // exaustivo (ver assertNever no default). Fail-closed: mesmo
        // comportamento de needs_clarification/unsupported acima.
        case "needs_item_specification":
        case "conversation_only": {
          const rawItems = computeMaintenanceItemsRaw(input.originalText);
          const candidate = {
            phase: "awaiting_category" as const,
            valor: parsedValor.valor,
            requestMessageId: input.sourceMessageId,
            recognizedTags: rawItems.recognizedTags,
            descricaoPreliminar: rawItems.descricaoPreliminar,
            ambiguousFilterMention: rawItems.ambiguousFilterMention,
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
              },
              nextFallbackCount: 0,
              reasonCode: "expense_reported_awaiting_category",
            });
          }
          break;
        }

        default:
          return assertNever(semanticResult);
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
        const validated = validateAwaitingConfirmationKmUpdateDraft(completeCandidate);
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
            reasonCode: isCorrection ? "km_reported_complete_correction" : "km_reported_complete",
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
        const validated = validateAwaitingVehicleKmUpdateDraft(partialCandidate);
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
