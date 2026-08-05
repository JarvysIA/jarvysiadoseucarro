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
 * NOTA DE ESCOPO (resolvida): GNV como combustível (reabastecimento) — "gnv" bare
 * resolve Combustível (ver matchesGnvFuel), exceto quando a mesma mensagem contém
 * "kit gnv" (Acessórios), que continua resolvendo sozinho sem Combustível concorrendo.
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
    "consertei o ar condicionado",
    "carga de gas do ar condicionado",
    "gas do ar condicionado",
    "carga de gas",
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
    "enchi o tanque",
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

const GNV_BARE_KEYWORD = "gnv";
const GNV_ACESSORIOS_QUALIFIED_KEYWORD = "kit gnv";

/**
 * REGRA ESPECIAL — "gnv" sozinho (Combustível):
 * "gnv" bare normalmente significa reabastecimento ("abasteci gnv", "coloquei gnv",
 * "gnv 30") — Combustível. Mas "gnv" também aparece dentro de "kit gnv" (instalação
 * do kit, Acessórios — CATEGORY_KEYWORDS.Acessórios). Quando a mesma mensagem já
 * contém "kit gnv", a palavra solta "gnv" NÃO dispara Combustível adicionalmente —
 * evita reconhecer as duas categorias pela mesma menção a "kit gnv", que já é
 * suficientemente específica sozinha. Mesmo padrão de matchesEngineOil/
 * matchesEngineAirFilter em engine-concept-recognizer.ts: termo específico do
 * "outro lado" presente suprime o termo bare/ambíguo.
 */
function matchesGnvFuel(haystack: string): boolean {
  if (!hasKeyword(haystack, GNV_BARE_KEYWORD)) return false;
  if (hasKeyword(haystack, GNV_ACESSORIOS_QUALIFIED_KEYWORD)) return false;
  return true;
}

function isCategoryRecognized(category: NonEngineCategory, haystack: string): boolean {
  if (category === "Combustível") {
    return matchesAny(haystack, CATEGORY_KEYWORDS.Combustível) || matchesGnvFuel(haystack);
  }
  return matchesAny(haystack, CATEGORY_KEYWORDS[category]);
}

const GERAL_KEYWORD = "geral";
const GERAL_CANDIDATE_CATEGORIES: readonly NonEngineCategory[] = ["Lavagem"];

/**
 * REGRA ESPECIAL — "geral" sozinho:
 * é vago demais para decidir categoria sozinho ("lavagem geral", "revisão geral",
 * "manutenção geral" são todos plausíveis). Lavagem é o palpite mais provável no
 * dia a dia, mas nunca deve ser afirmado sem confirmação explícita. Suas categorias
 * candidatas são SOMADAS às demais categorias já reconhecidas no mesmo texto pelo
 * dicionário normal (nunca as substituem) — a presença de "geral" sempre introduz
 * incerteza, então o resultado final nunca é "resolved" quando esta regra se aplica,
 * mesmo que a união acabe tendo só uma categoria.
 */
function isGeralAmbiguous(haystack: string): boolean {
  return hasKeyword(haystack, GERAL_KEYWORD);
}

const FAROL_BARE_KEYWORD = "farol";
const FAROL_CANDIDATE_CATEGORIES: readonly NonEngineCategory[] = ["Manutenção", "Acessórios"];

/**
 * REGRA ESPECIAL — "farol" sozinho:
 * "farol" sem qualificador é ambíguo entre um problema funcional (farol queimado —
 * Manutenção) e uma peça decorativa/acessório (farol decorativo — Acessórios).
 * Quando a mesma mensagem já contém um dos termos qualificados abaixo, a ambiguidade
 * é resolvida por eles via CATEGORY_KEYWORDS normalmente, e esta regra não se aplica.
 * Quando se aplica, suas categorias candidatas são SOMADAS às demais categorias já
 * reconhecidas no mesmo texto (nunca as substituem) — assim como em "geral", o
 * resultado final nunca é "resolved" quando esta regra se aplica.
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

  const matched: NonEngineCategory[] = [];
  for (const category of NON_ENGINE_CATEGORIES) {
    if (isCategoryRecognized(category, haystack)) matched.push(category);
  }

  const specialCategories: NonEngineCategory[] = [];
  if (isGeralAmbiguous(haystack)) specialCategories.push(...GERAL_CANDIDATE_CATEGORIES);
  if (isFarolAmbiguous(haystack)) specialCategories.push(...FAROL_CANDIDATE_CATEGORIES);

  const union: NonEngineCategory[] = [];
  for (const category of [...matched, ...specialCategories]) {
    if (!union.includes(category)) union.push(category);
  }

  if (union.length === 0) return { status: "unrecognized" };
  // Regras especiais nunca resolvem sozinhas: se alguma se aplicou, o resultado
  // fica sempre "ambiguous", mesmo que a união tenha apenas uma categoria.
  if (specialCategories.length === 0 && union.length === 1) {
    return { status: "resolved", category: union[0] };
  }
  return { status: "ambiguous", candidateCategories: union };
}
