// Type-tests puros do C2B. Este arquivo não é executado por `bun test` — só
// por `tsc --noEmit` (gate dedicado). Cada `@ts-expect-error` documenta uma
// forma inválida que o compilador deve rejeitar; nenhuma diretiva pode sobrar
// sem uso (o próprio tsc reporta isso).

import { CONVERSATION_HANDOFF_CONTRACT_VERSION } from "../contract.ts";
import type {
  ConversationHandoffExecutionCommandV1,
  ConversationHandoffExecutionResultV1,
  ConversationHandoffPrimaryCommandV1,
} from "../execution-contract.ts";
import { executeConversationHandoffV1, type ConversationHandoffInvokerV1 } from "../executor.ts";

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

const primaryCommand: ConversationHandoffPrimaryCommandV1 = {
  version: CONVERSATION_HANDOFF_CONTRACT_VERSION,
  kind: "conversation",
  segment: "primary",
  contactId: CONTACT_ID,
  userId: USER_ID,
  vehicleId: VEHICLE_ID,
  sourceMessageId: SOURCE_MESSAGE_ID,
  originalText: "texto",
};

const command: ConversationHandoffExecutionCommandV1 = { primary: primaryCommand };

// 34. ConversationHandoffInvokerV1 aceita apenas os 2 tipos de comando como
// parâmetro (primary | supplemental) — compila.
const validInvoker: ConversationHandoffInvokerV1 = async (segmentCommand) => {
  void segmentCommand.segment; // ambos os membros da união têm "segment"
  return { status: "success", responseText: "ok" };
};
void validInvoker;

// 35. @ts-expect-error: invoker com assinatura incompatível não compila.
// @ts-expect-error um invoker que só aceita string não satisfaz ConversationHandoffInvokerV1
const invalidInvoker: ConversationHandoffInvokerV1 = async (segmentCommand: string) => {
  void segmentCommand;
  return "ok";
};
void invalidInvoker;

// 36. executeConversationHandoffV1 retorna Promise<ConversationHandoffExecutionResultV1> — compila.
const resultPromise: Promise<ConversationHandoffExecutionResultV1> = executeConversationHandoffV1(
  command,
  validInvoker,
);
void resultPromise;

// 37. @ts-expect-error: tratar o retorno como um tipo incompatível.
async function wrongReturnUsage(): Promise<void> {
  const result = await executeConversationHandoffV1(command, validInvoker);
  // @ts-expect-error o resultado agregado não tem "responseText" na raiz
  void result.responseText;
}
void wrongReturnUsage;

// 38. Função de exaustividade (switch com default assertNever) compila sem `any` em nenhum branch.
function assertNever(value: never): never {
  throw new Error(`estado inesperado: ${JSON.stringify(value)}`);
}

function describeResult(result: ConversationHandoffExecutionResultV1): string {
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
void describeResult;

// 39. Nenhuma diretiva @ts-expect-error deste arquivo fica sem uso —
// verificado pelo próprio gate `tsc --noEmit`, que falha com "Unused
// '@ts-expect-error' directive" caso alguma delas não corresponda a um erro
// real na linha seguinte.
