// Build 5.7F2A — Tipos puros do orquestrador determinístico WhatsApp.
// Sem Supabase, sem Deno, sem fetch, sem I/O. Compatível com Bun e Deno.

export type ConversationStateName =
  | "idle"
  | "awaiting_vehicle"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

export type ConversationEventKind =
  | "greeting"
  | "help"
  | "confirm"
  | "deny"
  | "cancel_task"
  | "reset_conversation"
  | "explicit_opt_out"
  | "vehicle_reply"
  | "media"
  | "unknown"
  | "replay"
  | "expired_state";

export type ConversationDecisionKind =
  | "respond"
  | "transition"
  | "reset_task"
  | "reset_conversation"
  | "select_vehicle"
  | "fallback"
  | "defer_legacy_media"
  | "defer_legacy_opt_out"
  | "no_op";

export type ConversationOutcome =
  | "none"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

export type ConversationMessageType =
  | "text"
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "file"
  | "document"
  | "system"
  | "unknown";

/**
 * Estado corrente da conversa, exposto ao core como dados imutáveis.
 * Espelha campos de whatsapp_conversation_states, mas o core NÃO conhece o banco.
 */
export type ConversationState = {
  state: ConversationStateName;
  currentIntent: string | null;
  awaitingField: string | null;
  requestSource: string | null;
  draftType: string | null;
  draftId: string | null;
  draftVersion: number | null;
  draftPayload: Record<string, unknown> | null;
  activeVehicleId: string | null;
  confirmedAt: string | null;
  executedAt: string | null;
  expiresAt: string | null;
  lastMessageId: string | null;
};

/**
 * Veículo elegível fornecido externamente. O core não consulta veiculos.
 * `isEligible=false` ou `isArchived=true` são filtrados antes de matching.
 */
export type ConversationVehicle = {
  id: string;
  brand: string | null;
  model: string | null;
  plate: string | null;
  isArchived: boolean;
  isEligible: boolean;
  optionalLabel?: string | null;
};

export type ConversationCoreInput = {
  sourceMessageId: string;
  messageType: ConversationMessageType;
  originalText: string | null;
  now: string; // ISO string injetada externamente
  state: ConversationState;
  vehicles: ConversationVehicle[];
  fallbackCount: number;
  isReplay?: boolean;
};

/**
 * Patch parcial proposto para o state. O core NÃO persiste.
 * Chaves omitidas = manter valor atual. Valor `null` = limpar.
 */
export type ConversationStatePatch = Partial<{
  state: ConversationStateName;
  currentIntent: string | null;
  awaitingField: string | null;
  requestSource: string | null;
  draftType: string | null;
  draftId: string | null;
  draftVersion: number | null;
  draftPayload: Record<string, unknown> | null;
  activeVehicleId: string | null;
  confirmedAt: string | null;
  executedAt: string | null;
  expiresAt: string | null;
  lastMessageId: string | null;
}>;

export type ConversationResponseKey =
  | "greeting"
  | "help"
  | "nothing_to_confirm"
  | "nothing_to_cancel"
  | "task_cancelled"
  | "conversation_reset"
  | "vehicle_selected"
  | "vehicle_ambiguous"
  | "vehicle_not_found"
  | "no_eligible_vehicle"
  | "fallback_first"
  | "fallback_second"
  | "fallback_reset";

export type ConversationResponseParams = {
  vehicleLabel?: string;
  options?: string[];
};

export type ConversationCoreDecision = {
  eventKind: ConversationEventKind;
  decisionKind: ConversationDecisionKind;
  previousState: ConversationStateName;
  nextState: ConversationStateName;
  outcome: ConversationOutcome;
  statePatch: ConversationStatePatch;
  responseKey: ConversationResponseKey | null;
  responseParams: ConversationResponseParams;
  nextFallbackCount: number;
  deferToLegacyRouter: boolean;
  deferToLegacyOptOut: boolean;
  reasonCode: string;
};
