// Build 5.7F2A — Tipos puros do orquestrador determinístico WhatsApp.
// Sem Supabase, sem Deno, sem fetch, sem I/O. Compatível com Bun e Deno.

import type { WhatsappVehicleAccessMode } from "../plan/vehicle-access-mode.ts";

export type { WhatsappVehicleAccessMode };

export type ConversationStateName =
  | "idle"
  | "awaiting_vehicle"
  | "awaiting_km_confirmation"
  | "awaiting_km_correction"
  | "awaiting_requested_km"
  | "awaiting_expense_category"
  | "awaiting_expense_confirmation"
  | "awaiting_expense_correction"
  | "awaiting_maintenance_confirmation"
  | "awaiting_item_specification"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

/**
 * Campos de coleta conhecidos pelo contrato conversacional. `awaitingField`
 * permanece aberto no estado persistido para compatibilidade com drafts
 * legados, enquanto este union oferece o contrato fechado para fluxos novos.
 */
export type ConversationAwaitingField =
  | "vehicle"
  | "categoria"
  | "category"
  | "confirmation"
  | "requested_km"
  | "maintenance_items"
  | "maintenance_value"
  | "maintenance_filter"
  | "item_specification";

export type ConversationEventKind =
  | "greeting"
  | "help"
  | "confirm"
  | "deny"
  | "cancel_task"
  | "reset_conversation"
  | "explicit_opt_out"
  | "vehicle_reply"
  | "category_reply"
  | "km_reported"
  | "expense_reported"
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
  | "confirm_km_update"
  | "confirm_expense_create"
  | "no_op";

export type ConversationOutcome = "none" | "completed" | "cancelled" | "expired" | "failed";

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
export type RequestSource = "user_initiated" | "proactive_maintenance" | "reengagement" | "system";

/**
 * Estado corrente da conversa, exposto ao core como dados imutáveis.
 * Espelha campos de whatsapp_conversation_states, mas o core NÃO conhece o banco.
 */
export type ConversationState = {
  state: ConversationStateName;
  currentIntent: string | null;
  awaitingField: string | null;
  requestSource: RequestSource | null;
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
  /**
   * Build 5.7F2E1A.5-MA — transporte read-only de veiculos.km_atual.
   * - null representa km_atual IS NULL no banco;
   * - 0 é KM zero válido (não convertido para null);
   * - inteiro seguro no range PostgreSQL integer (0..2147483647);
   * - o core NÃO consome este campo neste build.
   */
  kmAtual: number | null;
  /**
   * Build 5.7F2E1A.5-MJ0 — modo de acesso ao WhatsApp para ESTE veículo.
   * Fonte da verdade: computeWhatsappVehicleAccessMode. O core NÃO recomputa
   * este campo e aplica seu valor de forma fail-closed por veículo.
   */
  whatsappAccessMode: WhatsappVehicleAccessMode;
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
  requestSource: RequestSource | null;
  draftType: string | null;
  draftId: string | null;
  draftVersion: number | null;
  draftPayload: Record<string, unknown> | null;
  activeVehicleId: string | null;
  confirmedAt: string | null;
  executedAt: string | null;
  expiresAt: string | null;
  lastMessageId: string | null;
  fallbackCount: number; // espelha decision.nextFallbackCount; 0..3 (já opcional via Partial<> acima)
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
  | "vehicle_access_restricted"
  | "fallback_first"
  | "fallback_second"
  | "fallback_reset"
  | "km_update_confirmation"
  | "km_update_correction_confirmation"
  | "km_update_applied"
  | "km_update_no_change"
  | "km_update_retry_needed"
  | "expense_category_prompt"
  | "expense_item_specification_prompt"
  | "expense_create_confirmation"
  | "expense_create_correction_confirmation"
  | "expense_create_completed"
  | "expense_create_completed_with_km_prompt"
  | "expense_create_retry_needed"
  | "requested_km_unknown"
  | "media_unclear_during_confirmation";

export type ConversationResponseParams = {
  vehicleLabel?: string;
  options?: string[];
  newKm?: number;
  previousKm?: number | null;
  valor?: number;
  categoria?: string;
  recognizedTags?: ReadonlyArray<string>;
  needsDescriptionInvite?: boolean;
  needsFilterClarification?: boolean;
  itemSpecificationTrigger?:
    | "revision_item_unspecified"
    | "ac_service_unspecified"
    | "maintenance_unspecified";
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
