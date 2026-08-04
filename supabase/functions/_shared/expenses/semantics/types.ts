export const EXPENSE_SEMANTIC_CATEGORIES = [
  "Revisão",
  "Manutenção",
  "Lavagem",
  "Combustível",
  "IPVA",
  "Multas",
  "Seguro",
  "Acessórios",
] as const;

export type ExpenseSemanticCategory = (typeof EXPENSE_SEMANTIC_CATEGORIES)[number];

export const EXPENSE_SEMANTIC_ITEM_KEYS = ["oleo_motor", "filtro_oleo"] as const;
export type ExpenseSemanticItemKey = (typeof EXPENSE_SEMANTIC_ITEM_KEYS)[number];

export type ExplicitExpenseIntent =
  | "record_completed_expense"
  | "ask_question"
  | "discuss_future_service"
  | "request_quote";

export type ExpenseSemanticInput = Readonly<{
  originalText: string;
  candidateCategory?: unknown;
  candidateItemKeys?: readonly unknown[];
  explicitIntent?: ExplicitExpenseIntent;
  knownFacts?: Readonly<Record<string, unknown>>;
}>;

export type ExpenseSemanticFacts = Readonly<{
  serviceCompleted: true;
  recognizedSystems: readonly ("engine_oil" | "transmission_fluid" | "automotive_service")[];
}>;

export type ResolvedExpenseSemantics = Readonly<{
  status: "resolved";
  persistable: true;
  conceptualCategory: ExpenseSemanticCategory;
  itemKeys: readonly ExpenseSemanticItemKey[];
  facts: ExpenseSemanticFacts;
  decisionCode:
    | "completed_deterministic_revision_item"
    | "completed_transmission_fluid_without_safe_item_key"
    | "completed_automotive_service";
}>;

export type NeedsSemanticClarification = Readonly<{
  status: "needs_clarification";
  persistable: false;
  reason:
    | "oil_system_ambiguous"
    | "expense_or_question_intent_ambiguous"
    | "category_ambiguous_non_engine";
  decisionCode: "clarification_required";
  /**
   * Só preenchido quando reason === "category_ambiguous_non_engine".
   *
   * PENDÊNCIA BLOQUEANTE (P0-3B-R): expense-semantics-to-guided-contract.ts (o
   * adapter em supabase/functions/_shared/whatsapp/conversation/) ainda NÃO sabe
   * interpretar o reason "category_ambiguous_non_engine" — o branch else do seu
   * case "needs_clarification" assume incondicionalmente "oil_system_ambiguous" e
   * mapearia isso incorretamente (ex.: perguntaria sobre sistema de óleo para uma
   * mensagem sobre "farol"). Este reason NÃO deve ser considerado seguro para uso
   * em produção até o adapter ser atualizado para tratá-lo explicitamente. Isso é
   * escopo obrigatório do início do Build 4 (P0-3B-R), antes de qualquer conexão
   * com core.ts.
   */
  candidateCategories?: readonly ExpenseSemanticCategory[];
}>;

export type ConversationOnlyExpenseSemantics = Readonly<{
  status: "conversation_only";
  persistable: false;
  reason: "future_service" | "quote" | "technical_question" | "purchase_before_service";
  decisionCode: "non_persistable_conversation";
}>;

export type UnsupportedExpenseSemantics = Readonly<{
  status: "unsupported";
  persistable: false;
  reason:
    | "invalid_input"
    | "invalid_candidate_category"
    | "invalid_candidate_item_key"
    | "unsupported_semantics";
  decisionCode: "fail_closed";
}>;

export type ExpenseSemanticResult =
  | ResolvedExpenseSemantics
  | NeedsSemanticClarification
  | ConversationOnlyExpenseSemantics
  | UnsupportedExpenseSemantics;
