// Build 1 (MJ2) — Renderer puro de texto do marco de revisão preventiva
// para WhatsApp. Junta o motor determinístico Jarvys (schedule-rules.ts) com
// os links afiliados Mercado Livre (mercado-livre-shopping.ts), ambos portas
// de src/lib/.
//
// Função pura: sem I/O, sem Supabase, sem Date.now, sem logs.

import { buildJarvysMilestone, HIGH_MILEAGE_NOTE } from "./schedule-rules.ts";
import { buildMaintenanceMercadoLivreShoppingLink } from "./mercado-livre-shopping.ts";

export type MilestoneRenderVehicleProfile = {
  fuelKind: "combustao" | "hibrido_combustao" | "eletrico_puro";
  timingSystem:
    | "correia_dentada"
    | "corrente"
    | "correia_banhada"
    | "nao_aplicavel"
    | "desconhecido";
  transmissionKind:
    | "manual"
    | "automatico"
    | "cvt"
    | "automatizado"
    | "dupla_embreagem"
    | "e_cvt"
    | "caixa_reducao"
    | "desconhecido";
  steeringKind: "hidraulica" | "eletrica" | "desconhecida";
};

export type MilestoneRenderVehicleShoppingContext = {
  brand?: string;
  model?: string;
  version?: string;
  engine?: string;
  year?: string | number;
};

export type MilestoneRenderInput = {
  vehicleLabel: string;
  milestoneKm: number;
  jarvysProfile: MilestoneRenderVehicleProfile;
  shoppingVehicle: MilestoneRenderVehicleShoppingContext;
};

// shopping_classification que NUNCA vira link de compra — "service_only" é
// serviço (não peça), "do_not_link" e "not_applicable" são exclusões
// explícitas do próprio schema (ver plan-types.ts / schedule-rules.ts).
const NO_LINK_SHOPPING_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  "service_only",
  "do_not_link",
  "not_applicable",
]);

function formatKmPtBr(km: number): string {
  return km.toLocaleString("pt-BR");
}

function fallbackMessage(milestoneKm: number): string {
  return `Sua revisão de ${formatKmPtBr(milestoneKm)} km está chegando! Confira com seu mecânico de confiança os itens recomendados para o seu veículo.`;
}

export function renderRevisionMilestoneMessage(input: MilestoneRenderInput): string {
  const milestone = buildJarvysMilestone(input.milestoneKm, input.jarvysProfile);

  if (milestone.items.length === 0) {
    return fallbackMessage(input.milestoneKm);
  }

  const lines: string[] = [
    `🔧 ${input.vehicleLabel} está chegando na revisão de ${formatKmPtBr(milestone.revisionKmReal)} km!`,
    "",
  ];

  for (const item of milestone.items) {
    if (NO_LINK_SHOPPING_CLASSIFICATIONS.has(item.shopping_classification)) {
      lines.push(item.label);
      continue;
    }
    const shoppingLink = buildMaintenanceMercadoLivreShoppingLink({
      itemTitle: item.label,
      vehicle: input.shoppingVehicle,
    });
    lines.push(`${item.label}: ${shoppingLink.mercadoLivre.url}`);
  }

  if (milestone.isHighMileage) {
    lines.push("");
    lines.push(HIGH_MILEAGE_NOTE);
  }

  return lines.join("\n");
}
