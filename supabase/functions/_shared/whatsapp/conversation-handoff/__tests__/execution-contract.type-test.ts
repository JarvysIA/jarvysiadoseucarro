// Type-tests puros do C2A. Este arquivo não é executado por `bun test` — ele
// só existe para ser verificado por `tsc --noEmit` (gate dedicado). Cada
// `@ts-expect-error` documenta uma variante inválida que o compilador deve
// rejeitar; nenhuma diretiva pode sobrar sem uso (o próprio tsc reporta isso).

import {
  CONVERSATION_HANDOFF_CONTRACT_VERSION,
  type ConversationExecutionResult,
} from "../contract.ts";
import type {
  ConversationHandoffCompletedExecutionResultV1,
  ConversationHandoffExecutionCommandV1,
  ConversationHandoffExecutionResultV1,
  ConversationHandoffPartiallyCompletedExecutionResultV1,
  ConversationHandoffPrimaryCommandV1,
  ConversationHandoffPrimaryFailedExecutionResultV1,
  ConversationHandoffPrimaryOutcomeUncertainExecutionResultV1,
  ConversationHandoffPrimarySucceededExecutionResultV1,
  ConversationHandoffSupplementalCommandV1,
  ConversationHandoffSupplementalOutcomeUncertainExecutionResultV1,
} from "../execution-contract.ts";

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

// 87. Aceita literal primary correto (compila).
const validPrimary: ConversationHandoffPrimaryCommandV1 = {
  version: CONVERSATION_HANDOFF_CONTRACT_VERSION,
  kind: "conversation",
  segment: "primary",
  contactId: CONTACT_ID,
  userId: USER_ID,
  vehicleId: VEHICLE_ID,
  sourceMessageId: SOURCE_MESSAGE_ID,
  originalText: "texto",
};

// 88. Aceita literal supplemental correto (compila).
const validSupplemental: ConversationHandoffSupplementalCommandV1 = {
  ...validPrimary,
  segment: "supplemental",
};

// 89. @ts-expect-error: segment "supplemental" não pode ocupar o slot primary.
const aggregateWithWrongPrimarySlot: ConversationHandoffExecutionCommandV1 = {
  // @ts-expect-error segment "supplemental" não é atribuível ao slot primary
  primary: validSupplemental,
};
void aggregateWithWrongPrimarySlot;

// 90. @ts-expect-error: segment "primary" não pode ocupar o slot supplemental.
const aggregateWithWrongSupplementalSlot: ConversationHandoffExecutionCommandV1 = {
  primary: validPrimary,
  // @ts-expect-error segment "primary" não é atribuível ao slot supplemental
  supplemental: validPrimary,
};
void aggregateWithWrongSupplementalSlot;

// 91. @ts-expect-error: propriedade extra não permitida no tipo do comando agregado.
const aggregateWithExtraField: ConversationHandoffExecutionCommandV1 = {
  primary: validPrimary,
  // @ts-expect-error "extra" não faz parte do tipo agregado (allowlist estrita)
  extra: true,
};
void aggregateWithExtraField;

// 92. @ts-expect-error: supplemental: undefined explícito sob exactOptionalPropertyTypes.
// @ts-expect-error exactOptionalPropertyTypes proíbe undefined explícito na chave opcional
const aggregateWithExplicitUndefined: ConversationHandoffExecutionCommandV1 = {
  primary: validPrimary,
  supplemental: undefined,
};
void aggregateWithExplicitUndefined;

// 93. Aceita construção válida de cada uma das 6 variantes do resultado (compila).
const commandWithoutSupplemental: ConversationHandoffExecutionCommandV1 = { primary: validPrimary };
const commandWithSupplemental: ConversationHandoffExecutionCommandV1 = {
  primary: validPrimary,
  supplemental: validSupplemental,
};

const successResult: Extract<ConversationExecutionResult, { status: "success" }> = {
  status: "success",
  responseText: "ok",
};
const nonSuccessResult: Exclude<ConversationExecutionResult, { status: "success" }> = {
  status: "blocked",
  reason: "authorization_required",
};

const primarySucceeded: ConversationHandoffPrimarySucceededExecutionResultV1 = {
  status: "primary_succeeded",
  command: commandWithoutSupplemental,
  primaryResult: successResult,
};
void primarySucceeded;

const primaryFailed: ConversationHandoffPrimaryFailedExecutionResultV1 = {
  status: "primary_failed",
  command: commandWithoutSupplemental,
  primaryResult: nonSuccessResult,
};
void primaryFailed;

const completed: ConversationHandoffCompletedExecutionResultV1 = {
  status: "completed",
  command: commandWithSupplemental,
  primaryResult: successResult,
  supplementalResult: successResult,
};
void completed;

const partiallyCompleted: ConversationHandoffPartiallyCompletedExecutionResultV1 = {
  status: "partially_completed",
  command: commandWithSupplemental,
  primaryResult: successResult,
  supplementalResult: nonSuccessResult,
};
void partiallyCompleted;

const primaryUncertain: ConversationHandoffPrimaryOutcomeUncertainExecutionResultV1 = {
  status: "primary_outcome_uncertain",
  command: commandWithoutSupplemental,
  reason: "exception_thrown",
};
void primaryUncertain;

const supplementalUncertain: ConversationHandoffSupplementalOutcomeUncertainExecutionResultV1 = {
  status: "supplemental_outcome_uncertain",
  command: commandWithSupplemental,
  primaryResult: successResult,
  reason: "invalid_result",
};
void supplementalUncertain;

// 94. @ts-expect-error: um ConversationExecutionResult (C1) não é um resultado agregado (C2A).
// @ts-expect-error um ConversationExecutionResult isolado do C1 não é assignável ao tipo agregado
const wrongAssignment: ConversationHandoffExecutionResultV1 = successResult;
void wrongAssignment;

// 95. @ts-expect-error: campo proibido da combinação impossível (primaryResult em outcome incerto).
const impossibleUncertain: ConversationHandoffPrimaryOutcomeUncertainExecutionResultV1 = {
  status: "primary_outcome_uncertain",
  command: commandWithoutSupplemental,
  reason: "exception_thrown",
  // @ts-expect-error primaryResult não é permitido em primary_outcome_uncertain
  primaryResult: successResult,
};
void impossibleUncertain;

// 96. @ts-expect-error: discriminante desconhecido no status agregado.
const unknownStatusResult: ConversationHandoffExecutionResultV1 = {
  // @ts-expect-error "unknown_status" não é um discriminante válido da união
  status: "unknown_status",
  command: commandWithoutSupplemental,
  primaryResult: successResult,
};
void unknownStatusResult;

// 97. @ts-expect-error: variante sem campo obrigatório (command ausente).
// @ts-expect-error command é obrigatório e está ausente nesta variante
const missingCommandResult: ConversationHandoffPrimarySucceededExecutionResultV1 = {
  status: "primary_succeeded",
  primaryResult: successResult,
};
void missingCommandResult;

// 98. Função de exaustividade (switch com default assertNever) compila sem `any` em nenhum branch.
function assertNever(value: never): never {
  throw new Error(`estado inesperado: ${JSON.stringify(value)}`);
}

function describeExecutionResult(result: ConversationHandoffExecutionResultV1): string {
  switch (result.status) {
    case "primary_succeeded":
      return "primary_succeeded";
    case "primary_failed":
      return "primary_failed";
    case "completed":
      return "completed";
    case "partially_completed":
      return "partially_completed";
    case "primary_outcome_uncertain":
      return "primary_outcome_uncertain";
    case "supplemental_outcome_uncertain":
      return "supplemental_outcome_uncertain";
    default:
      return assertNever(result);
  }
}
void describeExecutionResult;

// 99. Todas as diretivas @ts-expect-error acima são efetivamente consumidas —
// verificado pelo próprio gate `tsc --noEmit`, que falha com "Unused
// '@ts-expect-error' directive" caso alguma delas não corresponda a um erro
// real na linha seguinte.
