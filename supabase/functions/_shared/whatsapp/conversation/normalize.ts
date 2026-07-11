// Build 5.7F2A — Normalização determinística para comparação de comandos.
// Puro. Não modifica o texto original que segue para logs/persistência externa.

const STRIP_DIACRITICS_RE = /[\u0300-\u036f]/g;
// Remove emojis/pictogramas comuns. Faixas conservadoras — não afeta ASCII/números/pontuação.
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F000}-\u{1F2FF}\uFE0F\u200D]/gu;
// Pontuação segura para descartar em comparação de comandos.
// Não remove `?` isolado (tratado antes), não remove `+`/`-`/`,`/`.` para preservar
// tokens numéricos futuros (aqui apenas para comparação de comando textual).
const PUNCT_RE = /[!¡¿"'`´()\[\]{}<>;:]/g;
const MULTI_SPACE_RE = /\s+/g;
const MAX_COMPARE_CHARS = 500;

export type NormalizedText = {
  originalText: string;
  normalizedText: string;
  isQuestionMarkOnly: boolean;
  isEmpty: boolean;
  wasTruncatedForComparison: boolean;
};

export function normalizeCommandText(input: string | null | undefined): NormalizedText {
  const originalText = input == null ? "" : String(input);
  const trimmedRaw = originalText.trim();

  if (trimmedRaw === "") {
    return {
      originalText,
      normalizedText: "",
      isQuestionMarkOnly: false,
      isEmpty: true,
      wasTruncatedForComparison: false,
    };
  }

  // Detectar `?` isolado ANTES de qualquer remoção de pontuação.
  const isQuestionMarkOnly = trimmedRaw === "?";

  let working = trimmedRaw;
  const wasTruncatedForComparison = working.length > MAX_COMPARE_CHARS;
  if (wasTruncatedForComparison) working = working.slice(0, MAX_COMPARE_CHARS);

  let normalized = working
    .normalize("NFD")
    .replace(STRIP_DIACRITICS_RE, "")
    .replace(EMOJI_RE, " ")
    .toUpperCase()
    .replace(PUNCT_RE, " ")
    // pontuação de borda (`.`, `,`) removida sem afetar interior
    .replace(/^[\s.,]+|[\s.,]+$/g, "")
    .replace(MULTI_SPACE_RE, " ")
    .trim();

  if (isQuestionMarkOnly) normalized = "?";

  return {
    originalText,
    normalizedText: normalized,
    isQuestionMarkOnly,
    isEmpty: normalized === "" && !isQuestionMarkOnly,
    wasTruncatedForComparison,
  };
}
