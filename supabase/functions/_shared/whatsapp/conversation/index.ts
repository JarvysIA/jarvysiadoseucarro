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
export {
  KM_UPDATE_INITIAL_DRAFT_VERSION,
  KM_UPDATE_PROMOTED_DRAFT_VERSION,
  validateAwaitingConfirmationKmUpdateDraft,
  validateAwaitingVehicleKmUpdateDraft,
  validateKmUpdateDraft,
} from "./km-update-draft.ts";
export type {
  AwaitingConfirmationKmUpdateDraft,
  AwaitingVehicleKmUpdateDraft,
  KmUpdateDraft,
  KmUpdateDraftValidationErrorCode,
  KmUpdateDraftValidationResult,
} from "./km-update-draft.ts";
export { parseKmUpdateText } from "./km-update-parser.ts";
export type {
  KmUpdateParseErrorCode,
  KmUpdateParseMode,
  KmUpdateParseResult,
} from "./km-update-parser.ts";
export {
  CONFIRM_KM_UPDATE_HANDOFF_KIND,
  KM_REPORTED_EVENT_KIND,
} from "./km-update-protocol.ts";
export type {
  ConfirmKmUpdateHandoff,
  ConfirmKmUpdateHandoffKind,
  KmReportedEvent,
  KmReportedEventKind,
} from "./km-update-protocol.ts";
