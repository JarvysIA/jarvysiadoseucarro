// Build 5.7F2E1A.5-MH.1 — Mapper produtivo puro:
//   ConversationCoreDecision → TransitionInput
//
// Corrige o BUILD MH removendo qualquer fabricação de resposta. O mapper
// agora exige que o chamador forneça explicitamente a `response` real (ou
// null) já preparada em camada superior, valida a coerência com a decisão
// e apenas a transporta. Continua puro: sem I/O, sem Repository, sem RPC,
// sem banco, sem clock, sem logger, sem side effects, sem renderer,
// sem templates, sem texto sintético.
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
  /**
   * Response real já preparada pelo chamador em camada superior (renderer
   * externo). Deve ser `null` quando — e somente quando — a decisão não
   * possui `responseKey`. Quando fornecida, seu `responseKey` deve ser
   * exatamente igual ao da decisão. O mapper apenas a transporta:
   * NUNCA fabrica textBody, NUNCA renderiza, NUNCA aplica fallback.
   */
  response: OutboundResponsePayload | null;
}>;

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
 *  7. response é apenas transportada do argumento; coerência com responseKey
 *     é validada, mas nenhum textBody é fabricado.
 *  8. Nenhum campo da decisão ou da response original é mutado.
 *  9. patch.fallbackCount é SEMPRE definido a partir de
 *     decision.nextFallbackCount (nunca omitido — é um campo obrigatório
 *     da decisão), prevalecendo sobre qualquer valor porventura já
 *     presente em decision.statePatch.fallbackCount.
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
    response: providedResponse,
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

  // fallback_count — pré-requisito C9: decision.nextFallbackCount é
  // OBRIGATÓRIO em toda ConversationCoreDecision (nunca omitido/undefined),
  // então SEMPRE é incluído no patch, nunca condicionalmente. Nenhum lugar
  // do core.ts hoje define statePatch.fallbackCount (confirmado por grep no
  // checkpoint deste build) — mas caso algum decisor futuro o faça, decisão
  // explícita: decision.nextFallbackCount é a fonte única de verdade e
  // SEMPRE prevalece, sobrescrevendo o que o loop acima já tiver copiado de
  // decision.statePatch.fallbackCount.
  patch.fallbackCount = decision.nextFallbackCount;

  if (patch.state === undefined) {
    patch.state = decision.nextState;
  } else if (patch.state !== decision.nextState) {
    throw new RepositoryError(
      "state_mismatch",
      "patch.state diverges from decision.nextState",
    );
  }

  const response = validateAndCopyResponse(decision.responseKey, providedResponse);

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

/**
 * Valida a coerência entre `decision.responseKey` e a `response` fornecida
 * pelo chamador. Retorna uma cópia rasa imutável da response (ou null).
 *
 * O mapper NUNCA fabrica textBody nem invoca renderer. Toda mensagem real
 * deve chegar aqui já preparada.
 */
function validateAndCopyResponse(
  responseKey: string | null,
  provided: OutboundResponsePayload | null,
): OutboundResponsePayload | null {
  if (responseKey === null || responseKey === undefined) {
    if (provided !== null) {
      throw new RepositoryError(
        "response_unexpected",
        "response provided but decision has no responseKey",
      );
    }
    return null;
  }

  if (provided === null) {
    throw new RepositoryError(
      "response_missing",
      "decision has responseKey but no response was provided",
    );
  }

  if (provided.responseKey !== responseKey) {
    throw new RepositoryError(
      "response_key_mismatch",
      "provided response.responseKey diverges from decision.responseKey",
    );
  }

  // Cópia rasa imutável — não referencia o objeto original.
  const copy: OutboundResponsePayload = {
    responseKey: provided.responseKey,
    textBody: provided.textBody,
  };
  if (provided.messageType !== undefined) copy.messageType = provided.messageType;
  if (provided.purpose !== undefined) copy.purpose = provided.purpose;
  if (provided.priority !== undefined) copy.priority = provided.priority;
  if (provided.scheduledAt !== undefined) copy.scheduledAt = provided.scheduledAt;
  if (provided.expiresAt !== undefined) copy.expiresAt = provided.expiresAt;
  return copy;
}
