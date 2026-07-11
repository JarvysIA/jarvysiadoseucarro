// Build 5.7F2B3 — Tipos do Repository do orquestrador WhatsApp.
// Fonte de verdade: pg_get_functiondef atual de
//   public.apply_whatsapp_orchestrator_transition(uuid,uuid,bigint,jsonb,text,jsonb,jsonb)
//   public.claim_whatsapp_orchestrator_items(text,integer,integer)
//   public.release_whatsapp_orchestrator_item(uuid,uuid,text,text,integer)
// Migration correspondente: 20260711215610_1c7f3907-... e 20260711194052_9c80bb6f-...
// A migration 20260711202942_... foi substituída e NÃO é o contrato de runtime.

import type {
  ConversationDecisionKind,
  ConversationEventKind,
  ConversationOutcome,
  ConversationState,
  ConversationStateName,
  ConversationStatePatch,
  ConversationVehicle,
} from "../conversation/types.ts";

// ============================================================
// CLAIM
// ============================================================

export type ClaimInput = {
  workerId: string;         // 1..64 chars
  batch?: number;           // 1..25, default 10
  leaseSeconds?: number;    // 30..600, default 300
};

/**
 * Espelha 1:1 as colunas retornadas pela RPC claim_whatsapp_orchestrator_items,
 * exceto que os campos são convertidos para camelCase.
 */
export type ClaimedItem = {
  queueId: string;
  messageId: string;
  contactId: string;
  userId: string | null;
  instancePk: string;
  provider: string;
  instanceId: string;
  queueType: string;
  messageType: string;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
  leaseExpiresAt: string; // ISO
  wasRecovered: boolean;
  orchestratorMode: "test" | "active";
};

// ============================================================
// CONTEXT — leitura auxiliar; NÃO consultada pela RPC.
// ============================================================

export type LoadContextInput = {
  contactId: string;
  userId: string | null;
};

export type ConversationContext = {
  state: ConversationState;
  fallbackCount: number;
  stateVersion: number;
  vehicles: ConversationVehicle[];
};

// ============================================================
// APPLY TRANSITION
// ============================================================

/**
 * IMPORTANTE — layout ESTRITO conforme a função instalada:
 *  - result_summary: camelCase (decisionKind, eventKind, outcome).
 *    Chaves em snake_case → result_summary_invalid.
 *  - patch: snake_case (next_state, current_intent, awaiting_field, ...).
 *  - response: snake_case (response_key, message_type, text_body, ...).
 *  - orchestratorResult (saída): camelCase.
 */
export type TransitionInput = {
  queueItemId: string;
  leaseToken: string;
  expectedStateVersion: number;
  patch: ConversationStatePatch;
  orchestratorVersion: string; // ^[a-z0-9._:-]+$, 1..32
  resultSummary: {
    decisionKind: ConversationDecisionKind;
    eventKind: ConversationEventKind;
    outcome: ConversationOutcome;
  };
  response?: OutboundResponsePayload | null;
};

export type OutboundResponsePayload = {
  responseKey: string;             // ^[a-z0-9._:-]+$, 1..64
  messageType?: "text";            // default text; único suportado hoje
  purpose?: "general";             // default general; único suportado hoje
  textBody: string;                // 1..4000
  priority?: number;               // -1000..1000, default 0
  scheduledAt?: string;            // ISO
  expiresAt?: string;              // ISO, > scheduledAt
};

export type OrchestratorResultOk = {
  decisionKind: ConversationDecisionKind;
  eventKind: ConversationEventKind;
  outcome: ConversationOutcome;
  responseKey: string | null;
  nextState: ConversationStateName;
  stateVersion: number;
  outboundQueueId: string | null;
};

export type TransitionOptions = {
  timeoutMs?: number;   // default 8000
  signal?: AbortSignal; // externa; encadeada ao timeout
};

/**
 * Reasons emitidos pela função instalada.
 * A migration histórica 20260711202942 emitia variantes extras
 * (state_invariant_violation, orchestrator_invariant_violation,
 * contact_phone_missing) — foi substituída e NÃO é o contrato atual.
 */
export type ApplyReasonCode =
  | "queue_item_not_found"
  | "source_message_missing"
  | "contact_missing"
  | "contact_not_verified"
  | "contact_unlinked"
  | "instance_not_found"
  | "orchestrator_not_active"
  | "invariant_violation"
  | "queue_already_terminal"
  | "lease_lost"
  | "message_mismatch"
  | "message_direction_invalid"
  | "message_type_unsupported"
  | "state_version_conflict"
  | "patch_invalid_key"
  | "patch_invalid_value"
  | "draft_transition_invalid"
  | "vehicle_invalid"
  | "result_summary_invalid"
  | "response_invalid"
  | "idempotency_payload_mismatch";

export type TransitionResult =
  | {
      ok: true;
      wasReplay: boolean;
      orchestratorResult: OrchestratorResultOk;
    }
  | {
      ok: false;
      reason: ApplyReasonCode;
      currentStateVersion?: number; // presente em state_version_conflict
    };

// ============================================================
// RELEASE
// ============================================================

export type ReleaseInput = {
  queueItemId: string;
  leaseToken: string;
  reason: string;               // ^[a-z0-9_.:-]+$, 1..120
  retryKind: "transient_error" | "state_conflict" | "cancelled";
  delaySeconds?: number;        // 1..3600, default 5
};

export type ReleaseReasonCode =
  | "queue_item_not_found"
  | "invariant_violation"
  | "already_terminal"
  | "lease_lost";

export type ReleaseResult =
  | {
      ok: true;
      wasReplay: true;
      orchestratorResult: OrchestratorResultOk;
    }
  | {
      ok: true;
      wasReplay?: false;
      status: "queued" | "failed" | "cancelled";
      attempts: number;
      willRetry: boolean;
    }
  | {
      ok: false;
      reason: ReleaseReasonCode;
    };
