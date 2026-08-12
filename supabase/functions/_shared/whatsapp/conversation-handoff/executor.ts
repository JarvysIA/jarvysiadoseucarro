// C2B — Executor puro e desconectado do handoff `conversation`. Sequencia
// primary → supplemental (nunca em paralelo) sobre uma função de invocação
// injetada pelo chamador. Este módulo NÃO decide o que a invocação faz por
// dentro (isso é C3 / Dr. Jarvys), não chama IA, não acessa rede/banco/
// filesystem, não faz retry, rollback ou compensação, e não produz nenhum
// efeito colateral próprio — só orquestra a sequência e monta o resultado
// agregado a partir dos validators já existentes no C1 (../contract.ts).
//
// Toda validação de forma/tipo é delegada a validateConversationExecutionResult
// (C1). Este módulo nunca reimplementa regra de validação alguma — apenas
// decide, a partir do resultado JÁ validado, qual variante do C2A
// (ConversationHandoffExecutionResultV1) produzir.

import {
  validateConversationExecutionResult,
  type ConversationExecutionResult,
} from "./contract.ts";
import type {
  ConversationHandoffExecutionCommandV1,
  ConversationHandoffExecutionResultV1,
  ConversationHandoffPrimaryCommandV1,
  ConversationHandoffSupplementalCommandV1,
  ConversationHandoffUncertainReasonV1,
} from "./execution-contract.ts";

export type ConversationHandoffInvokerV1 = (
  command: ConversationHandoffPrimaryCommandV1 | ConversationHandoffSupplementalCommandV1,
) => Promise<unknown>;

type SegmentOutcome =
  | Readonly<{ kind: "resolved"; value: ConversationExecutionResult }>
  | Readonly<{ kind: "uncertain"; reason: ConversationHandoffUncertainReasonV1 }>;

// Invoca um único segmento (primary OU supplemental) e traduz o par
// (exceção | retorno bruto) para um outcome de segmento. Nunca inspeciona o
// motivo real da exceção nem o conteúdo real de um retorno inválido — só o
// código literal "exception_thrown"/"invalid_result" chega ao resultado
// final, nunca a mensagem, stack ou payload bruto.
async function runSegment(
  segmentCommand: ConversationHandoffPrimaryCommandV1 | ConversationHandoffSupplementalCommandV1,
  invoke: ConversationHandoffInvokerV1,
): Promise<SegmentOutcome> {
  let rawResult: unknown;
  try {
    rawResult = await invoke(segmentCommand);
  } catch {
    return { kind: "uncertain", reason: "exception_thrown" };
  }

  const validated = validateConversationExecutionResult(rawResult);
  if (!validated.ok) {
    return { kind: "uncertain", reason: "invalid_result" };
  }
  return { kind: "resolved", value: validated.value };
}

export async function executeConversationHandoffV1(
  command: ConversationHandoffExecutionCommandV1,
  invoke: ConversationHandoffInvokerV1,
): Promise<ConversationHandoffExecutionResultV1> {
  const primaryOutcome = await runSegment(command.primary, invoke);

  if (primaryOutcome.kind === "uncertain") {
    return {
      status: "primary_outcome_uncertain",
      command,
      reason: primaryOutcome.reason,
    };
  }

  const primaryResult = primaryOutcome.value;
  if (primaryResult.status !== "success") {
    return {
      status: "primary_failed",
      command,
      primaryResult,
    };
  }

  if (command.supplemental === undefined) {
    return {
      status: "primary_succeeded",
      command,
      primaryResult,
    };
  }

  // O invoke do supplemental só é chamado aqui, depois que `await` acima já
  // resolveu a promise do primary por completo — nunca em paralelo, nunca
  // combinando as duas promises de forma concorrente.
  const supplementalOutcome = await runSegment(command.supplemental, invoke);

  if (supplementalOutcome.kind === "uncertain") {
    return {
      status: "supplemental_outcome_uncertain",
      command,
      primaryResult,
      reason: supplementalOutcome.reason,
    };
  }

  const supplementalResult = supplementalOutcome.value;
  if (supplementalResult.status === "success") {
    return {
      status: "completed",
      command,
      primaryResult,
      supplementalResult,
    };
  }

  return {
    status: "partially_completed",
    command,
    primaryResult,
    supplementalResult,
  };
}
