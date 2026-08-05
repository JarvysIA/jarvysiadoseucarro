// Build 5.7F2A — Renderização de respostas do orquestrador.
// Puro. Nenhuma referência a API/banco/fila/provider/Z-API/erro interno/promessas
// de recursos ainda não ativos. No máximo um emoji por mensagem.

import type { ConversationResponseKey, ConversationResponseParams } from "./types.ts";

const MAINTENANCE_TAG_LABELS: Record<string, string> = {
  oleo: "óleo",
  filtro: "filtro",
  pastilha: "pastilha",
  arrefecimento: "arrefecimento",
};

function joinRecognizedTags(tags: ReadonlyArray<string> | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  const labels = tags.map((t) => MAINTENANCE_TAG_LABELS[t] ?? t);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

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
      const opts =
        params.options && params.options.length > 0 ? params.options.join(" ou ") : "qual carro";
      return `Você quer o ${opts}?`;
    }
    case "vehicle_not_found":
      return "Não achei esse carro na sua lista. Pode me dizer o modelo ou a placa?";
    case "no_eligible_vehicle":
      return "Você ainda não tem carro cadastrado no app.";
    case "vehicle_access_restricted":
      return "Essa ação não está disponível por aqui agora.";
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
    case "expense_category_prompt": {
      const v = formatValor(params.valor);
      return `Registrei o valor de ${v}. Pro lançamento ficar mais claro, essa despesa foi o quê?`;
    }
    case "expense_item_specification_prompt": {
      const v = formatValor(params.valor);
      if (params.itemSpecificationTrigger === "revision_item_unspecified") {
        return `Registrei ${v} em revisão. Qual item você trocou? (óleo, filtro, pastilha, correia...)`;
      }
      if (params.itemSpecificationTrigger === "maintenance_unspecified") {
        return `Pra um melhor lançamento nas despesas, o que foi feito nessa manutenção de ${v}?`;
      }
      return `Registrei ${v}. Foi o filtro do ar-condicionado, ou foi conserto/carga de gás?`;
    }
    case "expense_create_confirmation": {
      const label = params.vehicleLabel ?? "seu carro";
      const v = formatValor(params.valor);
      const cat = params.categoria ?? "essa categoria";
      const itemsLabel = joinRecognizedTags(params.recognizedTags);
      const itemsSuffix = itemsLabel ? ` (${itemsLabel})` : "";
      const base = `Anotar ${v} em ${cat}${itemsSuffix} no ${label}? Responda sim para confirmar ou não para cancelar.`;
      if (params.needsFilterClarification) {
        return `${base} Qual filtro foi trocado (ar, cabine ou combustível)?`;
      }
      if (params.needsDescriptionInvite) {
        return `${base} Se quiser contar mais sobre o que foi feito, pode falar 🙂`;
      }
      return base;
    }

    case "expense_create_correction_confirmation": {
      const label = params.vehicleLabel ?? "seu carro";
      const v = formatValor(params.valor);
      const cat = params.categoria ?? "essa categoria";
      return `Certo, corrigido. Anotar ${v} em ${cat} no ${label}? Responda sim para confirmar.`;
    }
    case "expense_create_completed": {
      const label = params.vehicleLabel ?? "seu carro";
      const v = formatValor(params.valor);
      const cat = params.categoria ?? "essa categoria";
      return `Prontinho! Anotei ${v} em ${cat} no ${label}.`;
    }
    case "expense_create_completed_with_km_prompt": {
      const label = params.vehicleLabel ?? "seu carro";
      const v = formatValor(params.valor);
      const cat = params.categoria ?? "essa categoria";
      return `Prontinho! Anotei ${v} em ${cat} no ${label}. Aproveitando, qual a km atual do carro?`;
    }
    case "expense_create_retry_needed":
      return "Não consegui concluir agora. Pode me contar a despesa de novo?";
    case "requested_km_unknown":
      return "Sem problema! Quando souber a km, é só me contar 😉";
    case "media_unclear_during_confirmation":
      return "Recebi algo que ainda não consigo entender. Pode descrever em texto, ou só confirmar com 'sim' ou 'não'?";
  }
}

function formatKm(value: number | undefined | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "?";
  return String(Math.trunc(value));
}

function formatValor(value: number | undefined | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "?";
  const fixed = value.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${withThousands},${decPart}`;
}
