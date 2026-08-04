// Build 5.7F2E1C.T2 — reconhecimento de confirmacao/negacao KM no core.
// Verifica handoff CONFIRM_KM_UPDATE_HANDOFF_KIND (nada e' executado ainda)
// e reset_task determinístico para "não".

import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type { ConversationCoreInput, ConversationState, ConversationVehicle } from "../types.ts";
import { KM_UPDATE_INITIAL_DRAFT_VERSION } from "../km-update-draft.ts";
import { CONFIRM_KM_UPDATE_HANDOFF_KIND } from "../km-update-protocol.ts";

const MSG_UUID_A = "11111111-1111-4111-8111-111111111111";
const MSG_UUID_B = "22222222-2222-4222-8222-222222222222";
const VEH_UUID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";

function state(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    state: "idle",
    currentIntent: null,
    awaitingField: null,
    requestSource: null,
    draftType: null,
    draftId: null,
    draftVersion: null,
    draftPayload: null,
    activeVehicleId: null,
    confirmedAt: null,
    executedAt: null,
    expiresAt: null,
    lastMessageId: null,
    ...overrides,
  };
}

function veh(
  id: string,
  brand: string,
  model: string,
  plate: string,
  kmAtual: number | null = null,
): ConversationVehicle {
  return {
    id,
    brand,
    model,
    plate,
    isArchived: false,
    isEligible: true,
    kmAtual,
    whatsappAccessMode: "full",
    optionalLabel: null,
  };
}

function inp(overrides: Partial<ConversationCoreInput> = {}): ConversationCoreInput {
  return {
    sourceMessageId: MSG_UUID_B,
    messageType: "text",
    originalText: "",
    now: "2026-07-11T12:00:00.000Z",
    state: state(),
    vehicles: [],
    fallbackCount: 0,
    isReplay: false,
    ...overrides,
  };
}

function validKmState(over: Partial<ConversationState> = {}): ConversationState {
  return state({
    state: "awaiting_km_confirmation",
    currentIntent: "km_update",
    awaitingField: "confirmation",
    draftType: "km_update",
    draftId: MSG_UUID_A,
    draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
    draftPayload: {
      phase: "awaiting_confirmation",
      vehicleId: VEH_UUID_1,
      expectedPreviousKm: 1000,
      newKm: 2000,
      requestMessageId: MSG_UUID_A,
      isCorrection: false,
    },
    activeVehicleId: VEH_UUID_1,
    ...over,
  });
}

describe("core T2 — handoff de confirmacao KM", () => {
  test("confirm em awaiting_km_confirmation com draft valido → handoff", () => {
    const d = decideConversation(
      inp({
        originalText: "sim",
        state: validKmState(),
        vehicles: [veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 1000)],
      }),
    );
    expect(d.decisionKind).toBe(CONFIRM_KM_UPDATE_HANDOFF_KIND);
    expect(d.eventKind).toBe("confirm");
    expect(d.nextState).toBe("awaiting_km_confirmation");
    expect(d.outcome).toBe("none");
    expect(d.responseKey).toBeNull();
    expect(d.reasonCode).toBe("km_update_confirmed_handoff");
    // Draft preservado (ausencia = manter).
    expect(d.statePatch.state).toBeUndefined();
    expect(d.statePatch.draftId).toBeUndefined();
    expect(d.statePatch.draftType).toBeUndefined();
    expect(d.statePatch.draftPayload).toBeUndefined();
    expect(d.statePatch.lastMessageId).toBe(MSG_UUID_B);
  });

  test("confirm em awaiting_km_correction com draft valido → handoff (reasonCode correction)", () => {
    const payload = {
      phase: "awaiting_confirmation",
      vehicleId: VEH_UUID_1,
      expectedPreviousKm: 20000,
      newKm: 15000,
      requestMessageId: MSG_UUID_A,
      isCorrection: true,
    };
    const d = decideConversation(
      inp({
        originalText: "sim",
        state: validKmState({
          state: "awaiting_km_correction",
          draftPayload: payload,
        }),
        vehicles: [veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 20000)],
      }),
    );
    expect(d.decisionKind).toBe(CONFIRM_KM_UPDATE_HANDOFF_KIND);
    expect(d.eventKind).toBe("confirm");
    expect(d.nextState).toBe("awaiting_km_correction");
    expect(d.reasonCode).toBe("km_update_correction_confirmed_handoff");
    expect(d.responseKey).toBeNull();
    expect(d.statePatch.state).toBeUndefined();
    expect(d.statePatch.draftPayload).toBeUndefined();
  });
});

describe("core T2 — deny em states KM", () => {
  test("deny em awaiting_km_confirmation → reset_task + task_cancelled", () => {
    const d = decideConversation(
      inp({
        originalText: "não",
        state: validKmState(),
        vehicles: [veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 1000)],
      }),
    );
    expect(d.decisionKind).toBe("reset_task");
    expect(d.eventKind).toBe("deny");
    expect(d.nextState).toBe("idle");
    expect(d.outcome).toBe("cancelled");
    expect(d.responseKey).toBe("task_cancelled");
    expect(d.reasonCode).toBe("km_update_denied");
    expect(d.statePatch.state).toBe("idle");
    expect(d.statePatch.draftType).toBeNull();
    expect(d.statePatch.draftId).toBeNull();
    expect(d.statePatch.draftPayload).toBeNull();
    expect(d.statePatch.lastMessageId).toBe(MSG_UUID_B);
  });

  test("deny em awaiting_km_correction → reset_task + reasonCode correction_denied", () => {
    const d = decideConversation(
      inp({
        originalText: "não",
        state: validKmState({
          state: "awaiting_km_correction",
          draftPayload: {
            phase: "awaiting_confirmation",
            vehicleId: VEH_UUID_1,
            expectedPreviousKm: 20000,
            newKm: 15000,
            requestMessageId: MSG_UUID_A,
            isCorrection: true,
          },
        }),
        vehicles: [veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 20000)],
      }),
    );
    expect(d.decisionKind).toBe("reset_task");
    expect(d.eventKind).toBe("deny");
    expect(d.nextState).toBe("idle");
    expect(d.outcome).toBe("cancelled");
    expect(d.responseKey).toBe("task_cancelled");
    expect(d.reasonCode).toBe("km_update_correction_denied");
    expect(d.statePatch.state).toBe("idle");
    expect(d.statePatch.draftType).toBeNull();
    expect(d.statePatch.draftId).toBeNull();
    expect(d.statePatch.draftPayload).toBeNull();
  });
});

describe("core T2 — defesa contra drafts invalidos", () => {
  test("confirm com draftPayload malformado (newKm negativo) → nothing_to_confirm", () => {
    const bad = validKmState({
      draftPayload: {
        phase: "awaiting_confirmation",
        vehicleId: VEH_UUID_1,
        expectedPreviousKm: 1000,
        newKm: -5, // invalido
        requestMessageId: MSG_UUID_A,
        isCorrection: false,
      },
    });
    const d = decideConversation(
      inp({
        originalText: "sim",
        state: bad,
        vehicles: [veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 1000)],
      }),
    );
    expect(d.decisionKind).toBe("respond");
    expect(d.responseKey).toBe("nothing_to_confirm");
    expect(d.eventKind).toBe("confirm");
  });

  test("confirm em awaiting_km_confirmation com draftType null → nothing_to_confirm", () => {
    const bad = validKmState({
      draftType: null,
      draftPayload: null,
      draftId: null,
    });
    const d = decideConversation(
      inp({
        originalText: "sim",
        state: bad,
        vehicles: [veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 1000)],
      }),
    );
    expect(d.decisionKind).toBe("respond");
    expect(d.responseKey).toBe("nothing_to_confirm");
  });

  test("confirm em state idle sem pendencia → nothing_to_confirm (regressao)", () => {
    const d = decideConversation(inp({ originalText: "sim", state: state() }));
    expect(d.decisionKind).toBe("respond");
    expect(d.responseKey).toBe("nothing_to_confirm");
    expect(d.eventKind).toBe("confirm");
  });
});
