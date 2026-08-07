// Enriquece o rascunho de despesa (saída do Build OCR-2) com
// reconhecimento de item de manutenção, reaproveitando o parser de texto
// já existente (parseMaintenanceItemsText) — sem criar nenhum
// reconhecedor novo, sem duplicar a lógica do parser. Função pura, sem
// I/O, sem Supabase.

import type { ParsedReceipt } from "./parse-receipt.ts";
import { parseMaintenanceItemsText } from "../conversation/expense-maintenance-items-parser.ts";
import type {
  AwaitingVehicleExpenseDraft,
  AwaitingConfirmationExpenseDraft,
} from "../conversation/expense-create-draft.ts";

const DESCRICAO_MAX_CHARS = 500; // mesmo limite de expense-create-draft.ts

export type EnrichableExpenseDraft = AwaitingVehicleExpenseDraft | AwaitingConfirmationExpenseDraft;

function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const sliced = text.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(" ");
  // Sem espaço no trecho cortado (uma única "palavra" gigante): não há
  // como cortar num limite de palavra, cai pro corte bruto mesmo.
  return lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
}

export function enrichExpenseDraftWithMaintenanceItems(
  receipt: ParsedReceipt,
  draft: EnrichableExpenseDraft,
): EnrichableExpenseDraft {
  if (draft.categoria !== "Revisão" && draft.categoria !== "Manutenção") {
    return draft;
  }

  const descricoes = receipt.itens_identificados.map((item) => item.descricao);
  const textoConcatenado = descricoes.join(" ");
  const parseResult = parseMaintenanceItemsText(textoConcatenado);

  if (parseResult.items.length === 0 && !parseResult.ambiguousFilterMention) {
    return draft;
  }

  const recognizedTags = parseResult.items.map((item) => item.tag);

  const resumo = descricoes.join(", ") || "Item(ns) de manutenção não especificado(s)";

  // Defensivo: com no máximo 4 tags, tagsSuffix nunca chega perto de
  // DESCRICAO_MAX_CHARS (o pior caso — " [oleo] [filtro] [pastilha]
  // [arrefecimento]" — tem ~43 caracteres). Teoricamente impossível de
  // disparar hoje; mantido como salvaguarda caso o parser ganhe mais tags.
  const tagsSuffix =
    parseResult.tagsSuffix.length >= DESCRICAO_MAX_CHARS
      ? parseResult.tagsSuffix.slice(0, DESCRICAO_MAX_CHARS)
      : parseResult.tagsSuffix;

  const maxResumoLen = Math.max(0, DESCRICAO_MAX_CHARS - tagsSuffix.length);
  const resumoTruncado = truncateAtWordBoundary(resumo, maxResumoLen);
  const descricaoFinal = resumoTruncado + tagsSuffix;

  if (draft.phase === "awaiting_vehicle") {
    return {
      ...draft,
      recognizedTags,
      descricaoPreliminar: descricaoFinal,
      ambiguousFilterMention: parseResult.ambiguousFilterMention,
    };
  }

  return {
    ...draft,
    recognizedTags,
    descricao: descricaoFinal,
    ambiguousFilterMention: parseResult.ambiguousFilterMention,
  };
}
