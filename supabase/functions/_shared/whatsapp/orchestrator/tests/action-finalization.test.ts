// OCR-KM-2 — testes de buildExpenseFinalization (action-finalization.ts).
// Runner: bun test. Sem rede, sem banco, sem Supabase.

import { describe, expect, test } from "bun:test";
import { buildExpenseFinalization } from "../action-finalization.ts";
import type { LoadContextResult } from "../types.ts";
import type { ConversationState, ConversationVehicle } from "../../conversation/types.ts";
import type { ConfirmedExpenseCreateResult } from "../../actions/expense-types.ts";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const DESP_ID = "22222222-2222-4222-8222-222222222222";
const CONFIRMATION_MSG_ID = "33333333-3333-4333-8333-333333333333";

function makeState(over: Partial<ConversationState> = {}): ConversationState {
  return {
    state: "awaiting_expense_confirmation",
    currentIntent: "expense",
    awaitingField: "confirmation",
    requestSource: null,
    draftType: "expense",
    draftId: "44444444-4444-4444-8444-444444444444",
    draftVersion: 0,
    draftPayload: null,
    activeVehicleId: VEHICLE_ID,
    confirmedAt: null,
    executedAt: null,
    expiresAt: null,
    lastMessageId: null,
    ...over,
  };
}

function makeVehicle(kmAtual: number | null): ConversationVehicle {
  return {
    id: VEHICLE_ID,
    brand: "Fiat",
    model: "Argo",
    plate: "ABC1D23",
    isArchived: false,
    isEligible: true,
    kmAtual,
    whatsappAccessMode: "full",
    optionalLabel: null,
  };
}

function makeContext(kmAtual: number | null): Extract<LoadContextResult, { kind: "ok" }> {
  return {
    kind: "ok",
    context: {
      state: makeState(),
      fallbackCount: 0,
      stateVersion: 0,
      vehicles: [makeVehicle(kmAtual)],
      conversationStateId: "cs-1",
    },
    activeVehicleIssue: null,
  };
}

function completedResult(
  over: Partial<ConfirmedExpenseCreateResult> = {},
): ConfirmedExpenseCreateResult {
  return {
    kind: "completed",
    actionExecutionId: "exec-1",
    despesaId: DESP_ID,
    valor: 149.9,
    categoria: "Combustível",
    ...over,
  } as ConfirmedExpenseCreateResult;
}

describe("buildExpenseFinalization — OCR-KM-2 (kmRegistrada pula awaiting_requested_km)", () => {
  test("a) kmRegistrada válido, sem correção (newKm >= kmAtual) → awaiting_km_confirmation", () => {
    const ctx = makeContext(40000);
    const fin = buildExpenseFinalization(
      completedResult(),
      ctx,
      VEHICLE_ID,
      45000,
      CONFIRMATION_MSG_ID,
    );
    expect(fin.kind).toBe("finalize");
    if (fin.kind !== "finalize") return;
    expect(fin.decision.nextState).toBe("awaiting_km_confirmation");
    expect(fin.decision.responseKey).toBe("expense_create_completed_with_km_confirmation");
    expect(fin.decision.responseParams.newKm).toBe(45000);
    expect(fin.decision.responseParams.previousKm).toBe(40000);
    expect(fin.decision.responseParams.valor).toBe(149.9);
    expect(fin.decision.responseParams.categoria).toBe("Combustível");
    expect(fin.decision.reasonCode).toBe("expense_action_completed_with_km_confirmation_skip");
    const patch = fin.decision.statePatch;
    expect(patch.state).toBe("awaiting_km_confirmation");
    expect(patch.currentIntent).toBe("km_update");
    expect(patch.awaitingField).toBe("confirmation");
    expect(patch.draftType).toBe("km_update");
    expect(patch.draftId).toBe(CONFIRMATION_MSG_ID);
    expect(patch.draftVersion).toBe(0);
    const payload = patch.draftPayload as Record<string, unknown>;
    expect(payload.phase).toBe("awaiting_confirmation");
    expect(payload.vehicleId).toBe(VEHICLE_ID);
    expect(payload.expectedPreviousKm).toBe(40000);
    expect(payload.newKm).toBe(45000);
    expect(payload.requestMessageId).toBe(CONFIRMATION_MSG_ID);
    expect(payload.isCorrection).toBe(false);
    expect(payload.linkedExpenseId).toBe(DESP_ID);
  });

  test("b) kmRegistrada válido, com correção (newKm < kmAtual) → awaiting_km_correction", () => {
    const ctx = makeContext(50000);
    const fin = buildExpenseFinalization(
      completedResult(),
      ctx,
      VEHICLE_ID,
      45000,
      CONFIRMATION_MSG_ID,
    );
    expect(fin.kind).toBe("finalize");
    if (fin.kind !== "finalize") return;
    expect(fin.decision.nextState).toBe("awaiting_km_correction");
    const patch = fin.decision.statePatch;
    expect(patch.state).toBe("awaiting_km_correction");
    const payload = patch.draftPayload as Record<string, unknown>;
    expect(payload.isCorrection).toBe(true);
    expect(payload.expectedPreviousKm).toBe(50000);
    expect(payload.newKm).toBe(45000);
  });

  test("c) kmRegistrada válido mas confirmationMessageId ausente → comportamento IDÊNTICO ao atual (awaiting_requested_km)", () => {
    const ctx = makeContext(40000);
    const fin = buildExpenseFinalization(completedResult(), ctx, VEHICLE_ID, 45000, undefined);
    expect(fin.kind).toBe("finalize");
    if (fin.kind !== "finalize") return;
    expect(fin.decision.nextState).toBe("awaiting_requested_km");
    expect(fin.decision.responseKey).toBe("expense_create_completed_with_km_prompt");
    const patch = fin.decision.statePatch;
    expect(patch.state).toBe("awaiting_requested_km");
    expect(patch.draftType).toBeNull();
    expect(patch.draftId).toBe(DESP_ID);
  });

  test("d) kmRegistrada null → comportamento IDÊNTICO ao atual (awaiting_requested_km)", () => {
    const ctx = makeContext(40000);
    const fin = buildExpenseFinalization(
      completedResult(),
      ctx,
      VEHICLE_ID,
      null,
      CONFIRMATION_MSG_ID,
    );
    expect(fin.kind).toBe("finalize");
    if (fin.kind !== "finalize") return;
    expect(fin.decision.nextState).toBe("awaiting_requested_km");
    expect(fin.decision.responseKey).toBe("expense_create_completed_with_km_prompt");
  });

  test("d2) kmRegistrada ausente (chamada sem o parâmetro) → comportamento IDÊNTICO ao atual", () => {
    const ctx = makeContext(40000);
    const fin = buildExpenseFinalization(completedResult(), ctx, VEHICLE_ID);
    expect(fin.kind).toBe("finalize");
    if (fin.kind !== "finalize") return;
    expect(fin.decision.nextState).toBe("awaiting_requested_km");
    expect(fin.decision.responseKey).toBe("expense_create_completed_with_km_prompt");
  });

  test("e) veículo sem kmAtual (null) → expectedPreviousKm null, isCorrection false, ainda vai pro awaiting_km_confirmation", () => {
    const ctx = makeContext(null);
    const fin = buildExpenseFinalization(
      completedResult(),
      ctx,
      VEHICLE_ID,
      45000,
      CONFIRMATION_MSG_ID,
    );
    expect(fin.kind).toBe("finalize");
    if (fin.kind !== "finalize") return;
    expect(fin.decision.nextState).toBe("awaiting_km_confirmation");
    const payload = fin.decision.statePatch.draftPayload as Record<string, unknown>;
    expect(payload.expectedPreviousKm).toBeNull();
    expect(payload.isCorrection).toBe(false);
    expect(fin.decision.responseParams.previousKm).toBeNull();
  });

  test("replayed se comporta igual a completed (mesmo caminho de km)", () => {
    const ctx = makeContext(40000);
    const fin = buildExpenseFinalization(
      completedResult({ kind: "replayed" } as Partial<ConfirmedExpenseCreateResult>),
      ctx,
      VEHICLE_ID,
      45000,
      CONFIRMATION_MSG_ID,
    );
    expect(fin.kind).toBe("finalize");
    if (fin.kind !== "finalize") return;
    expect(fin.decision.nextState).toBe("awaiting_km_confirmation");
    expect(fin.decision.reasonCode).toBe("expense_action_replayed_with_km_confirmation_skip");
  });
});
