import {
  EXPENSE_SEMANTIC_ALIASES,
  isExpenseSemanticCategory,
  isExpenseSemanticItemKey,
} from "./registry.ts";
import { normalizeExpenseSemanticText } from "./normalization.ts";
import type {
  ConversationOnlyExpenseSemantics,
  ExpenseSemanticInput,
  ExpenseSemanticItemKey,
  ExpenseSemanticResult,
  NeedsSemanticClarification,
  ResolvedExpenseSemantics,
  UnsupportedExpenseSemantics,
} from "./types.ts";

const COMPLETED_MARKERS = [
  "troquei",
  "fiz a troca",
  "foi substituido",
  "foi substituida",
  "consertei",
  "reparei",
] as const;
const AUTOMOTIVE_SERVICE_TERMS = [
  "escapamento",
  "pastilha de freio",
  "pastilhas de freio",
  "pneu",
  "pneus",
  "parafuso da roda",
  "parafusos da roda",
] as const;

function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function containsAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsPhrase(text, phrase));
}

function unsupported(reason: UnsupportedExpenseSemantics["reason"]): UnsupportedExpenseSemantics {
  return { status: "unsupported", persistable: false, reason, decisionCode: "fail_closed" };
}

function conversation(
  reason: ConversationOnlyExpenseSemantics["reason"],
): ConversationOnlyExpenseSemantics {
  return {
    status: "conversation_only",
    persistable: false,
    reason,
    decisionCode: "non_persistable_conversation",
  };
}

function clarification(reason: NeedsSemanticClarification["reason"]): NeedsSemanticClarification {
  return {
    status: "needs_clarification",
    persistable: false,
    reason,
    decisionCode: "clarification_required",
  };
}

function resolved(
  conceptualCategory: ResolvedExpenseSemantics["conceptualCategory"],
  itemKeys: readonly ExpenseSemanticItemKey[],
  recognizedSystems: ResolvedExpenseSemantics["facts"]["recognizedSystems"],
  decisionCode: ResolvedExpenseSemantics["decisionCode"],
): ResolvedExpenseSemantics {
  const orderedKeys = (["oleo_motor", "filtro_oleo"] as const).filter((key) =>
    itemKeys.includes(key),
  );
  return {
    status: "resolved",
    persistable: true,
    conceptualCategory,
    itemKeys: orderedKeys,
    facts: { serviceCompleted: true, recognizedSystems },
    decisionCode,
  };
}

function classifyConversation(
  text: string,
  input: ExpenseSemanticInput,
): ConversationOnlyExpenseSemantics | undefined {
  if (
    input.explicitIntent === "ask_question" ||
    containsAny(text, ["quero saber", "serve no meu carro"])
  ) {
    return conversation("technical_question");
  }
  if (
    input.explicitIntent === "request_quote" ||
    containsAny(text, ["orcamento", "recebi um orcamento"])
  ) {
    return conversation("quote");
  }
  if (
    containsAny(text, [
      "comprei oleo e filtro mas ainda nao troquei",
      "comprei mas ainda nao troquei",
    ])
  ) {
    return conversation("purchase_before_service");
  }
  if (
    input.explicitIntent === "discuss_future_service" ||
    containsAny(text, ["preciso trocar", "preciso comprar", "estou pensando em trocar"])
  ) {
    return conversation("future_service");
  }
  return undefined;
}

function hasEngineOil(text: string): boolean {
  return (
    containsAny(text, EXPENSE_SEMANTIC_ALIASES.engineOil) ||
    /(?:^| )oleo [a-z0-9]+ do motor(?: |$)/.test(text)
  );
}

export function resolveExpenseSemantics(input: ExpenseSemanticInput): ExpenseSemanticResult {
  if (!input || typeof input.originalText !== "string") return unsupported("invalid_input");
  if (
    input.candidateCategory !== undefined &&
    !isExpenseSemanticCategory(input.candidateCategory)
  ) {
    return unsupported("invalid_candidate_category");
  }
  if (
    input.candidateItemKeys !== undefined &&
    (!Array.isArray(input.candidateItemKeys) ||
      !input.candidateItemKeys.every(isExpenseSemanticItemKey))
  ) {
    return unsupported("invalid_candidate_item_key");
  }

  const text = normalizeExpenseSemanticText(input.originalText);
  if (!text) return unsupported("invalid_input");

  const conversationResult = classifyConversation(text, input);
  if (conversationResult) return conversationResult;

  const completed =
    input.explicitIntent === "record_completed_expense" || containsAny(text, COMPLETED_MARKERS);
  const transmissionFluid = containsAny(text, EXPENSE_SEMANTIC_ALIASES.transmissionFluid);
  const explicitlyFilterOnly = containsAny(text, ["apenas o filtro", "apenas filtro"]);
  const engineOil = hasEngineOil(text) && !explicitlyFilterOnly;
  const oilFilter = containsAny(text, EXPENSE_SEMANTIC_ALIASES.engineOilFilter);
  const mentionsOil = containsPhrase(text, "oleo");
  const mentionsAmount = /(?:^| )(?:r )?\d+(?: |$)/.test(text);

  if (
    !completed &&
    mentionsAmount &&
    (transmissionFluid || engineOil || oilFilter || containsAny(text, AUTOMOTIVE_SERVICE_TERMS))
  ) {
    return clarification("expense_or_question_intent_ambiguous");
  }

  if (!completed) return unsupported("unsupported_semantics");

  if (transmissionFluid) {
    return resolved(
      "Revisão",
      [],
      ["transmission_fluid"],
      "completed_transmission_fluid_without_safe_item_key",
    );
  }

  if (engineOil) {
    return resolved(
      "Revisão",
      ["oleo_motor", "filtro_oleo"],
      ["engine_oil"],
      "completed_deterministic_revision_item",
    );
  }

  if (oilFilter) {
    return resolved(
      "Revisão",
      ["filtro_oleo"],
      ["engine_oil"],
      "completed_deterministic_revision_item",
    );
  }

  if (mentionsOil) return clarification("oil_system_ambiguous");

  if (containsAny(text, AUTOMOTIVE_SERVICE_TERMS)) {
    return resolved("Manutenção", [], ["automotive_service"], "completed_automotive_service");
  }

  return unsupported("unsupported_semantics");
}
