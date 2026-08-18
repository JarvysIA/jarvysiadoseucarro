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
   * Histórico (P0-3B-R): o adapter (expense-semantics-to-guided-contract.ts)
   * não sabia interpretar este reason até o PR #16 (commit f5822a4), que o
   * adicionou como um case explícito no switch, com um "ambiguous_category"
   * correspondente em ClarificationReason (guided-expense-contracts.ts).
   */
  candidateCategories?: readonly ExpenseSemanticCategory[];
}>;

/**
 * Caso em que a categoria não é ambígua entre alternativas, mas o texto usa um
 * termo genérico demais para identificar QUAL item específico está sendo
 * tratado (ex.: "ar condicionado" sozinho, "revisão"/"revisão preventiva"
 * sozinha) — uma pergunta de especificação de item é necessária antes de
 * prosseguir. Diferente de NeedsSemanticClarification: aqui não há
 * ambiguidade de categoria (fallbackCategory já é conhecida), só falta saber
 * qual item, dentro dessa categoria, o usuário quis dizer.
 */
export type NeedsItemSpecification = Readonly<{
  status: "needs_item_specification";
  persistable: false;
  trigger: "revision_item_unspecified" | "ac_service_unspecified" | "maintenance_unspecified";
  fallbackCategory: ExpenseSemanticCategory;
  decisionCode: "item_specification_required";
}>;

export type ConversationOnlyExpenseSemantics = Readonly<{
  status: "conversation_only";
  persistable: false;
  reason: "future_service" | "quote" | "technical_question";
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
  | NeedsItemSpecification
  | ConversationOnlyExpenseSemantics
  | UnsupportedExpenseSemantics;
