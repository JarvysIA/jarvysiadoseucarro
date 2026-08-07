import { describe, expect, test } from "bun:test";
import { mapReceiptToExpenseDraft } from "../receipt-to-expense-draft.ts";
import type { ParsedReceipt } from "../parse-receipt.ts";
import {
  validateAwaitingConfirmationExpenseDraft,
  validateAwaitingVehicleExpenseDraft,
} from "../../conversation/expense-create-draft.ts";

const REQUEST_MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const VEHICLE_ID = "22222222-2222-4222-9222-222222222222";

function makeReceipt(overrides: Partial<ParsedReceipt> = {}): ParsedReceipt {
  return {
    data_servico: "2026-08-01",
    km_registrada: 45000,
    valor_total: 350.5,
    categoria: "Revisão",
    itens_identificados: [],
    ...overrides,
  };
}

describe("mapReceiptToExpenseDraft", () => {
  test("receipt válido, sem vehicleId no contexto → ok true, phase awaiting_vehicle, passa em validateAwaitingVehicleExpenseDraft", () => {
    const result = mapReceiptToExpenseDraft(makeReceipt(), {
      requestMessageId: REQUEST_MESSAGE_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toEqual({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 350.5,
      requestMessageId: REQUEST_MESSAGE_ID,
    });
    const validated = validateAwaitingVehicleExpenseDraft(result.draft);
    expect(validated.ok).toBe(true);
  });

  test("receipt válido, com vehicleId válido no contexto → ok true, phase awaiting_confirmation, vehicleId bate, passa em validateAwaitingConfirmationExpenseDraft", () => {
    const result = mapReceiptToExpenseDraft(makeReceipt(), {
      requestMessageId: REQUEST_MESSAGE_ID,
      vehicleId: VEHICLE_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toEqual({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 350.5,
      vehicleId: VEHICLE_ID,
      requestMessageId: REQUEST_MESSAGE_ID,
    });
    if (result.draft.phase === "awaiting_confirmation") {
      expect(result.draft.vehicleId).toBe(VEHICLE_ID);
    }
    const validated = validateAwaitingConfirmationExpenseDraft(result.draft);
    expect(validated.ok).toBe(true);
  });

  test("valor_total com ponto flutuante sujo (200 + 150.567 = 350.567) → arredonda para 350.57", () => {
    const result = mapReceiptToExpenseDraft(makeReceipt({ valor_total: 200 + 150.567 }), {
      requestMessageId: REQUEST_MESSAGE_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.valor).toBe(350.57);
  });

  test("valor_total <= 0 → ok false, reason invalid_valor", () => {
    const result = mapReceiptToExpenseDraft(makeReceipt({ valor_total: 0 }), {
      requestMessageId: REQUEST_MESSAGE_ID,
    });

    expect(result).toEqual({ ok: false, reason: "invalid_valor" });
  });

  test("valor_total NaN/Infinity → ok false, reason invalid_valor", () => {
    const resultNaN = mapReceiptToExpenseDraft(makeReceipt({ valor_total: NaN }), {
      requestMessageId: REQUEST_MESSAGE_ID,
    });
    const resultInfinity = mapReceiptToExpenseDraft(makeReceipt({ valor_total: Infinity }), {
      requestMessageId: REQUEST_MESSAGE_ID,
    });

    expect(resultNaN).toEqual({ ok: false, reason: "invalid_valor" });
    expect(resultInfinity).toEqual({ ok: false, reason: "invalid_valor" });
  });

  test("categoria fora de EXPENSE_CATEGORIES (defensivo, simulando escape do OCR-1) → ok false, reason invalid_categoria", () => {
    const result = mapReceiptToExpenseDraft(
      makeReceipt({ categoria: "Lixo" as ParsedReceipt["categoria"] }),
      { requestMessageId: REQUEST_MESSAGE_ID },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_categoria" });
  });

  test("requestMessageId que não é UUID válido → ok false, reason invalid_request_message_id", () => {
    const result = mapReceiptToExpenseDraft(makeReceipt(), {
      requestMessageId: "not-a-uuid",
    });

    expect(result).toEqual({ ok: false, reason: "invalid_request_message_id" });
  });

  test("vehicleId no contexto que não é UUID válido → tratado como ausente, cai em awaiting_vehicle", () => {
    const result = mapReceiptToExpenseDraft(makeReceipt(), {
      requestMessageId: REQUEST_MESSAGE_ID,
      vehicleId: "not-a-uuid",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.phase).toBe("awaiting_vehicle");
    const validated = validateAwaitingVehicleExpenseDraft(result.draft);
    expect(validated.ok).toBe(true);
  });
});
