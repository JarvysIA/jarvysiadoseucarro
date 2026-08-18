import { normalizeExpenseSemanticText } from "./normalization.ts";
import type { ExplicitExpenseIntent } from "./types.ts";

/**
 * I1 — classificador puro de intenção explícita (record_completed_expense /
 * ask_question / discuss_future_service / request_quote), ou "ambiguous"
 * quando nenhum sinal bate com confiança. Módulo 100% puro: sem I/O, sem
 * Deno, sem fetch, sem clock, sem IA. Não integra com core.ts nem com
 * expense-create-draft.ts — só classifica intenção, não muda categoria de
 * nada.
 */
export type ExpenseIntentClassification = ExplicitExpenseIntent | "ambiguous";

// Conclusão — vence sozinha, exceto se cancelada por uma negação presente na
// mesma mensagem (ver COMPLETION_NEGATION_KEYWORDS).
const COMPLETION_KEYWORDS: readonly string[] = [
  "troquei",
  "comprei",
  "paguei",
  "gastei",
  "fiz",
  "coloquei",
  "instalei",
  "consertei",
  "levei",
  "botei",
  "arrumei",
  "resolvi",
  "peguei",
  "saiu",
  "ficou",
  "deu",
  "cobrou",
  "mandei trocar",
  "mandei fazer",
  "ta trocado",
  "esta trocado",
  "foi trocado",
  "ta pago",
  "esta pago",
  "foi pago",
];

// Cancela o sinal de COMPLETION_KEYWORDS quando presente na mesma mensagem.
const COMPLETION_NEGATION_KEYWORDS: readonly string[] = [
  "nao troquei",
  "nao comprei",
  "nao paguei",
  "nao fiz",
  "ainda nao",
  "nunca troquei",
];

// Orçamento/preço.
const QUOTE_KEYWORDS: readonly string[] = [
  "quanto custa",
  "quanto fica",
  "quanto cobra",
  "qual o preco",
  "qual o valor",
  "preco para",
  "preco de",
  "cotacao de",
  "quanto sai",
  "sai quanto",
  "quanto que fica",
  "quanto vai custar",
  "quanto seria",
  "tem nocao de quanto",
  "tem ideia do valor",
  "faz um orcamento",
  "manda um orcamento",
  "pedi orcamento",
];

// Pergunta técnica — checada ANTES de futuro (ver ordem de precedência em
// recognizeExpenseIntent, abaixo).
const TECHNICAL_QUESTION_KEYWORDS: readonly string[] = [
  "qual oleo",
  "que oleo",
  "posso usar",
  "e normal",
  "por que",
  "sera que",
  "pode ser",
  "da pra",
  "consigo",
  "vcs recomendam",
  "voces recomendam",
  "tem problema se",
];

// Intenção futura.
const FUTURE_KEYWORDS: readonly string[] = [
  "vou trocar",
  "vou levar",
  "pretendo",
  "quero trocar",
  "queria trocar",
  "preciso trocar",
  "tenho que trocar",
  "devo trocar",
  "falta trocar",
  "pensando em",
  "amanha",
  "semana que vem",
  "mes que vem",
  "ano que vem",
  "essa semana",
  "esse fim de semana",
  "mais tarde",
  "depois eu troco",
  "ainda vou",
  "ta na hora de",
  "esta na hora de",
];

/**
 * Mesma técnica já usada em expense-category-recognizer.ts (hasBareKeyword
 * ali, não exportada) — normaliza a palavra-chave e compara com espaços nas
 * bordas do haystack (já normalizado e cercado de espaços pelo chamador),
 * nunca substring solta. Reproduzida localmente por instrução explícita
 * deste build: não é escopo extrair/refatorar um helper compartilhado.
 */
function hasBareKeyword(haystack: string, keyword: string): boolean {
  const normalizedKeyword = normalizeExpenseSemanticText(keyword);
  if (normalizedKeyword === "") return false;
  return haystack.indexOf(" " + normalizedKeyword + " ") >= 0;
}

function anyKeywordMatches(haystack: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => hasBareKeyword(haystack, keyword));
}

export function recognizeExpenseIntent(originalText: string): ExpenseIntentClassification {
  if (typeof originalText !== "string") return "ambiguous";
  const normalized = normalizeExpenseSemanticText(originalText);
  if (normalized === "") return "ambiguous";
  const haystack = " " + normalized + " ";

  // 1) Conclusão vence sozinha, exceto se cancelada por negação presente na
  // mesma mensagem — nesse caso o sinal é descartado e a análise prossegue
  // para os próximos passos (não retorna "ambiguous" direto).
  if (anyKeywordMatches(haystack, COMPLETION_KEYWORDS)) {
    if (!anyKeywordMatches(haystack, COMPLETION_NEGATION_KEYWORDS)) {
      return "record_completed_expense";
    }
  }

  // 2) Orçamento/preço.
  if (anyKeywordMatches(haystack, QUOTE_KEYWORDS)) {
    return "request_quote";
  }

  // 3) Pergunta técnica — checada ANTES de futuro DELIBERADAMENTE (ordem
  // corrigida nesta especificação). Palavras como "sera que"/"pode ser"/
  // "da pra"/"consigo" são sinais fortes de uma pergunta genuína feita
  // AGORA, mesmo que a mesma frase também contenha uma palavra de futuro
  // como "ta na hora de" — ex.: "sera que ja ta na hora de trocar a
  // correia?" deve classificar como pergunta técnica, não como intenção
  // futura, porque a pessoa está pedindo uma opinião/avaliação, não
  // afirmando que vai fazer algo depois. Se a ordem fosse invertida (futuro
  // antes de pergunta técnica), esse caso classificaria erroneamente como
  // discuss_future_service.
  if (anyKeywordMatches(haystack, TECHNICAL_QUESTION_KEYWORDS)) {
    return "ask_question";
  }

  // 4) Intenção futura.
  if (anyKeywordMatches(haystack, FUTURE_KEYWORDS)) {
    return "discuss_future_service";
  }

  // 5) Nenhum sinal bateu com confiança — NUNCA presumir
  // record_completed_expense por ausência de sinal.
  return "ambiguous";
}
