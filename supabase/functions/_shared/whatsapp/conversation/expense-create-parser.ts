// Build expense-create-parser — Parser puro de valor (R$) e categoria a partir
// de texto livre para o fluxo de despesa via WhatsApp. Módulo 100% puro: sem
// I/O, sem Deno, sem fetch, sem clock, sem crypto, sem logs, sem IA. Não
// importa de expense-create-draft.ts nem de actions/expense-types.ts.

// ---------------------------------------------------------------------------
// Constantes locais (duplicadas de propósito).
// ---------------------------------------------------------------------------

const EXPENSE_MAX_VALOR = 999999999.99;
const MAX_INPUT_CHARS = 4000;
const MAX_MATCH_ITER = 2000;

const EXPENSE_CATEGORIES = [
  "Revisão",
  "Manutenção",
  "Lavagem",
  "Combustível",
  "IPVA",
  "Multas",
  "Seguro",
  "Acessórios",
] as const;
type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Contratos públicos
// ---------------------------------------------------------------------------

export type ExpenseValorParseErrorCode =
  | "not_a_string"
  | "empty_text"
  | "no_valor_candidate"
  | "ambiguous_valor_candidate"
  | "invalid_valor_format"
  | "valor_out_of_range";

export type ExpenseValorParseResult =
  | { readonly ok: true; readonly valor: number }
  | { readonly ok: false; readonly code: ExpenseValorParseErrorCode };

export type ExpenseCategoriaMatchErrorCode =
  | "not_a_string"
  | "empty_text"
  | "no_categoria_candidate"
  | "ambiguous_categoria_candidate";

export type ExpenseCategoriaMatchResult =
  | { readonly ok: true; readonly categoria: ExpenseCategory }
  | { readonly ok: false; readonly code: ExpenseCategoriaMatchErrorCode };

// ---------------------------------------------------------------------------
// Normalização interna
// ---------------------------------------------------------------------------

const UNICODE_SPACES_RE = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;
const DIACRITICS_RE = /[\u0300-\u036f]/g;
const ASCII_SPACE_RE = /[ \t\r\n\f\v]+/g;

// Preserva dígitos, vírgula, ponto e "$" (necessário pro marcador "r$").
// Converte pontuação inequívoca em espaço.
const HARMLESS_PUNCT_VALOR_RE = /[()!?;:_/=+-]/g;

function normalizeForValor(input: string): string {
  const capped = input.length > MAX_INPUT_CHARS ? input.slice(0, MAX_INPUT_CHARS) : input;
  return capped
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .replace(UNICODE_SPACES_RE, " ")
    .replace(HARMLESS_PUNCT_VALOR_RE, " ")
    .replace(ASCII_SPACE_RE, " ")
    .trim();
}

// Categoria: normalização mais agressiva (não precisa preservar $/,/.).
const NON_ALNUM_RE = /[^a-z0-9]+/g;

function normalizeForCategoria(input: string): string {
  const capped = input.length > MAX_INPUT_CHARS ? input.slice(0, MAX_INPUT_CHARS) : input;
  const stripped = capped.normalize("NFD").replace(DIACRITICS_RE, "").toLowerCase();
  return " " + stripped.replace(NON_ALNUM_RE, " ").replace(ASCII_SPACE_RE, " ").trim() + " ";
}

// ---------------------------------------------------------------------------
// Validação estrita do número candidato
// ---------------------------------------------------------------------------

type NumberCheck =
  | { readonly kind: "ok"; readonly value: number }
  | { readonly kind: "format" }
  | { readonly kind: "range" };

function inRange(v: number): NumberCheck {
  if (!(v > 0)) return { kind: "range" };
  if (v > EXPENSE_MAX_VALOR) return { kind: "range" };
  return { kind: "ok", value: v };
}

function validateBrlAmountFormat(raw: string): NumberCheck {
  if (raw.length === 0) return { kind: "format" };

  const commaCount = (raw.match(/,/g) ?? []).length;

  if (commaCount > 1) return { kind: "format" };

  if (commaCount === 1) {
    const [intPart, decPart] = raw.split(",");
    if (intPart.length === 0 || decPart.length === 0) return { kind: "format" };
    if (!/^[0-9]{1,2}$/.test(decPart)) return { kind: "format" };
    // Parte inteira: sem ponto, dígitos puros; OU grupos de milhar exatos.
    let intDigits: string;
    if (/^[0-9]+$/.test(intPart)) {
      intDigits = intPart;
    } else if (/^[0-9]{1,3}(?:\.[0-9]{3})+$/.test(intPart)) {
      intDigits = intPart.replace(/\./g, "");
    } else {
      return { kind: "format" };
    }
    if (intDigits.length > 12) return { kind: "range" };
    const centavos = decPart.length === 1 ? Number(decPart) * 10 : Number(decPart);
    const intN = Number(intDigits);
    if (!Number.isFinite(intN) || !Number.isInteger(intN)) {
      return { kind: "format" };
    }
    const totalCentavos = intN * 100 + centavos;
    if (!Number.isSafeInteger(totalCentavos)) return { kind: "range" };
    const value = Math.round(totalCentavos) / 100;
    return inRange(value);
  }

  // Sem vírgula.
  if (raw.indexOf(".") >= 0) {
    // Padrão milhar puro.
    if (/^[0-9]{1,3}(?:\.[0-9]{3})+$/.test(raw)) {
      const digits = raw.replace(/\./g, "");
      if (digits.length > 12) return { kind: "range" };
      const n = Number(digits);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { kind: "format" };
      return inRange(n);
    }
    // Único ponto com 1-2 dígitos depois: trata como decimal.
    const m = /^([0-9]+)\.([0-9]{1,2})$/.exec(raw);
    if (m) {
      const intPart = m[1];
      const decPart = m[2];
      if (intPart.length > 12) return { kind: "range" };
      const intN = Number(intPart);
      if (!Number.isFinite(intN) || !Number.isInteger(intN)) {
        return { kind: "format" };
      }
      const centavos = decPart.length === 1 ? Number(decPart) * 10 : Number(decPart);
      const totalCentavos = intN * 100 + centavos;
      if (!Number.isSafeInteger(totalCentavos)) return { kind: "range" };
      const value = Math.round(totalCentavos) / 100;
      return inRange(value);
    }
    return { kind: "format" };
  }

  // Dígitos puros.
  if (!/^[0-9]+$/.test(raw)) return { kind: "format" };
  if (raw.length > 12) return { kind: "range" };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { kind: "format" };
  return inRange(n);
}

// ---------------------------------------------------------------------------
// Regex combinado — 3 branches (r$ prefix / reais suffix / bare com vírgula)
// ---------------------------------------------------------------------------

const LOOSE_NUM = "[0-9](?:[0-9.,]*[0-9])?";
const BARE_WITH_COMMA = "[0-9](?:[0-9.]*[0-9])?,[0-9]{1,2}";

const VALOR_RE = new RegExp(
  // (a) prefixo r$
  `r\\$\\s*(${LOOSE_NUM})` +
    "|" +
    // (b) sufixo reais
    `(${LOOSE_NUM})\\s*reais\\b` +
    "|" +
    // (c) bare com vírgula-decimal
    `(?<![0-9.,])(${BARE_WITH_COMMA})(?![0-9])`,
  "g",
);

function combineValorResults(results: ReadonlyArray<NumberCheck>): ExpenseValorParseResult {
  if (results.length === 0) return { ok: false, code: "no_valor_candidate" };
  for (const r of results) {
    if (r.kind === "format") return { ok: false, code: "invalid_valor_format" };
  }
  for (const r of results) {
    if (r.kind === "range") return { ok: false, code: "valor_out_of_range" };
  }
  const values: number[] = [];
  for (const r of results) if (r.kind === "ok") values.push(r.value);
  if (values.length === 0) return { ok: false, code: "no_valor_candidate" };
  const distinct = new Set(values);
  if (distinct.size > 1) return { ok: false, code: "ambiguous_valor_candidate" };
  return { ok: true, valor: values[0] };
}

// ---------------------------------------------------------------------------
// parseExpenseValorText
// ---------------------------------------------------------------------------

export function parseExpenseValorText(input: unknown): ExpenseValorParseResult {
  if (typeof input !== "string") return { ok: false, code: "not_a_string" };
  if (input.trim() === "") return { ok: false, code: "empty_text" };
  const normalized = normalizeForValor(input);
  if (normalized === "") return { ok: false, code: "no_valor_candidate" };

  const results: NumberCheck[] = [];
  VALOR_RE.lastIndex = 0;
  let iter = 0;
  let m: RegExpExecArray | null;
  while ((m = VALOR_RE.exec(normalized)) !== null) {
    if (++iter > MAX_MATCH_ITER) break;
    const numStr = m[1] ?? m[2] ?? m[3];
    if (typeof numStr !== "string" || numStr.length === 0) {
      if (VALOR_RE.lastIndex === m.index) VALOR_RE.lastIndex++;
      continue;
    }
    results.push(validateBrlAmountFormat(numStr));
    if (VALOR_RE.lastIndex === m.index) VALOR_RE.lastIndex++;
  }
  return combineValorResults(results);
}

// Aceita número puro (220, 1800) OU agrupado por ponto de milhar (1.800,
// 12.345) — mas nunca os dois ao mesmo tempo dentro do mesmo trecho,
// evita capturar "1800" partido em "180"+"0". validateBrlAmountFormat já
// sabia interpretar o formato com ponto corretamente; só faltava esta
// regex conseguir ENCONTRAR esse formato no texto.
const BARE_NUMBER_RE = /(?<![0-9.,])(?:[0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{1,9})(?![0-9.,])/g;

const BARE_NUMBER_MAX_REASONABLE_VALOR = 20000;

/**
 * Fallback pra número "pelado" (sem R$, sem "reais", sem vírgula-decimal).
 * NUNCA chamar isoladamente — só deve ser usado pelo core.ts quando já
 * houver confirmado que existe uma categoria reconhecida na mesma
 * mensagem.
 */
export function parseExpenseValorBareNumber(input: unknown): ExpenseValorParseResult {
  if (typeof input !== "string") return { ok: false, code: "not_a_string" };
  if (input.trim() === "") return { ok: false, code: "empty_text" };
  const normalized = normalizeForValor(input);
  if (normalized === "") return { ok: false, code: "no_valor_candidate" };

  const matches: string[] = [];
  BARE_NUMBER_RE.lastIndex = 0;
  let iter = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_NUMBER_RE.exec(normalized)) !== null) {
    if (++iter > MAX_MATCH_ITER) break;
    matches.push(m[0]);
    if (BARE_NUMBER_RE.lastIndex === m.index) BARE_NUMBER_RE.lastIndex++;
  }
  if (matches.length === 0) return { ok: false, code: "no_valor_candidate" };
  const distinct = new Set(matches);
  if (distinct.size > 1) return { ok: false, code: "ambiguous_valor_candidate" };
  const check = validateBrlAmountFormat(matches[0]!);
  if (check.kind === "range") return { ok: false, code: "valor_out_of_range" };
  if (check.kind === "format") return { ok: false, code: "invalid_valor_format" };
  if (check.value > BARE_NUMBER_MAX_REASONABLE_VALOR) {
    return { ok: false, code: "valor_out_of_range" };
  }
  return { ok: true, valor: check.value };
}

// ---------------------------------------------------------------------------
// Categorias — tabela de keywords (normalizadas, sem acento)
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: ReadonlyArray<{
  readonly categoria: ExpenseCategory;
  readonly keywords: ReadonlyArray<string>;
}> = [
  {
    categoria: "Combustível",
    keywords: [
      "gasolina",
      "alcool",
      "etanol",
      "diesel",
      "combustivel",
      "posto",
      "abasteci",
      "abastecimento",
      "gnv",
      "completei",
      "completei o tanque",
      "enchi o tanque",
      "tanque cheio",
      "encher o tanque",
    ],
  },
  {
    categoria: "Manutenção",
    keywords: [
      "manutencao",
      "conserto",
      "reparo",
      "oficina",
      "mecanico",
      "embreagem",
      "suspensao",
      "amortecedor",
      "bucha",
      "buchas",
      "batente",
      "ar condicionado",
      "carga de gas",
      "gas do ar condicionado",
      "higienizacao do ar condicionado",
      "bateria",
      "alternador",
      "pneu",
      "pneus",
    ],
  },
  {
    categoria: "Revisão",
    keywords: [
      "revisao",
      "revisao preventiva",
      "revisao programada",
      "oleo",
      "troca de oleo",
      "filtro de oleo",
      "filtro do oleo",
      "filtro de ar",
      "filtro do ar",
      "filtro de cabine",
      "freio",
      "freios",
      "pastilha",
      "pastilhas",
      "pastilha de freio",
      "disco de freio",
      "discos de freio",
      "fluido de freio",
      "sangria de freio",
      "vela",
      "velas",
      "vela de ignicao",
      "correia",
      "correia dentada",
      "correia banhada",
      "correia poly v",
      "kit sincronismo",
      "arrefecimento",
      "radiador",
      "aditivo do radiador",
      "palhetas",
      "alinhamento",
      "balanceamento",
      "cambagem",
      "geometria",
      "cambio",
      "oleo do cambio",
      "direcao hidraulica",
      "oleo da direcao",
    ],
  },
  {
    categoria: "Lavagem",
    keywords: ["lavagem", "lava rapido", "lavacao"],
  },
  { categoria: "IPVA", keywords: ["ipva"] },
  { categoria: "Multas", keywords: ["multa", "multas", "infracao"] },
  { categoria: "Seguro", keywords: ["seguro", "seguradora", "apolice"] },
  {
    categoria: "Acessórios",
    keywords: [
      "acessorio",
      "acessorios",
      "som automotivo",
      "som",
      "pelicula",
      "capa de banco",
      "tapete",
      "calota",
    ],
  },
];

function hasKeyword(haystack: string, keyword: string): boolean {
  // haystack já vem com espaço nas bordas e tokens separados por espaço único.
  return haystack.indexOf(" " + keyword + " ") >= 0;
}

// ---------------------------------------------------------------------------
// matchExpenseCategoria
// ---------------------------------------------------------------------------

export function matchExpenseCategoria(input: unknown): ExpenseCategoriaMatchResult {
  if (typeof input !== "string") return { ok: false, code: "not_a_string" };
  if (input.trim() === "") return { ok: false, code: "empty_text" };
  const normalized = normalizeForCategoria(input);
  if (normalized.trim() === "") {
    return { ok: false, code: "no_categoria_candidate" };
  }

  const matched = new Set<ExpenseCategory>();
  for (const entry of CATEGORY_KEYWORDS) {
    for (const kw of entry.keywords) {
      if (hasKeyword(normalized, kw)) {
        matched.add(entry.categoria);
        break;
      }
    }
  }

  if (matched.size === 0) return { ok: false, code: "no_categoria_candidate" };
  if (matched.size > 1) {
    return { ok: false, code: "ambiguous_categoria_candidate" };
  }
  const [only] = matched;
  return { ok: true, categoria: only };
}
