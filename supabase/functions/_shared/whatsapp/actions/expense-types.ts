// Build expense-service-pure — Tipos puros da ação confirmada de despesa
// via WhatsApp. Escopo estrito: apenas expense_create. Sem Supabase, sem
// Deno, sem fetch, sem crypto.
//
// AUTORIDADE: o serviço é sintático. Ele NÃO valida ownership, vínculo do
// contato, confirmação persistida, archived, CAS ou idempotência. A porta
// (futuramente uma RPC atômica) é a única autoridade sobre esses invariantes.

// ---------------------------------------------------------------------------
// Limites locais (independentes de banco)
// ---------------------------------------------------------------------------

/** Limite superior do valor de despesa em reais. */
export const EXPENSE_MAX_VALOR = 999999999.99;

/** Constante de action kind — não configurável pelo caller. */
export const EXPENSE_CREATE_ACTION_TYPE = "expense_create" as const;
export type ExpenseCreateActionType = typeof EXPENSE_CREATE_ACTION_TYPE;

/**
 * Categorias aceitas. Batem exatamente com o CHECK constraint da coluna
 * despesas.categoria (case-sensitive, com acento). Não adicionar "Outros"
 * nem variar acentuação sem antes atualizar o banco.
 */
export const EXPENSE_CATEGORIES = [
  "Revisão",
  "Manutenção",
  "Lavagem",
  "Combustível",
  "IPVA",
  "Multas",
  "Seguro",
  "Acessórios",
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

// ---------------------------------------------------------------------------
// Input público
// ---------------------------------------------------------------------------

export type ConfirmedExpenseCreateInput = {
  draftId: string;
  conversationStateId: string;
  confirmationMessageId: string;
  sourceMessageId: string;
  queueItemId: string;
  userId: string;
  contactId: string;
  vehicleId: string;
  categoria: ExpenseCategory;
  valor: number;
  descricao?: string | null;
  expectedStateVersion: number;
  orchestratorVersion: string;
};

// ---------------------------------------------------------------------------
// Comando normalizado enviado à porta
// ---------------------------------------------------------------------------

export type ExpenseCreateExecutionCommand = {
  actionType: ExpenseCreateActionType;
  draftId: string;
  conversationStateId: string;
  confirmationMessageId: string;
  sourceMessageId: string;
  queueItemId: string;
  userId: string;
  contactId: string;
  vehicleId: string;
  categoria: ExpenseCategory;
  valor: number;
  descricao: string | null;
  expectedStateVersion: number;
  orchestratorVersion: string;
};

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

export type ExpenseCreateRejectedReason =
  | "contact_missing"
  | "contact_unlinked"
  | "vehicle_not_found"
  | "vehicle_not_owned"
  | "vehicle_archived"
  | "invariant_violation";

export type ExpenseCreateConflictReason =
  | "state_version_conflict"
  | "idempotency_payload_mismatch"
  | "action_execution_conflict";

export type ExpenseCreateTransientReason =
  | "executor_unavailable"
  | "database_unavailable";

export type ExpenseMalformedReason =
  | "input_invalid"
  | "valor_invalid"
  | "categoria_invalid"
  | "descricao_invalid"
  | "state_version_invalid";

// ---------------------------------------------------------------------------
// Resultado da porta (executor)
// ---------------------------------------------------------------------------

export type ExpenseCreateExecutorResult =
  | {
      kind: "applied";
      actionExecutionId: string;
      valor: number;
      categoria: ExpenseCategory;
    }
  | {
      kind: "replayed";
      actionExecutionId: string;
      valor: number;
      categoria: ExpenseCategory;
    }
  | {
      kind: "rejected";
      reason: ExpenseCreateRejectedReason;
    }
  | {
      kind: "conflicted";
      reason: ExpenseCreateConflictReason;
      currentStateVersion?: number;
    }
  | {
      kind: "transient_error";
      reason: ExpenseCreateTransientReason;
    };

export interface ExpenseCreateExecutorPort {
  executeExpenseCreate(
    command: ExpenseCreateExecutionCommand,
  ): Promise<ExpenseCreateExecutorResult>;
}

// ---------------------------------------------------------------------------
// Resultado público do serviço
// ---------------------------------------------------------------------------

export type ConfirmedExpenseCreateResult =
  | {
      kind: "completed";
      actionExecutionId: string;
      valor: number;
      categoria: ExpenseCategory;
    }
  | {
      kind: "replayed";
      actionExecutionId: string;
      valor: number;
      categoria: ExpenseCategory;
    }
  | {
      kind: "rejected";
      reason: ExpenseCreateRejectedReason;
    }
  | {
      kind: "conflicted";
      reason: ExpenseCreateConflictReason;
      currentStateVersion?: number;
    }
  | {
      kind: "transient_failure";
      reason: ExpenseCreateTransientReason;
    }
  | {
      kind: "outcome_unknown";
      errorCategory: string;
    }
  | {
      kind: "malformed";
      reason: ExpenseMalformedReason;
    };

// ---------------------------------------------------------------------------
// Logging sanitizado
// ---------------------------------------------------------------------------

export type ConfirmedExpenseCreateLogEvent =
  | "expense_create_started"
  | "expense_create_validation_failed"
  | "expense_create_dispatched"
  | "expense_create_completed"
  | "expense_create_replayed"
  | "expense_create_rejected"
  | "expense_create_conflicted"
  | "expense_create_transient_failure"
  | "expense_create_outcome_unknown";

/**
 * Campos permitidos no log. Nada de draftId, ids, valor, descricao,
 * categoria crua.
 */
export type ConfirmedExpenseCreateLogFields = {
  event: ConfirmedExpenseCreateLogEvent;
  actionType: ExpenseCreateActionType;
  outcome?: string;
  reasonCode?: string;
  durationMs?: number;
};

export interface ConfirmedExpenseCreateLogger {
  log(fields: ConfirmedExpenseCreateLogFields): void;
}

// ---------------------------------------------------------------------------
// Dependências
// ---------------------------------------------------------------------------

export type ConfirmedExpenseCreateDeps = {
  executor: ExpenseCreateExecutorPort;
  logger?: ConfirmedExpenseCreateLogger;
  clock?: () => number;
};
