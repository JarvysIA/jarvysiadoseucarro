// Build 5.7F2A — Barrel público do core determinístico WhatsApp.
export * from "./types.ts";
export { normalizeCommandText } from "./normalize.ts";
export type { NormalizedText } from "./normalize.ts";
export { classifyCommand, looksLikeCorrectionHint } from "./commands.ts";
export type { CommandKind } from "./commands.ts";
export {
  resolveVehicle,
  vehicleLabel,
  normalizePlate,
} from "./vehicles.ts";
export type { VehicleResolveInput, VehicleResolveResult } from "./vehicles.ts";
export { renderResponse } from "./responses.ts";
export { decideConversation } from "./core.ts";
