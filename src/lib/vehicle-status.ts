export const VEHICLE_STATUS_VALUES = [
  "free",
  "trial",
  "ativo",
  "vip",
  "enterprise",
  "archived",
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUS_VALUES)[number];

export function isActiveVehicleStatus(status: string | null | undefined): boolean {
  return status === "ativo";
}

export function isArchivedVehicleStatus(status: string | null | undefined): boolean {
  return status === "archived";
}
