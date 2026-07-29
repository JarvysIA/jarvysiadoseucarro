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
  reason: "oil_system_ambiguous" | "expense_or_question_intent_ambiguous";
  decisionCode: "clarification_required";
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
