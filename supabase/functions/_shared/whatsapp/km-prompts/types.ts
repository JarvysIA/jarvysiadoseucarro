// Build 5.7F2E1A.5-MJ1 — Tipos do módulo km-prompts.
// Wrappers TS estritos sobre as RPCs SECURITY DEFINER instaladas no banco.
// Nenhum acoplamento com core/mapper/drafts/action service. Backend-only.

export const KM_PROMPT_REQUEST_STATUSES = [
  "queued",
  "pending",
  "reserved",
  "consumed",
  "expired",
  "cancelled",
] as const;

export type KmPromptRequestStatus =
  (typeof KM_PROMPT_REQUEST_STATUSES)[number];

// ------------------------------------------------------------
// CREATE
// ------------------------------------------------------------

export type CreateKmPromptRequestInput = {
  promptMessageId: string;
  contactId: string;
  userId: string;
  vehicleId: string;
};

export type CreateKmPromptRequestResult =
  | { result: "created"; requestId: string }
  | { result: "replayed"; requestId: string }
  | { result: "already_exists_with_different_context"; requestId: string }
  | { result: "prompt_message_not_found" }
  | { result: "prompt_message_not_outbound" }
  | { result: "prompt_context_mismatch" }
  | { result: "vehicle_archived" };

export const CREATE_KM_PROMPT_RESULTS = [
  "created",
  "replayed",
  "already_exists_with_different_context",
  "prompt_message_not_found",
  "prompt_message_not_outbound",
  "prompt_context_mismatch",
  "vehicle_archived",
] as const;

// ------------------------------------------------------------
// PROMOTE
// ------------------------------------------------------------

export type PromoteKmPromptRequestInput = {
  promptMessageId: string;
};

export type PromoteKmPromptRequestResult =
  | {
      result: "promoted" | "already_pending";
      requestId: string;
      pendingAt: string;
      expiresAt: string;
    }
  | { result: "not_found" }
  | { result: "not_queued"; requestId: string }
  | { result: "prompt_message_not_sent"; requestId: string }
  | { result: "prompt_context_mismatch"; requestId: string };

export const PROMOTE_KM_PROMPT_RESULTS = [
  "promoted",
  "already_pending",
  "not_found",
  "not_queued",
  "prompt_message_not_sent",
  "prompt_context_mismatch",
] as const;

// ------------------------------------------------------------
// RESERVE
// ------------------------------------------------------------

export type ReserveKmPromptRequestInput = {
  promptMessageId: string;
  contactId: string;
  userId: string;
  vehicleId: string;
  draftId: string;
};

export type ReserveKmPromptRequestResult =
  | {
      result: "reserved" | "replayed";
      requestId: string;
      reservedDraftId: string;
      reservedAt: string;
    }
  | { result: "prompt_not_found" }
  | {
      result:
        | "prompt_not_pending"
        | "prompt_expired"
        | "prompt_cancelled"
        | "prompt_consumed"
        | "prompt_reserved_by_other_draft"
        | "prompt_context_mismatch"
        | "prompt_message_not_sent"
        | "draft_message_not_found"
        | "draft_message_not_inbound"
        | "draft_context_mismatch";
      requestId: string;
    };

export const RESERVE_KM_PROMPT_RESULTS = [
  "reserved",
  "replayed",
  "prompt_not_found",
  "prompt_not_pending",
  "prompt_expired",
  "prompt_cancelled",
  "prompt_consumed",
  "prompt_reserved_by_other_draft",
  "prompt_context_mismatch",
  "prompt_message_not_sent",
  "draft_message_not_found",
  "draft_message_not_inbound",
  "draft_context_mismatch",
] as const;

// ------------------------------------------------------------
// CANCEL
// ------------------------------------------------------------

export type CancelKmPromptRequestInput = {
  promptMessageId: string;
};

export type CancelKmPromptRequestResult =
  | { result: "cancelled"; requestId: string; cancelledAt: string }
  | { result: "already_terminal"; requestId: string; cancelledAt: string | null }
  | { result: "not_found" };

export const CANCEL_KM_PROMPT_RESULTS = [
  "cancelled",
  "already_terminal",
  "not_found",
] as const;

// ------------------------------------------------------------
// EXPIRE
// ------------------------------------------------------------

export type ExpireKmPromptRequestsInput = {
  batch?: number;
};

export type ExpireKmPromptRequestsResult = {
  expiredCount: number;
};

// ------------------------------------------------------------
// ENQUEUE (Build 5.7F2E1A.5-MJ1A)
// ------------------------------------------------------------

export const KM_PROMPT_ENQUEUE_RESULTS = [
  "created",
  "replayed",
  "idempotency_context_mismatch",
  "invalid_idempotency_key",
  "invalid_text",
  "contact_not_found",
  "contact_opted_out",
  "contact_not_eligible",
  "contact_not_linked",
  "vehicle_not_found",
  "vehicle_not_owned",
  "vehicle_archived",
  "vehicle_context_invalid",
  "instance_not_found",
  "instance_inactive",
  "instance_context_mismatch",
] as const;

export type KmPromptEnqueueRejectResult =
  | "idempotency_context_mismatch"
  | "invalid_idempotency_key"
  | "invalid_text"
  | "contact_not_found"
  | "contact_opted_out"
  | "contact_not_eligible"
  | "contact_not_linked"
  | "vehicle_not_found"
  | "vehicle_not_owned"
  | "vehicle_archived"
  | "vehicle_context_invalid"
  | "instance_not_found"
  | "instance_inactive"
  | "instance_context_mismatch";

export type EnqueueKmPromptInput = {
  idempotencyKey: string;
  contactId: string;
  vehicleId: string;
  textBody: string;
};

export type EnqueueKmPromptResult =
  | {
      result: "created" | "replayed";
      promptRequestId: string;
      promptMessageId: string;
      outboundQueueId: string;
    }
  | { result: KmPromptEnqueueRejectResult };

// ------------------------------------------------------------
// FINALIZE SENT (Build 5.7F2E1A.5-MJ1A)
// ------------------------------------------------------------

export const KM_PROMPT_FINALIZE_SENT_RESULTS = [
  "finalized",
  "replayed",
  "queue_not_found",
  "queue_state_invalid",
  "invalid_provider_message_id",
  "provider_message_id_mismatch",
  "km_prompt_invariant_violation",
] as const;

export type FinalizeKmPromptSentInput = {
  outboundQueueId: string;
  providerMessageId: string;
};

export type FinalizeKmPromptSentResult =
  | {
      result: "finalized" | "replayed";
      promptRequestId: string;
      promptMessageId: string;
      outboundQueueId: string;
      pendingAt: string | null;
      expiresAt: string | null;
    }
  | {
      result:
        | "queue_not_found"
        | "queue_state_invalid"
        | "invalid_provider_message_id"
        | "provider_message_id_mismatch"
        | "km_prompt_invariant_violation";
    };

// ------------------------------------------------------------
// FINALIZE FAILED (Build 5.7F2E1A.5-MJ1A)
// ------------------------------------------------------------

export const KM_PROMPT_TERMINAL_REASONS = [
  "non_retryable_provider_error",
  "max_attempts_reached",
  "timeout_ambiguous",
  "preflight_invalid",
  "instance_not_found",
] as const;

export type KmPromptTerminalReason = (typeof KM_PROMPT_TERMINAL_REASONS)[number];

export const KM_PROMPT_FINALIZE_FAILED_RESULTS = [
  "finalized",
  "terminal_replayed",
  "queue_not_found",
  "queue_state_invalid",
  "invalid_terminal_reason",
  "max_attempts_not_reached",
  "km_prompt_invariant_violation",
  "terminal_after_success_invariant",
  "terminal_after_prompt_progress_invariant",
] as const;

export type FinalizeKmPromptFailedInput = {
  outboundQueueId: string;
  terminalReason: KmPromptTerminalReason;
  errorMessage?: string | null;
};

export type FinalizeKmPromptFailedResult =
  | {
      result: "finalized";
      promptRequestId: string;
      promptMessageId: string;
      outboundQueueId: string;
      terminalReason: KmPromptTerminalReason;
    }
  | {
      result: "terminal_replayed";
      promptRequestId: string;
      terminalReason: string;
      repaired?: boolean;
    }
  | {
      result: "terminal_after_prompt_progress_invariant";
      promptRequestId: string;
    }
  | {
      result:
        | "queue_not_found"
        | "queue_state_invalid"
        | "invalid_terminal_reason"
        | "max_attempts_not_reached"
        | "km_prompt_invariant_violation"
        | "terminal_after_success_invariant";
    };

// ------------------------------------------------------------
// Erros do módulo (locais — não reutiliza orquestrador)
// ------------------------------------------------------------

export class KmPromptRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "KmPromptRepositoryError";
    this.code = code;
  }
}

export class KmPromptTransportError extends KmPromptRepositoryError {
  constructor(message: string) {
    super("transport_error", message);
    this.name = "KmPromptTransportError";
  }
}

export class KmPromptMalformedResponseError extends KmPromptRepositoryError {
  constructor(message: string) {
    super("malformed_response", message);
    this.name = "KmPromptMalformedResponseError";
  }
}

export class KmPromptUnknownResultError extends KmPromptRepositoryError {
  readonly resultCode: string;
  constructor(resultCode: string) {
    super("unknown_result", `unknown result: ${resultCode}`);
    this.name = "KmPromptUnknownResultError";
    this.resultCode = resultCode;
  }
}

export class KmPromptRpcExceptionError extends KmPromptRepositoryError {
  readonly sqlState: string | null;
  constructor(sqlState: string | null, message: string) {
    super("rpc_exception", message);
    this.name = "KmPromptRpcExceptionError";
    this.sqlState = sqlState;
  }
}
