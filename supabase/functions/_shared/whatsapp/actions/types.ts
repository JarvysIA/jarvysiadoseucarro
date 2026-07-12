// Build 5.7F2E1A — Tipos puros da camada de ações confirmadas WhatsApp.
// Escopo estrito: apenas km_update. Sem Supabase, sem Deno, sem fetch, sem crypto.
//
// AUTORIDADE: o serviço é sintático. Ele NÃO valida ownership, vínculo do
// contato, confirmação persistida, archived, CAS ou idempotência. A porta
// (futuramente uma RPC atômica) é a única autoridade sobre esses invariantes.

// ---------------------------------------------------------------------------
// Limites locais (independentes de banco)
// ---------------------------------------------------------------------------

/** Limite superior do tipo `integer` do PostgreSQL. */
export const KM_MAX_VALUE = 2147483647;

/** Constante de action kind — não configurável pelo caller. */
export const KM_UPDATE_ACTION_TYPE = "km_update" as const;
export type KmUpdateActionType = typeof KM_UPDATE_ACTION_TYPE;

// ---------------------------------------------------------------------------
// Input público
// ---------------------------------------------------------------------------

/**
 * Entrada pública do serviço.
 * Todos os identificadores são tratados como opacos — a autoridade sobre
 * cada um pertence à futura porta/RPC.
 */
export type ConfirmedKmUpdateInput = {
  draftId: string;
  conversationStateId: string;
  confirmationMessageId: string;
  sourceMessageId: string;
  queueItemId: string;
  userId: string;
  contactId: string;
  vehicleId: string;
  expectedPreviousKm: number | null;
  newKm: number;
  correctionConfirmed: boolean;
  correctionReason?: string | null;
  expectedStateVersion: number;
  orchestratorVersion: string;
};

// ---------------------------------------------------------------------------
// Comando normalizado enviado à porta
// ---------------------------------------------------------------------------

/**
 * Comando determinístico que o serviço monta e entrega à porta.
 * Não contém hash, actionExecutionId, timestamps de domínio ou texto bruto.
 */
export type KmUpdateExecutionCommand = {
  actionType: KmUpdateActionType;
  draftId: string;
  conversationStateId: string;
  confirmationMessageId: string;
  sourceMessageId: string;
  queueItemId: string;
  userId: string;
  contactId: string;
  vehicleId: string;
  expectedPreviousKm: number | null;
  newKm: number;
  isCorrection: boolean;
  correctionConfirmed: boolean;
  correctionReason: string | null;
  expectedStateVersion: number;
  orchestratorVersion: string;
};

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

export type KmUpdateRejectedReason =
  | "action_not_confirmed"
  | "action_kind_invalid"
  | "contact_missing"
  | "contact_unlinked"
  | "vehicle_not_found"
  | "vehicle_not_owned"
  | "vehicle_archived"
  | "km_invalid"
  | "correction_not_confirmed"
  | "invariant_violation";

export type KmUpdateConflictReason =
  | "km_conflict"
  | "state_version_conflict"
  | "idempotency_payload_mismatch"
  | "action_execution_conflict";

export type KmUpdateTransientReason =
  | "executor_unavailable"
  | "database_unavailable";

export type MalformedReason =
  | "input_invalid"
  | "km_invalid"
  | "state_version_invalid"
  | "correction_reason_invalid";

// ---------------------------------------------------------------------------
// Resultado da porta (executor)
// ---------------------------------------------------------------------------

export type KmUpdateExecutorResult =
  | {
      kind: "applied";
      actionExecutionId: string;
      previousKm: number | null;
      newKm: number;
    }
  | {
      kind: "replayed";
      actionExecutionId: string;
      previousKm: number | null;
      newKm: number;
      noChange: boolean;
    }
  | {
      kind: "no_op";
      actionExecutionId: string;
      currentKm: number | null;
    }
  | {
      kind: "rejected";
      reason: KmUpdateRejectedReason;
    }
  | {
      kind: "conflicted";
      reason: KmUpdateConflictReason;
      currentKm?: number | null;
      currentStateVersion?: number;
    }
  | {
      kind: "transient_error";
      reason: KmUpdateTransientReason;
    };

export interface KmUpdateExecutorPort {
  executeKmUpdate(
    command: KmUpdateExecutionCommand,
  ): Promise<KmUpdateExecutorResult>;
}

// ---------------------------------------------------------------------------
// Resultado público do serviço
// ---------------------------------------------------------------------------

export type ConfirmedKmUpdateResult =
  | {
      kind: "completed";
      actionExecutionId: string;
      previousKm: number | null;
      newKm: number;
    }
  | {
      kind: "replayed";
      actionExecutionId: string;
      previousKm: number | null;
      newKm: number;
      noChange: boolean;
    }
  | {
      kind: "no_op";
      actionExecutionId: string;
      currentKm: number | null;
    }
  | {
      kind: "rejected";
      reason: KmUpdateRejectedReason;
    }
  | {
      kind: "conflicted";
      reason: KmUpdateConflictReason;
      currentKm?: number | null;
      currentStateVersion?: number;
    }
  | {
      kind: "transient_failure";
      reason: KmUpdateTransientReason;
    }
  | {
      kind: "outcome_unknown";
      errorCategory: string;
    }
  | {
      kind: "malformed";
      reason: MalformedReason;
    };

// ---------------------------------------------------------------------------
// Logging sanitizado
// ---------------------------------------------------------------------------

export type ConfirmedKmUpdateLogEvent =
  | "km_update_started"
  | "km_update_validation_failed"
  | "km_update_dispatched"
  | "km_update_completed"
  | "km_update_replayed"
  | "km_update_no_op"
  | "km_update_rejected"
  | "km_update_conflicted"
  | "km_update_transient_failure"
  | "km_update_outcome_unknown";

/**
 * Campos permitidos no log. Nada de user/contact/vehicle/km/plate/phone/text.
 */
export type ConfirmedKmUpdateLogFields = {
  event: ConfirmedKmUpdateLogEvent;
  actionType: KmUpdateActionType;
  outcome?: string;
  reasonCode?: string;
  isCorrection?: boolean;
  durationMs?: number;
  draftId?: string;
  queueItemId?: string;
  actionExecutionId?: string;
};

export interface ConfirmedKmUpdateLogger {
  log(fields: ConfirmedKmUpdateLogFields): void;
}

// ---------------------------------------------------------------------------
// Dependências
// ---------------------------------------------------------------------------

export type ConfirmedKmUpdateDeps = {
  executor: KmUpdateExecutorPort;
  logger?: ConfirmedKmUpdateLogger;
  clock?: () => number;
};
