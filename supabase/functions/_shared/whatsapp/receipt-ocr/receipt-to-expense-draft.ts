// Mapeia o resultado do OCR de nota fiscal (Build OCR-1, ParsedReceipt)
// para o formato real de rascunho de despesa (ExpenseCreateDraft). Sem
// reconhecimento de item (recognizedTags/descricaoPreliminar/descricao) —
// isso é OCR-3. Sem wiring com WhatsApp real — função pura, sem I/O.

import type { ParsedReceipt } from "./parse-receipt.ts";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type AwaitingVehicleExpenseDraft,
  type AwaitingConfirmationExpenseDraft,
} from "../conversation/expense-create-draft.ts";

export type ReceiptToExpenseDraftContext = {
  requestMessageId: string;
  vehicleId?: string;
};

export type ReceiptToExpenseDraftReason =
  | "invalid_categoria"
  | "invalid_valor"
  | "invalid_request_message_id";

export type ReceiptToExpenseDraftResult =
  | { ok: true; draft: AwaitingVehicleExpenseDraft | AwaitingConfirmationExpenseDraft }
  | { ok: false; reason: ReceiptToExpenseDraftReason };

const EXPENSE_MAX_VALOR = 999999999.99;

// Cópia deliberada da UUID_REGEX de expense-create-draft.ts — esse módulo
// não exporta a função de validação, e importar uma regex privada de outro
// arquivo criaria acoplamento estrutural desnecessário para uma constante
// tão pequena.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

const EXPENSE_CATEGORIES_SET: ReadonlySet<string> = new Set(EXPENSE_CATEGORIES);

function isValidExpenseCategoria(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && EXPENSE_CATEGORIES_SET.has(value);
}

export function mapReceiptToExpenseDraft(
  receipt: ParsedReceipt,
  context: ReceiptToExpenseDraftContext,
): ReceiptToExpenseDraftResult {
  if (!isValidUuid(context.requestMessageId)) {
    return { ok: false, reason: "invalid_request_message_id" };
  }

  if (!isValidExpenseCategoria(receipt.categoria)) {
    return { ok: false, reason: "invalid_categoria" };
  }
  const categoria = receipt.categoria;

  const valor = Math.round(receipt.valor_total * 100) / 100;
  if (!Number.isFinite(valor) || valor <= 0 || valor > EXPENSE_MAX_VALOR) {
    return { ok: false, reason: "invalid_valor" };
  }

  // Um context.vehicleId presente porém malformado é tratado como ausente
  // (cai em "awaiting_vehicle"), não como erro: ReceiptToExpenseDraftReason
  // não tem um código "invalid_vehicle_id" (de propósito — só os 3 motivos
  // acima existem), e o fluxo já pede o veículo ao usuário nessa fase, o
  // que é a recuperação natural para um vehicleId que não deveria ter
  // chegado aqui malformado.
  if (context.vehicleId !== undefined && isValidUuid(context.vehicleId)) {
    return {
      ok: true,
      draft: {
        phase: "awaiting_confirmation",
        categoria,
        valor,
        vehicleId: context.vehicleId,
        requestMessageId: context.requestMessageId,
      },
    };
  }

  return {
    ok: true,
    draft: {
      phase: "awaiting_vehicle",
      categoria,
      valor,
      requestMessageId: context.requestMessageId,
    },
  };
}
