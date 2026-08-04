import { normalizeExpenseSemanticText } from "./normalization.ts";

/**
 * P0-3B-R (build 2/4) — classificador heurístico de despesas fora do motor.
 *
 * Módulo 100% puro: sem I/O, sem Deno, sem fetch, sem clock, sem crypto, sem logs, sem IA.
 * Dado um texto livre, classifica despesas que NÃO envolvem nenhum conceito de motor
 * determinístico entre as 7 categorias não-motor abaixo.
 *
 * INVARIANTE: este módulo NUNCA decide nem retorna a categoria "Revisão" — isso é
 * responsabilidade exclusiva do reconhecedor de motor (engine-concept-recognizer.ts,
 * via resolveCategoryForConcepts em concept-event-contract.ts), que não é duplicado
 * nem reimplementado aqui. Este classificador é usado apenas quando nenhum conceito
 * de motor foi reconhecido no mesmo texto.
 *
 * NOTA DE ESCOPO: GNV como combustível (reabastecimento) não está incluído no
 * dicionário de Combustível, porque a palavra "gnv" colide com "kit gnv" (Acessórios).
 * Fica para calibração futura, com termo mais específico (ex.: "abasteci gnv").
 */

export type NonEngineCategory =
  | "Manutenção"
  | "Acessórios"
  | "Lavagem"
  | "Combustível"
  | "IPVA"
  | "Multas"
  | "Seguro";

export type NonEngineHeuristicResult =
  | { status: "resolved"; category: NonEngineCategory }
  | { status: "ambiguous"; candidateCategories: readonly NonEngineCategory[] }
  | { status: "unrecognized" };

const NON_ENGINE_CATEGORIES: readonly NonEngineCategory[] = [
  "Manutenção",
  "Acessórios",
  "Lavagem",
  "Combustível",
  "IPVA",
  "Multas",
  "Seguro",
];

const CATEGORY_KEYWORDS: Readonly<Record<NonEngineCategory, readonly string[]>> = {
  Acessórios: [
    "parachoque",
    "capa de banco",
    "tapete",
    "calota",
    "som automotivo",
    "som",
    "pelicula",
    "capa de volante",
    "emblema",
    "subwoofer",
    "antena eletrica",
    "ppf",
    "insulfilme",
    "envelopamento",
    "kit gnv",
    "stage 2",
    "tuning",
    "farol decorativo",
  ],
  Lavagem: ["lavagem", "lava rapido", "lavacao", "higienizacao", "polimento", "ducha"],
  Manutenção: [
    "conserto",
    "reparo",
    "oficina",
    "mecanico",
    "embreagem",
    "bateria",
    "alternador",
    "pneu",
    "pneus",
    "parafuso da roda",
    "parafusos da roda",
    "escapamento",
    "homocineticas",
    "homocinetica",
    "tampa de valvula",
    "bomba d'agua",
    "bomba de agua",
    "junta do carter",
    "sensor map",
    "sonda lambda",
    "bico injetor",
    "caixa de direcao",
    "bomba de direcao",
    "buzina",
    "botao de vidro",
    "lente de retrovisor",
    "conserto de ar condicionado",
    "conserto do ar condicionado",
    "carga de gas do ar condicionado",
    "gas do ar condicionado",
    "farol queimado",
    "farol quebrado",
    "lampada do farol",
    "radiador",
  ],
  Combustível: [
    "gasolina",
    "alcool",
    "etanol",
    "diesel",
    "combustivel",
    "posto",
    "abasteci",
    "abastecimento",
    "tanque cheio",
    "encher o tanque",
    "completei o tanque",
  ],
  IPVA: ["ipva"],
  Multas: ["multa", "multas", "infracao"],
  Seguro: ["seguro", "seguradora", "apolice"],
};

function hasKeyword(haystack: string, keyword: string): boolean {
  // haystack já vem com espaço nas bordas e tokens separados por espaço único.
  const normalizedKeyword = normalizeExpenseSemanticText(keyword);
  if (normalizedKeyword === "") return false;
  return haystack.indexOf(" " + normalizedKeyword + " ") >= 0;
}

function matchesAny(haystack: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => hasKeyword(haystack, keyword));
}

const GERAL_KEYWORD = "geral";

/**
 * REGRA ESPECIAL — "geral" sozinho:
 * é vago demais para decidir categoria sozinho ("lavagem geral", "revisão geral",
 * "manutenção geral" são todos plausíveis). Lavagem é o palpite mais provável no
 * dia a dia, mas nunca deve ser afirmado sem confirmação explícita — por isso
 * sempre retorna "ambiguous", nunca "resolved", mesmo sem nenhum outro termo no texto.
 */
function isGeralAmbiguous(haystack: string): boolean {
  return hasKeyword(haystack, GERAL_KEYWORD);
}

const FAROL_BARE_KEYWORD = "farol";

/**
 * REGRA ESPECIAL — "farol" sozinho:
 * "farol" sem qualificador é ambíguo entre um problema funcional (farol queimado —
 * Manutenção) e uma peça decorativa/acessório (farol decorativo — Acessórios).
 * Quando a mesma mensagem já contém um dos termos qualificados abaixo, a ambiguidade
 * é resolvida por eles via CATEGORY_KEYWORDS normalmente, e esta regra não se aplica.
 */
const FAROL_QUALIFIED_KEYWORDS: readonly string[] = [
  "farol decorativo",
  "farol queimado",
  "farol quebrado",
  "lampada do farol",
];

function isFarolAmbiguous(haystack: string): boolean {
  if (!hasKeyword(haystack, FAROL_BARE_KEYWORD)) return false;
  return !matchesAny(haystack, FAROL_QUALIFIED_KEYWORDS);
}

export function classifyNonEngineExpense(originalText: string): NonEngineHeuristicResult {
  if (typeof originalText !== "string") return { status: "unrecognized" };
  const normalized = normalizeExpenseSemanticText(originalText);
  if (normalized === "") return { status: "unrecognized" };
  const haystack = " " + normalized + " ";

  if (isGeralAmbiguous(haystack)) {
    return { status: "ambiguous", candidateCategories: ["Lavagem"] };
  }
  if (isFarolAmbiguous(haystack)) {
    return { status: "ambiguous", candidateCategories: ["Manutenção", "Acessórios"] };
  }

  const matched: NonEngineCategory[] = [];
  for (const category of NON_ENGINE_CATEGORIES) {
    if (matchesAny(haystack, CATEGORY_KEYWORDS[category])) matched.push(category);
  }

  if (matched.length === 0) return { status: "unrecognized" };
  if (matched.length === 1) return { status: "resolved", category: matched[0] };
  return { status: "ambiguous", candidateCategories: matched };
}
