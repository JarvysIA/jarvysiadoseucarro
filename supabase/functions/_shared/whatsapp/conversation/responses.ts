// Build 5.7F2A — Renderização de respostas do orquestrador.
// Puro. Nenhuma referência a API/banco/fila/provider/Z-API/erro interno/promessas
// de recursos ainda não ativos. No máximo um emoji por mensagem.

import type {
  ConversationResponseKey,
  ConversationResponseParams,
} from "./types.ts";

export function renderResponse(
  key: ConversationResponseKey,
  params: ConversationResponseParams = {},
): string {
  switch (key) {
    case "greeting":
      return "Oi! Sou o Jarvys 👋 Como posso ajudar com seu carro?";
    case "help":
      return "Pode falar do seu jeito. Me diga o que você precisa sobre seu carro.";
    case "nothing_to_confirm":
      return "Não tem nada aguardando confirmação agora. O que você precisa?";
    case "nothing_to_cancel":
      return "Não tem nada em andamento por aqui.";
    case "task_cancelled":
      return "Tudo bem, cancelei. O que você precisa agora?";
    case "conversation_reset":
      return "Recomeçamos por aqui. O que você precisa sobre seu carro?";
    case "vehicle_selected": {
      const label = params.vehicleLabel ?? "seu carro";
      return `Combinado, vamos falar do ${label}.`;
    }
    case "vehicle_ambiguous": {
      const opts = params.options && params.options.length > 0
        ? params.options.join(" ou ")
        : "qual carro";
      return `Você quer o ${opts}?`;
    }
    case "vehicle_not_found":
      return "Não achei esse carro na sua lista. Pode me dizer o modelo ou a placa?";
    case "no_eligible_vehicle":
      return "Você ainda não tem carro cadastrado no app.";
    case "fallback_first":
      return "Não entendi direito. Pode me explicar de outro jeito?";
    case "fallback_second":
      return "Desculpa, ainda não consegui entender. Me diga em uma frase o que você precisa.";
    case "fallback_reset":
      return "Vamos começar de novo. O que você precisa sobre seu carro?";
    case "km_update_confirmation": {
      const label = params.vehicleLabel ?? "seu carro";
      const nk = formatKm(params.newKm);
      const prev = params.previousKm;
      if (typeof prev === "number") {
        return `Anotar ${nk} km no ${label} (hoje está ${formatKm(prev)} km)? Responda sim para confirmar ou não para cancelar.`;
      }
      return `Anotar ${nk} km no ${label}? Responda sim para confirmar ou não para cancelar.`;
    }
    case "km_update_correction_confirmation": {
      const label = params.vehicleLabel ?? "seu carro";
      const nk = formatKm(params.newKm);
      const prev = formatKm(params.previousKm ?? undefined);
      return `O ${label} está com ${prev} km. Corrigir para ${nk} km (valor menor)? Responda sim para confirmar.`;
    }
    case "km_update_applied": {
      const label = params.vehicleLabel ?? "seu carro";
      const nk = formatKm(params.newKm);
      return `Prontinho! Atualizei a quilometragem do ${label} para ${nk} km.`;
    }
    case "km_update_no_change": {
      const label = params.vehicleLabel ?? "seu carro";
      const nk = formatKm(params.newKm);
      return `O ${label} já estava com ${nk} km. Não mudei nada.`;
    }
    case "km_update_retry_needed":
      return "Não consegui concluir agora. Pode me dizer a quilometragem de novo?";
  }
}

function formatKm(value: number | undefined | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "?";
  return String(Math.trunc(value));
}
