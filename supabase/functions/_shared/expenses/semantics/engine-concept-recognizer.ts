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
  // "oleo" solto é tratado à parte por matchesEngineOil (regra especial abaixo),
  // não faz parte desta lista simples.
  engine_oil: ["troca de oleo", "oleo do motor", "lubrificante"],
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
  // "filtro do ar" (ambíguo com cabin_filter) é tratado à parte por
  // matchesEngineAirFilter (regra especial abaixo), não faz parte desta lista simples.
  engine_air_filter: ["filtro de ar"],
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

const ENGINE_OIL_BARE_KEYWORD = "oleo";

/**
 * REGRA ESPECIAL — engine_oil:
 * a palavra solta "oleo" é o caso mais comum (troca de óleo do motor) e por padrão
 * já basta para reconhecer engine_oil. Mas "oleo" também aparece dentro de frases de
 * câmbio ("oleo do cambio") e de direção hidráulica ("oleo da direcao"), então quando
 * a mesma mensagem já contém um termo de transmission_fluid ou power_steering_fluid,
 * a palavra solta "oleo" NÃO dispara engine_oil adicionalmente — evita falso positivo.
 * Termos mais específicos de engine_oil (SYNONYM_KEYWORDS.engine_oil) não têm essa
 * exceção: continuam sempre reconhecendo engine_oil, mesmo ao lado de câmbio/direção.
 */
function matchesEngineOil(haystack: string): boolean {
  const specificKeywords = SYNONYM_KEYWORDS.engine_oil;
  if (specificKeywords !== undefined && matchesAny(haystack, specificKeywords)) return true;
  if (!hasKeyword(haystack, ENGINE_OIL_BARE_KEYWORD)) return false;
  const transmissionKeywords = SYNONYM_KEYWORDS.transmission_fluid ?? [];
  const steeringKeywords = SYNONYM_KEYWORDS.power_steering_fluid ?? [];
  if (matchesAny(haystack, transmissionKeywords) || matchesAny(haystack, steeringKeywords)) {
    return false;
  }
  return true;
}

const ENGINE_AIR_FILTER_AMBIGUOUS_KEYWORD = "filtro do ar";

/**
 * REGRA ESPECIAL — engine_air_filter:
 * "filtro do ar" é ambíguo porque também aparece dentro de "filtro do ar condicionado" /
 * "filtro do ar-condicionado" (termos de cabin_filter). Quando a mesma mensagem já
 * contém um termo de cabin_filter, "filtro do ar" sozinho NÃO dispara engine_air_filter
 * adicionalmente — evita reconhecer os dois pela mesma menção de filtro de cabine.
 * "filtro de ar" (SYNONYM_KEYWORDS.engine_air_filter) é inequívoco e sempre dispara,
 * mesmo ao lado de uma menção explícita e separada de cabin_filter.
 */
function matchesEngineAirFilter(haystack: string): boolean {
  const unambiguousKeywords = SYNONYM_KEYWORDS.engine_air_filter;
  if (unambiguousKeywords !== undefined && matchesAny(haystack, unambiguousKeywords)) return true;
  if (!hasKeyword(haystack, ENGINE_AIR_FILTER_AMBIGUOUS_KEYWORD)) return false;
  const cabinFilterKeywords = SYNONYM_KEYWORDS.cabin_filter ?? [];
  if (matchesAny(haystack, cabinFilterKeywords)) return false;
  return true;
}

function isConceptRecognized(conceptKey: ExpenseSemanticConceptKey, haystack: string): boolean {
  if (conceptKey === "cooling_system") return matchesCoolingSystem(haystack);
  if (conceptKey === "engine_oil") return matchesEngineOil(haystack);
  if (conceptKey === "engine_air_filter") return matchesEngineAirFilter(haystack);
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
