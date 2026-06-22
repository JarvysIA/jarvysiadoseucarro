import type { ProfileStatus } from "./profile-status";
import { isActiveVehicleStatus, type VehicleStatus } from "./vehicle-status";

export type Capability =
  | "canUseAI"
  | "canUseScanner"
  | "canUseWhatsApp"
  | "canAddVehicle"
  | "canHaveUnlimitedVehicles"
  | "canUseFipeAuto"
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
  status: VehicleStatus | string | null;
  activated_at?: string | null;
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

function vehicleIsActive(vehicle?: VehicleContext): boolean {
  if (!vehicle) return false;
  return isActiveVehicleStatus(vehicle.status);
}

export function can(
  capability: Capability,
  plan: PlanContext,
  vehicle?: VehicleContext,
): boolean {
  const status = plan.status_usuario;

  // vip / enterprise: pode tudo nesta fase
  if (status === "vip" || status === "enterprise") {
    return true;
  }

  if (status === "trial") {
    const active = trialActive(plan);
    switch (capability) {
      case "canUseAI":
      case "canUseScanner":
      case "canUseWhatsApp":
      case "canUseFipeAuto":
      case "canUseHistoricoPremium":
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
      case "canUseAI":
      case "canUseScanner":
      case "canUseWhatsApp":
      case "canUseFipeAuto":
      case "canUseHistoricoPremium":
        return vehicleIsActive(vehicle);
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
      capability === "canUseAI" ||
      capability === "canUseScanner" ||
      capability === "canUseWhatsApp" ||
      capability === "canUseFipeAuto" ||
      capability === "canUseHistoricoPremium"
    ) {
      return vehicle ? "vehicle_not_activated" : "feature_requires_activation";
    }
    return "unknown";
  }

  return "unknown";
}
