// Build 5.7F2E1A.5-MC — Parser puro e determinístico de texto de KM.
// Módulo 100% puro: sem I/O, sem Supabase, sem env, sem clock, sem crypto,
// sem rede, sem logs, sem IA. Não altera o input recebido, não cria draft,
// não conecta a core/repository/shadow/worker.

// ---------------------------------------------------------------------------
// Contrato público
// ---------------------------------------------------------------------------

export type KmUpdateParseMode = "explicit_report" | "value_reply";

export type KmUpdateParseErrorCode =
  | "not_a_string"
  | "empty_text"
  | "no_km_candidate"
  | "ambiguous_km_candidate"
  | "invalid_km_format"
  | "km_out_of_range";

export type KmUpdateParseResult =
  | { readonly ok: true; readonly newKm: number }
  | { readonly ok: false; readonly code: KmUpdateParseErrorCode };

// ---------------------------------------------------------------------------
// Constantes locais
// ---------------------------------------------------------------------------

const KM_MIN = 0;
const KM_MAX = 2147483647;
const MAX_INPUT_CHARS = 4000;
const MAX_INT_DIGITS = 10; // 2147483647 tem 10 dígitos
const MAX_MATCH_ITER = 2000;

// ---------------------------------------------------------------------------
// Validação estrita do texto numérico
// ---------------------------------------------------------------------------

type NumberCheck =
  | { readonly kind: "ok"; readonly value: number }
  | { readonly kind: "format" }
  | { readonly kind: "range" };

function isPureDigits(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

function parsePureDigits(s: string): NumberCheck {
  if (!isPureDigits(s)) return { kind: "format" };
  if (s.length > MAX_INT_DIGITS) return { kind: "range" };
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { kind: "format" };
  if (n < KM_MIN || n > KM_MAX) return { kind: "range" };
  return { kind: "ok", value: n };
}

// Valida um número ABSOLUTO (sem sinal, sem "mil").
function validateAbsoluteFormat(raw: string): NumberCheck {
  // Dígitos contínuos.
  if (/^[0-9]+$/.test(raw)) return parsePureDigits(raw);
  // Agrupamento por ponto: 1..3 dígitos + grupos de exatamente 3.
  if (/^[0-9]{1,3}(?:\.[0-9]{3})+$/.test(raw)) {
    return parsePureDigits(raw.replace(/\./g, ""));
  }
  // Agrupamento por espaço.
  if (/^[0-9]{1,3}(?: [0-9]{3})+$/.test(raw)) {
    return parsePureDigits(raw.replace(/ /g, ""));
  }
  return { kind: "format" };
}

// Valida a expressão completa: possível sinal, forma numérica, e flag "mil".
function validateNumberSpec(rawNum: string, hasMil: boolean): NumberCheck {
  // Sinal positivo explícito nunca é aceito.
  if (rawNum.startsWith("+")) return { kind: "format" };
  let sign = 1;
  let body = rawNum;
  if (body.startsWith("-")) {
    sign = -1;
    body = body.slice(1);
  }
  if (body === "") return { kind: "format" };

  if (hasMil) {
    // "N mil" exige N em dígitos contínuos.
    if (!/^[0-9]+$/.test(body)) return { kind: "format" };
    if (body.length > MAX_INT_DIGITS) return { kind: "range" };
    const base = Number(body);
    if (!Number.isFinite(base) || !Number.isInteger(base)) {
      return { kind: "format" };
    }
    // Multiplicação exata por 1000 dentro de safe integer.
    const total = sign * base * 1000;
    if (!Number.isSafeInteger(total)) return { kind: "range" };
    if (total < KM_MIN || total > KM_MAX) return { kind: "range" };
    return { kind: "ok", value: total };
  }

  const check = validateAbsoluteFormat(body);
  if (check.kind !== "ok") return check;
  const signed = sign * check.value;
  if (signed < KM_MIN || signed > KM_MAX) return { kind: "range" };
  return { kind: "ok", value: signed };
}

// ---------------------------------------------------------------------------
// Normalização lexical interna (não mexe no input original)
// ---------------------------------------------------------------------------

const UNICODE_SPACES_RE =
  /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;
// Somente pontuação inequívoca é convertida em espaço.
// Preservados: . , : = + - / _ dígitos, letras.
const HARMLESS_PUNCT_RE = /[()!?;]/g;
const DIACRITICS_RE = /[\u0300-\u036f]/g;
const ASCII_SPACE_RE = /[ \t\r\n\f\v]+/g;

function normalizeInternal(input: string): string {
  const capped =
    input.length > MAX_INPUT_CHARS ? input.slice(0, MAX_INPUT_CHARS) : input;
  return capped
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .replace(UNICODE_SPACES_RE, " ")
    .replace(HARMLESS_PUNCT_RE, " ")
    .replace(ASCII_SPACE_RE, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Reconhecimento lexical
// ---------------------------------------------------------------------------

// Número "solto" (validado depois de forma estrita).
// Permite dígitos, pontos, vírgulas, barras, underlines e espaços internos —
// tudo o que a validação estrita deve inspecionar/rejeitar.
const LOOSE_NUM = "[+\\-]?[0-9](?:[0-9.,\\/_ ]*[0-9])?";
const LABEL = "km atual|quilometragem atual|km|quilometragem|odometro";
// Unidade adjacente ao número (aceita colada a dígito, mas rejeita km/h e km<letra>).
const UNIT = "(?:km|quilometros?)(?![a-z0-9\\/])";
const MIL = "(\\s+mil(?![a-z0-9]))?";

const EXPR_RE = new RegExp(
  // Ramo com rótulo (prefixo).
  `\\b(?:${LABEL})\\b\\s*[:=]?\\s*(${LOOSE_NUM})${MIL}(?:\\s*${UNIT})?` +
    "|" +
    // Ramo com unidade posterior (sufixo).
    `(${LOOSE_NUM})${MIL}\\s*${UNIT}` +
    "|" +
    // Ramo "N mil" sem unidade nem rótulo — reconhecido como candidato de KM
    // apenas para impedir falso sucesso em frases como "50 mil e 500 km".
    `(${LOOSE_NUM})(\\s+mil(?![a-z0-9]))(?!\\s*(?:km|quilometros?))`,
  "g",
);

const VALUE_REPLY_RE = new RegExp(
  `^(?:(?:${LABEL})\\s*[:=]?\\s*)?(${LOOSE_NUM})(\\s+mil)?(?:\\s*(?:km|quilometros?))?$`,
);

// ---------------------------------------------------------------------------
// Parsers por modo
// ---------------------------------------------------------------------------

function combineResults(results: ReadonlyArray<NumberCheck>): KmUpdateParseResult {
  if (results.length === 0) return { ok: false, code: "no_km_candidate" };
  // Precedência: formato > range > sucesso/ambíguo.
  for (const r of results) {
    if (r.kind === "format") return { ok: false, code: "invalid_km_format" };
  }
  for (const r of results) {
    if (r.kind === "range") return { ok: false, code: "km_out_of_range" };
  }
  const values: number[] = [];
  for (const r of results) if (r.kind === "ok") values.push(r.value);
  if (values.length === 0) return { ok: false, code: "no_km_candidate" };
  if (values.length > 1) return { ok: false, code: "ambiguous_km_candidate" };
  return { ok: true, newKm: values[0] };
}

function parseExplicitReport(normalized: string): KmUpdateParseResult {
  const results: NumberCheck[] = [];
  EXPR_RE.lastIndex = 0;
  let iter = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPR_RE.exec(normalized)) !== null) {
    if (++iter > MAX_MATCH_ITER) break;
    const numStr = m[1] ?? m[3] ?? m[5];
    const milStr = m[2] ?? m[4] ?? m[6];
    if (typeof numStr !== "string" || numStr.length === 0) {
      // Evita loop infinito caso o motor produza match de tamanho zero.
      if (EXPR_RE.lastIndex === m.index) EXPR_RE.lastIndex++;
      continue;
    }
    results.push(validateNumberSpec(numStr, typeof milStr === "string"));
    if (EXPR_RE.lastIndex === m.index) EXPR_RE.lastIndex++;
  }
  return combineResults(results);
}

function parseValueReply(normalized: string): KmUpdateParseResult {
  const m = VALUE_REPLY_RE.exec(normalized);
  if (m === null) {
    if (!/[0-9]/.test(normalized)) {
      return { ok: false, code: "no_km_candidate" };
    }
    return { ok: false, code: "invalid_km_format" };
  }
  const numStr = m[1];
  const hasMil = typeof m[2] === "string";
  const check = validateNumberSpec(numStr, hasMil);
  if (check.kind === "ok") return { ok: true, newKm: check.value };
  if (check.kind === "range") return { ok: false, code: "km_out_of_range" };
  return { ok: false, code: "invalid_km_format" };
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

export function parseKmUpdateText(
  input: unknown,
  mode: KmUpdateParseMode,
): KmUpdateParseResult {
  if (typeof input !== "string") return { ok: false, code: "not_a_string" };
  if (input.trim() === "") return { ok: false, code: "empty_text" };
  const normalized = normalizeInternal(input);
  if (normalized === "") return { ok: false, code: "no_km_candidate" };
  if (mode === "explicit_report") return parseExplicitReport(normalized);
  return parseValueReply(normalized);
}
