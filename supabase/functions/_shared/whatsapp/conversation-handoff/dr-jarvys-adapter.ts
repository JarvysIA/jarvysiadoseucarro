// C3 — Adapter que traduz entre askDrJarvys (a camada de IA conversacional
// livre, em ../dr-jarvys/) e o contrato C1 (./contract.ts). Só mapeia forma
// — nunca decide o que a IA faz por dentro, nunca resolve o contexto do
// veículo a partir do identificador dele (isso é C4; o adapter só repassa
// o que recebeu de fora), e nunca conecta ao executor real do C2B (isso é
// C8 — o único contrato que este módulo cumpre é exportar uma função de
// assinatura compatível com o `invoke` esperado por lá). Sem Supabase, sem
// banco, sem fetch próprio — a única chamada de rede é a que já existe
// dentro de askDrJarvys.

import {
  askDrJarvys,
  OUT_OF_SCOPE_TEXT,
  type AskDrJarvysResult,
  type DrJarvysVehicleContext,
} from "../dr-jarvys/ask-dr-jarvys.ts";
import type { ConversationExecutionResult, ConversationHandoffCommandV1 } from "./contract.ts";

// Mesma forma estrutural do invoker usado pelo executor do C2B — redeclarada
// localmente (nunca importada) porque este módulo não pode depender do
// contrato agregado nem do executor (isso é integração futura, C8). O
// parâmetro usa o tipo-base do C1 (não as variantes "primary"/"supplemental"
// do agregado, que vivem no contrato agregado) — o adapter trata os dois
// segmentos de forma idêntica, então a distinção não importa aqui. Como
// TypeScript tipa por estrutura (e por contravariância de parâmetros), uma
// função que aceita o tipo-base já é compatível com o `invoke` esperado
// pelo executor, que aceita só as duas variantes mais específicas.
export type ConversationHandoffInvokerV1 = (
  command: ConversationHandoffCommandV1,
) => Promise<unknown>;

// Só os dois erros de validação de entrada do askDrJarvys — culpa do texto
// em si — caem em permanent_failure/invalid_request. Qualquer outra string
// de erro (rate limit, créditos, chave ausente, gateway, resposta inválida
// da IA, ou qualquer mensagem não reconhecida) é tratada como serviço
// indisponível, nunca como pedido inválido.
const PERMANENT_FAILURE_ERRORS: ReadonlySet<string> = new Set([
  "userText é obrigatório",
  "Mensagem muito longa.",
]);

// Traduz o resultado bruto do askDrJarvys para o contrato fechado do C1.
// Nunca repassa error.message, stack ou qualquer texto bruto do askDrJarvys
// — só os status e reasons já fechados em ConversationExecutionResult. O
// texto de error só é usado para checar pertencimento ao conjunto acima,
// nunca é copiado para o resultado retornado.
function mapAskDrJarvysResult(result: AskDrJarvysResult): ConversationExecutionResult {
  if (result.ok) {
    if (result.inScope) {
      return { status: "success", responseText: result.response };
    }
    return { status: "success", responseText: OUT_OF_SCOPE_TEXT };
  }

  if (PERMANENT_FAILURE_ERRORS.has(result.error)) {
    return { status: "permanent_failure", reason: "invalid_request" };
  }

  return { status: "transient_failure", reason: "temporarily_unavailable" };
}

export function createAskDrJarvysInvoker(
  vehicleContext?: DrJarvysVehicleContext,
): ConversationHandoffInvokerV1 {
  return async (command) => {
    const userText = command.originalText;
    const result = await askDrJarvys(
      vehicleContext === undefined ? { userText } : { userText, vehicleContext },
    );
    return mapAskDrJarvysResult(result);
  };
}
