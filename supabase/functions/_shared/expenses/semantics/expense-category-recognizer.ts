import { recognizeEngineConcepts } from "./engine-concept-recognizer.ts";
import { classifyNonEngineExpense } from "./non-engine-heuristic-classifier.ts";
import {
  resolveCategoryForConcepts,
  type RecognizedAutomotiveConcept,
} from "./concept-event-contract.ts";
import { findExpenseSemanticConcept, type ExpenseSemanticConceptKey } from "./registry.ts";
import { normalizeExpenseSemanticText } from "./normalization.ts";
import type {
  ExpenseSemanticFacts,
  ExpenseSemanticInput,
  ExpenseSemanticItemKey,
  ExpenseSemanticResult,
} from "./types.ts";

/**
 * P0-3B-R (build 3/4) — orquestrador que junta engine-concept-recognizer.ts (build 1)
 * e non-engine-heuristic-classifier.ts (build 2) num único ExpenseSemanticResult.
 *
 * Módulo 100% puro: sem I/O, sem Deno, sem fetch, sem clock, sem crypto, sem logs, sem IA.
 *
 * I2 — recebe ExpenseSemanticInput (não mais uma string solta). O campo
 * explicitIntent (opcional, produzido em uma camada anterior por
 * recognizeExpenseIntent, ver expense-intent-recognizer.ts) habilita um
 * curto-circuito por intenção, checado ANTES de qualquer heurística de
 * categoria: ask_question/discuss_future_service/request_quote retornam
 * "conversation_only" direto (technical_question/future_service/quote), e
 * "ambiguous" retorna "needs_clarification" (reason:
 * expense_or_question_intent_ambiguous). Ou seja, a partir deste build o
 * módulo PASSA a poder produzir "conversation_only" — ao contrário do que
 * esta mesma frase afirmava antes do I2. Quando explicitIntent é
 * "record_completed_expense" OU está ausente (undefined, o caso de hoje em
 * core.ts, que ainda não passa esse campo — isso é o I4), o comportamento é
 * IDÊNTICO ao histórico: nenhuma linha da lógica abaixo do curto-circuito foi
 * alterada por este build.
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
 * Histórico (ver types.ts, junto à definição de NeedsSemanticClarification): o
 * adapter (expense-semantics-to-guided-contract.ts) não sabia interpretar o
 * reason "category_ambiguous_non_engine" até o PR #16 (commit f5822a4), que
 * corrigiu isso.
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

/**
 * Mesma técnica de normalização/checagem de frase-com-bordas-de-espaço já usada
 * em non-engine-heuristic-classifier.ts (hasKeyword). Não é importada de lá
 * porque aquele módulo não exporta esse helper — reproduzida aqui para evitar
 * acoplar este orquestrador a um detalhe interno de outro módulo.
 */
function hasBareKeyword(haystack: string, keyword: string): boolean {
  const normalizedKeyword = normalizeExpenseSemanticText(keyword);
  if (normalizedKeyword === "") return false;
  return haystack.indexOf(" " + normalizedKeyword + " ") >= 0;
}

// SINCRONIZAÇÃO OBRIGATÓRIA COM non-engine-heuristic-classifier.ts —
// ITEM_SPECIFICATION_TRIGGER_KEYWORDS (naquele arquivo) precisa conter os
// mesmos termos-gatilho listados abaixo (exceto "geral", que é tratado
// diretamente por este array, não por aquela lista). Se um novo gatilho for
// adicionado aqui (5º, 6º...), adicione o mesmo termo naquela lista também
// — caso contrário, a regra de cessão de "geral" daquele arquivo continuaria
// tratando o termo novo como ambiguidade de categoria em vez de ceder.
const ITEM_SPECIFICATION_TRIGGERS: ReadonlyArray<{
  keywords: readonly string[];
  trigger: "revision_item_unspecified" | "ac_service_unspecified" | "maintenance_unspecified";
}> = [
  { keywords: ["revisao", "revisao preventiva"], trigger: "revision_item_unspecified" },
  { keywords: ["ar condicionado"], trigger: "ac_service_unspecified" },
  { keywords: ["manutencao"], trigger: "maintenance_unspecified" },
  // "geral" precisa ser a ÚLTIMA entrada: é um fallback genérico (qualquer
  // categoria reconhecida sozinha ao lado de "geral", ex.: "conserto geral",
  // já cede pra cá via non-engine-heuristic-classifier.ts). Se viesse antes
  // dos gatilhos mais específicos, competiria e potencialmente venceria em
  // frases que também contêm "revisão"/"ar condicionado"/"manutenção" ao
  // lado de "geral" (ex.: "revisão geral") — nesses casos o gatilho mais
  // específico (revision_item_unspecified) deve vencer, não o genérico.
  { keywords: ["geral"], trigger: "maintenance_unspecified" },
];

/**
 * Só é chamada como ÚLTIMO RECURSO, depois que recognizeEngineConcepts veio
 * vazio E classifyNonEngineExpense devolveu "unrecognized" — ou seja, motor
 * sempre vence, e um item não-motor já reconhecido (ex.: "revisão, troquei a
 * bateria") também sempre vence, e nenhum deles chega a chamar esta função.
 * Só quando AMBOS os reconhecedores normais vierem vazios é que verificamos se
 * o texto é um dos 4 casos especiais conhecidos ("ar condicionado" sozinho,
 * "revisão"/"revisão preventiva" sozinha, "manutenção" sozinha, ou "geral"
 * cedido por non-engine-heuristic-classifier.ts quando nenhuma categoria
 * específica — ou só "Manutenção" — foi reconhecida ao lado dele), que
 * precisam de uma pergunta de especificação de item antes de prosseguir.
 *
 * A ação de turno 2 (reabrir recognizeEngineConcepts na resposta do usuário,
 * com fallback para fallbackCategory se nada for reconhecido) é
 * responsabilidade de um build futuro que conecta isso a core.ts — este
 * módulo permanece puro e desconectado da conversa.
 */
function detectItemSpecificationTrigger(
  originalText: string,
): "revision_item_unspecified" | "ac_service_unspecified" | "maintenance_unspecified" | undefined {
  if (typeof originalText !== "string") return undefined;
  const normalized = normalizeExpenseSemanticText(originalText);
  if (normalized === "") return undefined;
  const haystack = " " + normalized + " ";

  for (const { keywords, trigger } of ITEM_SPECIFICATION_TRIGGERS) {
    if (keywords.some((keyword) => hasBareKeyword(haystack, keyword))) return trigger;
  }
  return undefined;
}

export function recognizeExpenseSemantics(input: ExpenseSemanticInput): ExpenseSemanticResult {
  const { originalText, explicitIntent } = input;

  // I2 — curto-circuito por intenção, inerte quando explicitIntent está
  // ausente (ver comentário de cabeçalho do arquivo).
  if (explicitIntent === "ask_question") {
    return {
      status: "conversation_only",
      persistable: false,
      reason: "technical_question",
      decisionCode: "non_persistable_conversation",
    };
  }
  if (explicitIntent === "discuss_future_service") {
    return {
      status: "conversation_only",
      persistable: false,
      reason: "future_service",
      decisionCode: "non_persistable_conversation",
    };
  }
  if (explicitIntent === "request_quote") {
    return {
      status: "conversation_only",
      persistable: false,
      reason: "quote",
      decisionCode: "non_persistable_conversation",
    };
  }
  if (explicitIntent === "ambiguous") {
    // candidateCategories deliberadamente OMITIDO (não []): o campo, por
    // contrato documentado em types.ts, só é preenchido quando reason ===
    // "category_ambiguous_non_engine" — aqui a ambiguidade é sobre SE é
    // despesa, não sobre QUAL categoria.
    return {
      status: "needs_clarification",
      persistable: false,
      reason: "expense_or_question_intent_ambiguous",
      decisionCode: "clarification_required",
    };
  }

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

  const itemSpecificationTrigger = detectItemSpecificationTrigger(originalText);
  if (itemSpecificationTrigger !== undefined) {
    return {
      status: "needs_item_specification",
      persistable: false,
      trigger: itemSpecificationTrigger,
      fallbackCategory: "Manutenção",
      decisionCode: "item_specification_required",
    };
  }

  return {
    status: "unsupported",
    persistable: false,
    reason: "unsupported_semantics",
    decisionCode: "fail_closed",
  };
}
