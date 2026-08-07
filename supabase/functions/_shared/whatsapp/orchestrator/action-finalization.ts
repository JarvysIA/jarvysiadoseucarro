// Lógica PURA de finalização de ações confirmadas (km update e expense
// create) — decide a transição de estado e a resposta após a RPC de
// execução retornar. Extraído de test-service.ts (Build de limpeza,
// sem mudança de comportamento) porque, apesar de pura e reaproveitável,
// morava num arquivo cujo cabeçalho declara "TOTALMENTE DESCONECTADO...
// nunca ligado ao worker real" — o que causaria confusão na hora do
// wiring real (item 10), que PODE e DEVE importar estas funções daqui.
// Nenhuma lógica foi alterada nesta extração.

import type {
  ConversationCoreDecision,
  ConversationStatePatch,
  ConversationVehicle,
} from "../conversation/types.ts";
import type { ConfirmedKmUpdateResult } from "../actions/types.ts";
import type { ConfirmedExpenseCreateResult } from "../actions/expense-types.ts";
import type { LoadContextResult } from "./types.ts";

const MAINTENANCE_TAG_ORDER: ReadonlyArray<string> = [
  "oleo",
  "filtro",
  "pastilha",
  "arrefecimento",
];

const DESCRICAO_FINAL_MAX_CHARS = 500;

/**
 * Compõe a descrição final da despesa: texto livre do usuário (se houver)
 * + as tags reconhecidas (na ordem fixa oleo/filtro/pastilha/arrefecimento),
 * que o gatilho atualizar_revisao_veiculo já sabe interpretar. Trunca o
 * texto livre se necessário pra nunca estourar o limite de 500 caracteres
 * que a validação de despesa já impõe — prioriza preservar as tags.
 */
export function buildFinalDescricao(
  descricao: string | null | undefined,
  recognizedTags: ReadonlyArray<string> | undefined,
): string | null {
  const tags = recognizedTags ?? [];
  const orderedTags = MAINTENANCE_TAG_ORDER.filter((t) => tags.includes(t));
  const tagsSuffix = orderedTags.map((t) => ` [${t}]`).join("");
  const maxTextLen = Math.max(0, DESCRICAO_FINAL_MAX_CHARS - tagsSuffix.length);
  const baseText = (descricao ?? "").trim().slice(0, maxTextLen);
  const combined = (baseText + tagsSuffix).trim();
  return combined.length > 0 ? combined : null;
}

export function buildKmVehicleLabel(
  vehicles: ConversationVehicle[],
  vehicleId: string,
): string | undefined {
  const v = vehicles.find((x) => x.id === vehicleId);
  if (!v) return undefined;
  const label = [v.brand, v.model]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ");
  return label.length > 0 ? label : undefined;
}

export type KmFinalization =
  | { kind: "finalize"; decision: ConversationCoreDecision }
  | { kind: "retry" }
  | { kind: "invariant" };

export function buildKmFinalization(
  result: ConfirmedKmUpdateResult,
  ctx: Extract<LoadContextResult, { kind: "ok" }>,
  vehicleId: string,
): KmFinalization {
  const clearingPatch: ConversationStatePatch = {
    state: "idle",
    draftType: null,
    draftId: null,
    draftVersion: 0,
    draftPayload: null,
    confirmedAt: null,
    executedAt: null,
  };
  const vehicleLabel = buildKmVehicleLabel(ctx.context.vehicles, vehicleId);
  const base = {
    previousState: ctx.context.state.state,
    nextState: "idle" as const,
    statePatch: clearingPatch,
    nextFallbackCount: ctx.context.fallbackCount,
    deferToLegacyRouter: false,
    deferToLegacyOptOut: false,
  };
  switch (result.kind) {
    case "completed":
    case "replayed":
      return {
        kind: "finalize",
        decision: {
          ...base,
          eventKind: "confirm",
          decisionKind: "transition",
          outcome: "completed",
          responseKey: "km_update_applied",
          responseParams: { vehicleLabel, newKm: result.newKm },
          reasonCode: `km_action_${result.kind}`,
        },
      };
    case "no_op":
      return {
        kind: "finalize",
        decision: {
          ...base,
          eventKind: "confirm",
          decisionKind: "transition",
          outcome: "completed",
          responseKey: "km_update_no_change",
          responseParams: { vehicleLabel, newKm: result.currentKm ?? undefined },
          reasonCode: "km_action_no_op",
        },
      };
    case "rejected":
      return {
        kind: "finalize",
        decision: {
          ...base,
          eventKind: "confirm",
          decisionKind: "transition",
          outcome: "cancelled",
          responseKey: "km_update_retry_needed",
          responseParams: {},
          reasonCode: `km_action_rejected_${result.reason}`,
        },
      };
    case "conflicted":
      return {
        kind: "finalize",
        decision: {
          ...base,
          eventKind: "confirm",
          decisionKind: "transition",
          outcome: "cancelled",
          responseKey: "km_update_retry_needed",
          responseParams: {},
          reasonCode: `km_action_conflicted_${result.reason}`,
        },
      };
    case "transient_failure":
    case "outcome_unknown":
      return { kind: "retry" };
    case "malformed":
      return { kind: "invariant" };
  }
}

// ============================================================
// Expense finalization (mirror de buildKmFinalization, sem no_op)
// ============================================================

export type ExpenseFinalization =
  | { kind: "finalize"; decision: ConversationCoreDecision }
  | { kind: "retry" }
  | { kind: "invariant" };

export function buildExpenseFinalization(
  result: ConfirmedExpenseCreateResult,
  ctx: Extract<LoadContextResult, { kind: "ok" }>,
  vehicleId: string,
): ExpenseFinalization {
  const clearingPatch: ConversationStatePatch = {
    state: "idle",
    draftType: null,
    draftId: null,
    draftVersion: 0,
    draftPayload: null,
    confirmedAt: null,
    executedAt: null,
  };
  const vehicleLabel = buildKmVehicleLabel(ctx.context.vehicles, vehicleId);
  const baseCleared = {
    previousState: ctx.context.state.state,
    nextState: "idle" as const,
    statePatch: clearingPatch,
    nextFallbackCount: ctx.context.fallbackCount,
    deferToLegacyRouter: false,
    deferToLegacyOptOut: false,
  };
  switch (result.kind) {
    case "completed":
    case "replayed": {
      // Build 6a/9 do item 6 — guarda o ID da despesa recém-criada em
      // draftId, pra "viajar" durante o awaiting_requested_km e ser
      // recuperado quando a km for confirmada (ver core.ts, seção 6.6).
      const kmPromptPatch: ConversationStatePatch = {
        state: "awaiting_requested_km",
        currentIntent: "km_update",
        awaitingField: "requested_km",
        requestSource: "system",
        draftType: null,
        draftId: result.despesaId,
        draftVersion: 0,
        draftPayload: null,
        confirmedAt: null,
        executedAt: null,
      };
      return {
        kind: "finalize",
        decision: {
          previousState: ctx.context.state.state,
          nextState: "awaiting_requested_km" as const,
          statePatch: kmPromptPatch,
          nextFallbackCount: ctx.context.fallbackCount,
          deferToLegacyRouter: false,
          deferToLegacyOptOut: false,
          eventKind: "confirm",
          decisionKind: "transition",
          outcome: "completed",
          responseKey: "expense_create_completed_with_km_prompt",
          responseParams: {
            vehicleLabel,
            valor: result.valor,
            categoria: result.categoria,
          },
          reasonCode: `expense_action_${result.kind}_with_km_trigger`,
        },
      };
    }
    case "rejected":
      return {
        kind: "finalize",
        decision: {
          ...baseCleared,
          eventKind: "confirm",
          decisionKind: "transition",
          outcome: "cancelled",
          responseKey: "expense_create_retry_needed",
          responseParams: {},
          reasonCode: `expense_action_rejected_${result.reason}`,
        },
      };
    case "conflicted":
      return {
        kind: "finalize",
        decision: {
          ...baseCleared,
          eventKind: "confirm",
          decisionKind: "transition",
          outcome: "cancelled",
          responseKey: "expense_create_retry_needed",
          responseParams: {},
          reasonCode: `expense_action_conflicted_${result.reason}`,
        },
      };
    case "transient_failure":
    case "outcome_unknown":
      return { kind: "retry" };
    case "malformed":
      return { kind: "invariant" };
  }
}
