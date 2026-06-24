// =============================================================================
// WhatsApp futuro (não implementado neste build — registro de contrato).
//
// Quando o WhatsApp for implementado, TODO handler de WhatsApp deve seguir:
//
//   Mensagem WhatsApp recebida
//     → identificar usuário pelo telefone
//     → identificar veículo
//     → buscar se veículo está ativado via pagamentos_pix
//       (status='pago' + tipo_produto='ativacao' + veiculo_id)
//     → montar VehicleContext com isActivated
//     → chamar can("canUseWhatsappOCR") ou can("canUseWhatsappJarvys")
//     → se bloquear, responder oferecendo ativação R$29,90
//     → se liberar, processar
//
// Nenhum handler de WhatsApp pode rodar OCR, Dr. Jarvys ou automações
// sem VehicleContext.isActivated validado via can(...).
// =============================================================================

import type { ProfileStatus } from "./profile-status";
import type { VehicleStatus } from "./vehicle-status";

export type Capability =
  | "canUseAppJarvysChat"
  | "canUseWhatsappJarvys"
  | "canUseReceiptScanner"
  | "canUseWhatsappOCR"
  | "canUseWhatsapp"
  | "canUseFipeCurrent"
  | "canUseFipeAutoRefresh"
  | "canUseFipeHistoryRefresh"
  | "canAddVehicle"
  | "canHaveUnlimitedVehicles"
  | "canUseHistoricoPremium";

export type BlockReason =
  | "trial_expired"
  | "vehicle_limit_reached"
  | "vehicle_not_activated"
  | "feature_requires_activation"
  | "enterprise_required"
  | "unknown";

export type PlanContext = {
  status_usuario: ProfileStatus;
  trial_inicio: string | null;
  vehicleCount: number;
  activatedVehicleCount: number;
};

export type VehicleContext = {
  /**
   * Status do veículo NA GARAGEM (ativo | archived).
   * NÃO significa que o veículo foi pago/ativado comercialmente.
   */
  status: VehicleStatus | string | null;
  activated_at?: string | null;
  /**
   * Ativação COMERCIAL real do veículo (R$29,90 via pagamentos_pix).
   *
   * Fonte obrigatória:
   * - pagamentos_pix.status = 'pago'
   * - pagamentos_pix.tipo_produto = 'ativacao'
   * - pagamentos_pix.veiculo_id = veiculos.id
   * - veiculos.status = 'ativo'
   *
   * NÃO usar tabela `assinaturas`. NÃO confundir com vehicle.status
   * (garagem) nem com history_locked (histórico premium R$49,90).
   */
  isActivated?: boolean;
  /**
   * Bloqueio do histórico premium pago (R$49,90) PARA O VEÍCULO DO USUÁRIO ATUAL.
   *
   * Regras obrigatórias para quem preencher este campo:
   * - Deve refletir SOMENTE o registro de veiculos pertencente ao usuário
   *   autenticado (mesmo user_id), nunca uma consulta agregada por placa.
   * - NÃO copiar history_locked=false de um veículo `archived` de outro
   *   usuário que tenha cadastrado a mesma placa no passado.
   * - Novo cadastro da mesma placa por outro usuário deve nascer com
   *   history_locked=true (bloqueado), exigindo novo pagamento.
   * - Entitlement premium não é transferível entre usuários, mesmo que a
   *   placa seja a mesma. Apenas o status `vip` ignora esta regra
   *   (ver canUseHistoricoPremium).
   * - Independente de isActivated. R$49,90 é produto separado de R$29,90.
   */
  history_locked?: boolean | null;
};

const TRIAL_DURATION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(iso: string): number {
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.floor((Date.now() - start) / MS_PER_DAY);
}

export function trialActive(plan: PlanContext): boolean {
  if (plan.trial_inicio === null) return true;
  return daysSince(plan.trial_inicio) < TRIAL_DURATION_DAYS;
}

export function trialDaysLeft(plan: PlanContext): number | null {
  if (plan.trial_inicio === null) return TRIAL_DURATION_DAYS;
  const used = daysSince(plan.trial_inicio);
  const left = TRIAL_DURATION_DAYS - used;
  if (left < 0) return 0;
  if (left > TRIAL_DURATION_DAYS) return TRIAL_DURATION_DAYS;
  return left;
}

/**
 * Indica se a capability, ao ser usada pela primeira vez por um usuário em
 * trial com trial_inicio=null, deve iniciar o trial sob demanda.
 *
 * - true: recursos inteligentes que consomem trial (OCR, WhatsApp, FIPE
 *   auto-refresh, refresh inteligente de histórico FIPE).
 * - false: Dr. Jarvys no app, FIPE atual salva, histórico premium pago,
 *   limites de veículo e qualquer leitura/operação não-inteligente.
 *
 * Usado pelo ensureTrialStartedFn como defesa em camadas — mesmo que um
 * consumidor chame errado, capabilities não-triggerizadoras não iniciam trial.
 */
export function capabilityStartsTrial(capability: Capability): boolean {
  switch (capability) {
    case "canUseReceiptScanner":
    case "canUseWhatsapp":
    case "canUseWhatsappJarvys":
    case "canUseWhatsappOCR":
    case "canUseFipeAutoRefresh":
    case "canUseFipeHistoryRefresh":
      return true;
    case "canUseAppJarvysChat":
    case "canUseFipeCurrent":
    case "canUseHistoricoPremium":
    case "canAddVehicle":
    case "canHaveUnlimitedVehicles":
      return false;
    default:
      return false;
  }
}

/**
 * Ativação COMERCIAL do veículo (R$29,90 pago via pagamentos_pix).
 * Distinta de vehicle.status (garagem) e de history_locked (premium R$49,90).
 */
function vehicleIsActivated(vehicle?: VehicleContext): boolean {
  return vehicle?.isActivated === true;
}

/**
 * canUseHistoricoPremium
 * - vip → libera sempre (benefício do plano).
 * - Qualquer outro status (trial/ativo/enterprise/free) → libera somente
 *   se vehicle.history_locked === false, e esse vehicle DEVE pertencer ao
 *   usuário atual (ver VehicleContext.history_locked).
 * - Default seguro: ausência de vehicle, history_locked !== false → bloqueia.
 * - NÃO depende de trialActive, NÃO depende de veículo "ativado",
 *   NÃO se mistura com canUseFipeHistoryRefresh.
 */
function canUseHistoricoPremium(
  plan: PlanContext,
  vehicle?: VehicleContext,
): boolean {
  if (plan.status_usuario === "vip") return true;
  return vehicle?.history_locked === false;
}

export function can(
  capability: Capability,
  plan: PlanContext,
  vehicle?: VehicleContext,
): boolean {
  const status = plan.status_usuario;

  // vip / enterprise: pode tudo exceto canUseHistoricoPremium quando não pago
  if (status === "vip" || status === "enterprise") {
    if (capability === "canUseHistoricoPremium") {
      return canUseHistoricoPremium(plan, vehicle);
    }
    return true;
  }

  if (status === "trial") {
    const active = trialActive(plan);
    switch (capability) {
      case "canUseAppJarvysChat":
        return true;
      case "canUseFipeCurrent":
        return true;
      case "canUseHistoricoPremium":
        return canUseHistoricoPremium(plan, vehicle);
      case "canUseReceiptScanner":
      case "canUseWhatsapp":
      case "canUseWhatsappJarvys":
      case "canUseWhatsappOCR":
      case "canUseFipeAutoRefresh":
      case "canUseFipeHistoryRefresh":
        return active;
      case "canAddVehicle":
        return plan.vehicleCount < 1;
      case "canHaveUnlimitedVehicles":
        return false;
      default:
        return false;
    }
  }

  if (status === "ativo") {
    switch (capability) {
      case "canUseAppJarvysChat":
        return true;
      case "canUseFipeCurrent":
        return true;
      case "canUseHistoricoPremium":
        return canUseHistoricoPremium(plan, vehicle);
      case "canUseReceiptScanner":
      case "canUseWhatsapp":
      case "canUseWhatsappJarvys":
      case "canUseWhatsappOCR":
      case "canUseFipeAutoRefresh":
      case "canUseFipeHistoryRefresh":
        return vehicleIsActivated(vehicle);
      case "canAddVehicle":
        return plan.vehicleCount < plan.activatedVehicleCount + 1;
      case "canHaveUnlimitedVehicles":
        return false;
      default:
        return false;
    }
  }

  return false;
}

export function reasonBlocked(
  capability: Capability,
  plan: PlanContext,
  vehicle?: VehicleContext,
): BlockReason | null {
  if (can(capability, plan, vehicle)) return null;

  const status = plan.status_usuario;

  if (status === "trial") {
    if (!trialActive(plan)) return "trial_expired";
    if (capability === "canAddVehicle") return "vehicle_limit_reached";
    return "unknown";
  }

  if (status === "ativo") {
    if (capability === "canAddVehicle") return "vehicle_limit_reached";
    if (
      capability === "canUseReceiptScanner" ||
      capability === "canUseWhatsapp" ||
      capability === "canUseWhatsappJarvys" ||
      capability === "canUseWhatsappOCR" ||
      capability === "canUseFipeAutoRefresh" ||
      capability === "canUseFipeHistoryRefresh"
    ) {
      return vehicle ? "vehicle_not_activated" : "feature_requires_activation";
    }
    return "unknown";
  }

  if (status === "vip" || status === "enterprise") {
    if (capability === "canUseHistoricoPremium") {
      return "feature_requires_activation";
    }
    if (capability === "canHaveUnlimitedVehicles") {
      return "enterprise_required";
    }
    return "unknown";
  }

  return "unknown";
}
