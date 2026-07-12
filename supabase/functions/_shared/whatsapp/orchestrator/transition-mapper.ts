// Build 5.7F2E1A.5-MH — Mapper produtivo puro:
//   ConversationCoreDecision → TransitionInput
//
// Reproduz 1:1 a semântica comprovada em MG (test-only) e a promove a um
// módulo produtivo, único e reutilizável. Puro: sem I/O, sem Repository,
// sem RPC, sem banco, sem clock, sem logger, sem side effects.
//
// Este módulo NÃO é importado por worker, webhook, Shadow, test-service ou
// qualquer runtime neste build. Apenas testes e o barrel podem importá-lo.

import type {
  ConversationCoreDecision,
  ConversationDecisionKind,
  ConversationStatePatch,
} from "../conversation/types.ts";
import type {
  OutboundResponsePayload,
  TransitionInput,
} from "./types.ts";
import { RepositoryError } from "./errors.ts";

// ---------------------------------------------------------------------------
// DecisionKinds elegíveis para o trilho applyTransition.
//
// Exclusões (não persistíveis via applyTransition neste contrato):
//   - defer_legacy_media        → tratado pelo pipeline legado
//   - defer_legacy_opt_out      → tratado pelo pipeline legado
//   - no_op                     → nenhuma transição a persistir
//
// Futuros handoffs especializados (ex.: confirm_km_update T2) NÃO são
// ConversationDecisionKind: são handoff kinds discriminados em outro plano
// e por construção nunca chegam a este mapper.
// ---------------------------------------------------------------------------

const PERSISTIBLE_DECISION_KINDS: ReadonlySet<ConversationDecisionKind> =
  new Set<ConversationDecisionKind>([
    "respond",
    "transition",
    "reset_task",
    "reset_conversation",
    "select_vehicle",
    "fallback",
  ]);

export type PersistibleDecisionKind =
  | "respond"
  | "transition"
  | "reset_task"
  | "reset_conversation"
  | "select_vehicle"
  | "fallback";

/**
 * Subtipo fechado de ConversationCoreDecision aceito pelo mapper.
 * Serve como documentação de contrato; a checagem final ocorre em runtime
 * porque ConversationCoreDecision não é uma união discriminada por decisionKind.
 */
export type PersistibleConversationCoreDecision =
  & ConversationCoreDecision
  & { decisionKind: PersistibleDecisionKind };

export type MapConversationDecisionToTransitionInputArgs = Readonly<{
  decision: ConversationCoreDecision;
  queueItemId: string;
  leaseToken: string;
  expectedStateVersion: number;
  orchestratorVersion: string;
}>;

// Corpo sintético usado quando a decisão possui responseKey. O texto real é
// renderizado por responses.ts em camada superior (não é responsabilidade do
// mapper). Mantido idêntico ao mapper local do MG para preservar contrato.
const SYNTHETIC_RESPONSE_TEXT_BODY = "synthetic-body";

/**
 * Converte uma ConversationCoreDecision em TransitionInput imutável, pronto
 * para WhatsappOrchestratorRepository.applyTransition.
 *
 * Regras invariantes:
 *  1. decisionKind fora do allowlist → RepositoryError("non_persistible_decision").
 *  2. lastMessageId é removido do patch (não aceito pela RPC).
 *  3. Propriedades ausentes/undefined em statePatch são preservadas como
 *     ausentes na cópia (não são materializadas como null).
 *  4. Se patch.state estiver ausente, injeta decision.nextState.
 *     Se patch.state estiver presente e divergir de decision.nextState,
 *     lança RepositoryError("state_mismatch") — nunca escolhe silenciosamente.
 *  5. null explícito no patch é preservado (semântica de limpeza da RPC).
 *  6. resultSummary usa camelCase estrito (decisionKind, eventKind, outcome).
 *  7. response é derivado de responseKey; ausente/null quando responseKey é null.
 *  8. Nenhum campo da decisão original é mutado.
 */
export function mapConversationDecisionToTransitionInput(
  args: MapConversationDecisionToTransitionInputArgs,
): TransitionInput {
  const {
    decision,
    queueItemId,
    leaseToken,
    expectedStateVersion,
    orchestratorVersion,
  } = args;

  if (!PERSISTIBLE_DECISION_KINDS.has(decision.decisionKind)) {
    throw new RepositoryError(
      "non_persistible_decision",
      `decisionKind not eligible for applyTransition: ${decision.decisionKind}`,
    );
  }

  const patch: ConversationStatePatch = {};
  for (
    const [key, value] of Object.entries(decision.statePatch) as [
      keyof ConversationStatePatch,
      unknown,
    ][]
  ) {
    if (key === "lastMessageId") continue; // não aceito pela RPC
    if (value === undefined) continue;      // preserva omissão
    (patch as Record<string, unknown>)[key] = value;
  }

  if (patch.state === undefined) {
    patch.state = decision.nextState;
  } else if (patch.state !== decision.nextState) {
    throw new RepositoryError(
      "state_mismatch",
      "patch.state diverges from decision.nextState",
    );
  }

  const response: OutboundResponsePayload | null = decision.responseKey
    ? {
      responseKey: decision.responseKey,
      textBody: SYNTHETIC_RESPONSE_TEXT_BODY,
    }
    : null;

  return {
    queueItemId,
    leaseToken,
    expectedStateVersion,
    patch,
    orchestratorVersion,
    resultSummary: {
      decisionKind: decision.decisionKind,
      eventKind: decision.eventKind,
      outcome: decision.outcome,
    },
    response,
  };
}
