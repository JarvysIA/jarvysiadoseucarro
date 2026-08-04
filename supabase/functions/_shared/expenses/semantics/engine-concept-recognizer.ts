import { EXPENSE_SEMANTIC_CONCEPT_REGISTRY, type ExpenseSemanticConceptKey } from "./registry.ts";
import { normalizeExpenseSemanticText } from "./normalization.ts";

/**
 * P0-3B-R (build 1/4) — reconhecedor determinístico de conceitos de motor por sinônimo textual.
 *
 * Módulo 100% puro: sem I/O, sem Deno, sem fetch, sem clock, sem crypto, sem logs, sem IA.
 * Dado um texto livre, devolve apenas a lista de conceitos reconhecidos — não decide
 * categoria. A coerência categoria-conceito já é resolvida por resolveCategoryForConcepts
 * (concept-event-contract.ts), que não é duplicado nem reimplementado aqui.
 *
 * Escopo deste build: cobre somente os 15 conceitos de categoria "Revisão" do registry.
 * "tires" e "multimedia_system" ficam fora deliberadamente, para uma etapa futura separada.
 *
 * Exclusões explícitas (decisões confirmadas — não reintroduzir em builds futuros):
 * - "bico injetor" não pertence a spark_and_injection: peça reativa, sem km fixo de troca.
 * - "caixa de direcao" e "bomba de direcao" não pertencem a power_steering_fluid: peças
 *   reativas; só o fluido é preventivo.
 * - "bomba d'agua" / "bomba de agua" não pertence a cooling_system: peça reativa.
 * - "radiador" sozinho não pertence a cooling_system: ver REGRA ESPECIAL abaixo.
 */

const SYNONYM_KEYWORDS: Readonly<Partial<Record<ExpenseSemanticConceptKey, readonly string[]>>> = {
  engine_oil: ["oleo", "troca de oleo", "oleo do motor", "lubrificante"],
  engine_oil_filter: ["filtro de oleo", "filtro do oleo", "filtro do oleo do motor"],
  transmission_fluid: [
    "cambio",
    "oleo do cambio",
    "oleo da transmissao",
    "fluido do cambio",
    "fluido da transmissao",
  ],
  brake_pads: [
    "pastilha",
    "pastilhas",
    "pastilha de freio",
    "disco de freio",
    "discos de freio",
    "fluido de freio",
    "sangria de freio",
    "freio",
    "freios",
  ],
  engine_air_filter: ["filtro de ar", "filtro do ar"],
  cabin_filter: ["filtro de cabine", "filtro do ar condicionado", "filtro do ar-condicionado"],
  fuel_filter: [
    "filtro de combustivel",
    "filtro de gasolina",
    "filtro de diesel",
    "filtro de etanol",
  ],
  timing_kit: ["kit sincronismo", "correia dentada", "correia banhada", "correia poly v", "poly v"],
  // cooling_system: regra condicional, tratada por matchesCoolingSystem (não é lista simples).
  spark_and_injection: ["vela", "velas", "vela de ignicao", "cabo de vela", "bobina"],
  suspension: ["suspensao", "amortecedor", "bucha da balanca", "buchas da balanca"],
  wiper_blades: ["palheta", "palhetas", "palheta do limpador", "borracha do limpador"],
  wheel_alignment: ["alinhamento", "balanceamento", "cambagem", "geometria", "caster"],
  power_steering_fluid: ["direcao hidraulica", "oleo da direcao", "fluido da direcao"],
  hybrid_ecvt_diagnostic: [
    "diagnostico e-cvt",
    "diagnostico do cvt",
    "scanner do hibrido",
    "check-up da cvt",
  ],
};

/**
 * cooling_system sempre ativa com estes termos, sozinhos, no mesmo texto.
 * "radiador" isolado é deliberadamente excluído daqui — ver matchesCoolingSystem.
 */
const COOLING_SYSTEM_ALWAYS_ON_KEYWORDS: readonly string[] = [
  "arrefecimento",
  "aditivo do radiador",
  "aditivo de arrefecimento",
  "aditivo para radiador",
];

function hasKeyword(haystack: string, keyword: string): boolean {
  // haystack já vem com espaço nas bordas e tokens separados por espaço único.
  const normalizedKeyword = normalizeExpenseSemanticText(keyword);
  if (normalizedKeyword === "") return false;
  return haystack.indexOf(" " + normalizedKeyword + " ") >= 0;
}

function matchesAny(haystack: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => hasKeyword(haystack, keyword));
}

/**
 * REGRA ESPECIAL — cooling_system:
 * "radiador" é uma peça reativa (trocada por falha, sem km fixo de troca preventiva),
 * então mencionar "radiador" sozinho — ex. "trocar o radiador" — NÃO deve ser
 * reconhecido como um conceito de motor de calendário preventivo. Já "arrefecimento"
 * e as variações de "aditivo ... radiador" indicam um serviço de calendário
 * preventivo real (o aditivo do sistema de arrefecimento), e por isso sempre ativam
 * o conceito, sozinhos, independentemente de "radiador" também aparecer no texto.
 */
function matchesCoolingSystem(haystack: string): boolean {
  return matchesAny(haystack, COOLING_SYSTEM_ALWAYS_ON_KEYWORDS);
}

function isConceptRecognized(conceptKey: ExpenseSemanticConceptKey, haystack: string): boolean {
  if (conceptKey === "cooling_system") return matchesCoolingSystem(haystack);
  const keywords = SYNONYM_KEYWORDS[conceptKey];
  return keywords !== undefined && matchesAny(haystack, keywords);
}

export function recognizeEngineConcepts(
  originalText: string,
): readonly ExpenseSemanticConceptKey[] {
  if (typeof originalText !== "string") return [];
  const normalized = normalizeExpenseSemanticText(originalText);
  if (normalized === "") return [];
  const haystack = " " + normalized + " ";

  const recognized: ExpenseSemanticConceptKey[] = [];
  for (const { conceptKey } of EXPENSE_SEMANTIC_CONCEPT_REGISTRY) {
    if (conceptKey === "tires" || conceptKey === "multimedia_system") continue;
    if (isConceptRecognized(conceptKey, haystack)) recognized.push(conceptKey);
  }
  return recognized;
}
