import type { ConversationVehicle, WhatsappVehicleAccessMode } from "./types.ts";

export type VehicleAccessOperation = "full_action" | "cancel" | "reset";

export function isWhatsappVehicleAccessMode(value: unknown): value is WhatsappVehicleAccessMode {
  return value === "full" || value === "passive_with_km" || value === "denied";
}

export function isVehicleAccessAllowed(mode: unknown, operation: VehicleAccessOperation): boolean {
  if (operation === "cancel" || operation === "reset") return true;
  return isWhatsappVehicleAccessMode(mode) && mode === "full";
}

export function canVehiclePerformFullAction(
  vehicle: ConversationVehicle | null | undefined,
): vehicle is ConversationVehicle {
  return Boolean(
    vehicle &&
    vehicle.isEligible &&
    !vehicle.isArchived &&
    isVehicleAccessAllowed(vehicle.whatsappAccessMode, "full_action"),
  );
}

export function fullAccessVehicles(vehicles: ConversationVehicle[]): ConversationVehicle[] {
  return vehicles.filter(canVehiclePerformFullAction);
}
