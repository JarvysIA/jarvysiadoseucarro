import { recognizeEngineConcepts } from "./engine-concept-recognizer.ts";
import { classifyNonEngineExpense } from "./non-engine-heuristic-classifier.ts";
import {
  resolveCategoryForConcepts,
  type RecognizedAutomotiveConcept,
} from "./concept-event-contract.ts";
import { findExpenseSemanticConcept, type ExpenseSemanticConceptKey } from "./registry.ts";
import type {
  ExpenseSemanticFacts,
  ExpenseSemanticItemKey,
  ExpenseSemanticResult,
} from "./types.ts";

/**
 * P0-3B-R (build 3/4) — orquestrador que junta engine-concept-recognizer.ts (build 1)
 * e non-engine-heuristic-classifier.ts (build 2) num único ExpenseSemanticResult.
 *
 * Módulo 100% puro: sem I/O, sem Deno, sem fetch, sem clock, sem crypto, sem logs, sem IA.
 * Não lida com "conversation_only" (pergunta técnica, orçamento, intenção futura) —
 * assume que o texto já foi identificado, numa camada anterior, como tentativa de
 * registrar uma despesa. Ainda desconectado de core.ts (isso é o build 4).
 *
 * Campos usados de cada variante de ExpenseSemanticResult, e de onde vêm:
 *
 * ResolvedExpenseSemantics:
 *   - conceptualCategory: de resolveCategoryForConcepts (caso motor) ou
 *     nonEngineResult.category (caso não-motor).
 *   - itemKeys: união sem duplicatas de relatedItemKeys (registry.ts) dos conceitos
 *     de motor reconhecidos; [] no caso não-motor (itens fora do motor não têm item
 *     key específico neste build).
 *   - facts.recognizedSystems: união fechada existente em types.ts é só
 *     ("engine_oil" | "transmission_fluid" | "automotive_service") — os outros 13
 *     conceitos de motor (brake_pads, timing_kit, cooling_system, etc.) e todas as
 *     7 categorias não-motor não têm valor próprio nesse union, então caem no
 *     fallback genérico já existente "automotive_service", que foi originalmente
 *     criado em resolver.ts exatamente para esse propósito.
 *   - decisionCode: "completed_deterministic_revision_item" para o caso motor (mais
 *     genérico disponível para "um conceito de motor determinístico foi
 *     reconhecido"); "completed_automotive_service" para o caso não-motor (reusa a
 *     convenção já usada em resolver.ts para reconhecimento heurístico genérico).
 *     Nenhum dos dois é perfeito para todos os 15+7 casos individuais, mas são os
 *     mais genéricos e corretos disponíveis sem inventar um novo decisionCode.
 *
 * NeedsSemanticClarification:
 *   - reason: "category_ambiguous_non_engine" (novo valor, adicionado em types.ts
 *     nesta mesma branch) quando classifyNonEngineExpense retorna "ambiguous".
 *   - candidateCategories: nonEngineResult.candidateCategories (NonEngineCategory é
 *     um subconjunto estrutural de ExpenseSemanticCategory, então é atribuível
 *     diretamente, sem cast).
 *
 * UnsupportedExpenseSemantics:
 *   - reason: "unsupported_semantics" (já existente) tanto para
 *     classifyNonEngineExpense retornando "unrecognized" quanto para o caso
 *     defensivo de resolveCategoryForConcepts retornar "conflict" (ver comentário
 *     no corpo da função).
 *
 * PENDÊNCIA BLOQUEANTE (ver types.ts, junto à definição de NeedsSemanticClarification):
 * expense-semantics-to-guided-contract.ts (o adapter em
 * supabase/functions/_shared/whatsapp/conversation/) ainda NÃO sabe interpretar o
 * reason "category_ambiguous_non_engine" — hoje mapearia isso incorretamente para
 * ambiguidade de óleo. Corrigir o adapter é escopo obrigatório do início do Build 4,
 * antes de qualquer conexão com core.ts.
 */

function toRecognizedAutomotiveConcepts(
  conceptKeys: readonly ExpenseSemanticConceptKey[],
): readonly RecognizedAutomotiveConcept[] {
  return conceptKeys.map((conceptKey) => {
    const definition = findExpenseSemanticConcept(conceptKey);
    return {
      conceptKey,
      recognitionSource: "deterministic_core",
      relatedItemKeys: definition?.relatedItemKeys ?? [],
    } as RecognizedAutomotiveConcept;
  });
}

function collectItemKeys(
  conceptKeys: readonly ExpenseSemanticConceptKey[],
): readonly ExpenseSemanticItemKey[] {
  const itemKeys: ExpenseSemanticItemKey[] = [];
  for (const conceptKey of conceptKeys) {
    const definition = findExpenseSemanticConcept(conceptKey);
    if (definition === undefined) continue;
    for (const itemKey of definition.relatedItemKeys) {
      if (!itemKeys.includes(itemKey)) itemKeys.push(itemKey);
    }
  }
  return itemKeys;
}

/**
 * O union recognizedSystems de types.ts só conhece "engine_oil" e
 * "transmission_fluid" como sistemas específicos; qualquer outro conceito de motor
 * reconhecido cai no fallback genérico "automotive_service" (já existente).
 */
function buildEngineRecognizedSystems(
  conceptKeys: readonly ExpenseSemanticConceptKey[],
): ExpenseSemanticFacts["recognizedSystems"] {
  const systems: Array<"engine_oil" | "transmission_fluid" | "automotive_service"> = [];
  for (const conceptKey of conceptKeys) {
    if (conceptKey === "engine_oil") {
      if (!systems.includes("engine_oil")) systems.push("engine_oil");
    } else if (conceptKey === "transmission_fluid") {
      if (!systems.includes("transmission_fluid")) systems.push("transmission_fluid");
    } else if (!systems.includes("automotive_service")) {
      systems.push("automotive_service");
    }
  }
  return systems;
}

export function recognizeExpenseSemantics(originalText: string): ExpenseSemanticResult {
  const engineConcepts = recognizeEngineConcepts(originalText);

  if (engineConcepts.length > 0) {
    const categoryResolution = resolveCategoryForConcepts(
      toRecognizedAutomotiveConcepts(engineConcepts),
    );
    if (categoryResolution.status === "conflict") {
      // Defensivo: não deveria ocorrer hoje, pois os 15 conceitos que
      // recognizeEngineConcepts pode devolver são todos defaultCategory "Revisão"
      // no registry (a regra 1 da cascata sempre vence sozinha). Mantido como
      // fail-closed caso o registry ganhe, no futuro, um conceito de motor com
      // defaultCategory divergente sem que este orquestrador seja revisado junto.
      return {
        status: "unsupported",
        persistable: false,
        reason: "unsupported_semantics",
        decisionCode: "fail_closed",
      };
    }
    return {
      status: "resolved",
      persistable: true,
      conceptualCategory: categoryResolution.category,
      itemKeys: collectItemKeys(engineConcepts),
      facts: {
        serviceCompleted: true,
        recognizedSystems: buildEngineRecognizedSystems(engineConcepts),
      },
      decisionCode: "completed_deterministic_revision_item",
    };
  }

  const nonEngineResult = classifyNonEngineExpense(originalText);

  if (nonEngineResult.status === "resolved") {
    return {
      status: "resolved",
      persistable: true,
      conceptualCategory: nonEngineResult.category,
      itemKeys: [],
      facts: {
        serviceCompleted: true,
        recognizedSystems: ["automotive_service"],
      },
      decisionCode: "completed_automotive_service",
    };
  }

  if (nonEngineResult.status === "ambiguous") {
    return {
      status: "needs_clarification",
      persistable: false,
      reason: "category_ambiguous_non_engine",
      decisionCode: "clarification_required",
      candidateCategories: nonEngineResult.candidateCategories,
    };
  }

  return {
    status: "unsupported",
    persistable: false,
    reason: "unsupported_semantics",
    decisionCode: "fail_closed",
  };
}
