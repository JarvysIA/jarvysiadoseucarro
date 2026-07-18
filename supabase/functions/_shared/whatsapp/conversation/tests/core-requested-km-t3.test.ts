// Build 5.7F2E1A.5-MJ3 — Cobertura do gatilho de KM pós-despesa.
// State awaiting_requested_km + reply numérica → cria draft e transiciona a
// awaiting_km_confirmation (ou awaiting_km_correction quando newKm < kmAtual).

import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type {
  ConversationCoreInput,
  ConversationState,
  ConversationVehicle,
} from "../types.ts";
import { KM_REPORTED_EVENT_KIND } from "../km-update-protocol.ts";
import { KM_UPDATE_INITIAL_DRAFT_VERSION } from "../km-update-draft.ts";

const MSG_A = "11111111-1111-4111-8111-111111111111";
const MSG_B = "22222222-2222-4222-8222-222222222222";
const VEH_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const VEH_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";

function baseState(overrides: Partial<ConversationState> = {}): ConversationState {
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
  kmAtual: number | null = null,
  overrides: Partial<ConversationVehicle> = {},
): ConversationVehicle {
  return {
    id,
    brand: "Fiat",
    model: "Argo",
    plate: "ABC1D23",
    isArchived: false,
    isEligible: true,
    kmAtual,
    whatsappAccessMode: "full",
    optionalLabel: null,
    ...overrides,
  };
}

function inp(overrides: Partial<ConversationCoreInput> = {}): ConversationCoreInput {
  return {
    sourceMessageId: MSG_B,
    messageType: "text",
    originalText: "",
    now: "2026-07-17T12:00:00.000Z",
    state: baseState(),
    vehicles: [],
    fallbackCount: 0,
    isReplay: false,
    ...overrides,
  };
}

function requestedKmState(activeVehicleId: string | null): ConversationState {
  return baseState({
    state: "awaiting_requested_km",
    currentIntent: "km_update",
    awaitingField: "requested_km",
    requestSource: "system",
    activeVehicleId,
  });
}

describe("awaiting_requested_km — reply parsing", () => {
  test("KM > kmAtual → awaiting_km_confirmation com draft v0 novo", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "45000",
        vehicles: [veh(VEH_1, 30000)],
      }),
    );
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("transition");
    expect(d.nextState).toBe("awaiting_km_confirmation");
    expect(d.responseKey).toBe("km_update_confirmation");
    expect(d.responseParams.newKm).toBe(45000);
    expect(d.responseParams.previousKm).toBe(30000);
    expect(d.statePatch.draftType).toBe("km_update");
    expect(d.statePatch.draftId).toBe(MSG_B);
    expect(d.statePatch.draftVersion).toBe(KM_UPDATE_INITIAL_DRAFT_VERSION);
    expect(d.statePatch.activeVehicleId).toBe(VEH_1);
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.phase).toBe("awaiting_confirmation");
    expect(payload?.vehicleId).toBe(VEH_1);
    expect(payload?.newKm).toBe(45000);
    expect(payload?.expectedPreviousKm).toBe(30000);
    expect(payload?.isCorrection).toBe(false);
    expect(payload?.requestMessageId).toBe(MSG_B);
  });

  test("KM < kmAtual → awaiting_km_correction com isCorrection true", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "20000",
        vehicles: [veh(VEH_1, 30000)],
      }),
    );
    expect(d.nextState).toBe("awaiting_km_correction");
    expect(d.responseKey).toBe("km_update_correction_confirmation");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.isCorrection).toBe(true);
    expect(payload?.newKm).toBe(20000);
  });

  test("kmAtual null → não é correção; awaiting_km_confirmation", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "10000",
        vehicles: [veh(VEH_1, null)],
      }),
    );
    expect(d.nextState).toBe("awaiting_km_confirmation");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.isCorrection).toBe(false);
    expect(payload?.expectedPreviousKm).toBeNull();
  });

  test("KM igual ao kmAtual → não é correção; awaiting_km_confirmation", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "30000",
        vehicles: [veh(VEH_1, 30000)],
      }),
    );
    expect(d.nextState).toBe("awaiting_km_confirmation");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.isCorrection).toBe(false);
  });

  test("veículo ativo arquivado → no_eligible_vehicle e limpa estado", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "45000",
        vehicles: [veh(VEH_1, 30000, { isArchived: true })],
      }),
    );
    expect(d.decisionKind).toBe("respond");
    expect(d.nextState).toBe("idle");
    expect(d.responseKey).toBe("no_eligible_vehicle");
    expect(d.statePatch.currentIntent).toBeNull();
    expect(d.statePatch.awaitingField).toBeNull();
  });

  test("activeVehicleId não bate com nenhum veículo → no_eligible_vehicle", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "45000",
        vehicles: [veh(VEH_2, 30000)],
      }),
    );
    expect(d.responseKey).toBe("no_eligible_vehicle");
    expect(d.nextState).toBe("idle");
  });

  test("activeVehicleId null → no_eligible_vehicle", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(null),
        originalText: "45000",
        vehicles: [veh(VEH_1, 30000)],
      }),
    );
    expect(d.responseKey).toBe("no_eligible_vehicle");
  });

  test("parse falho (texto sem número) → fallback, NÃO transiciona a KM", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "não sei",
        vehicles: [veh(VEH_1, 30000)],
      }),
    );
    expect(d.nextState).not.toBe("awaiting_km_confirmation");
    expect(d.nextState).not.toBe("awaiting_km_correction");
    expect(d.eventKind).not.toBe(KM_REPORTED_EVENT_KIND);
  });

  test("cancelar em awaiting_requested_km → reset_task", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "cancelar",
        vehicles: [veh(VEH_1, 30000)],
      }),
    );
    expect(d.decisionKind).toBe("reset_task");
    expect(d.nextState).toBe("idle");
});

describe("core — awaiting_requested_km + 'não sei' (HARD4)", () => {
  const unknownPhrases = [
    "não sei",
    "não lembro",
    "depois te falo",
    "sei lá",
    "mais tarde",
    "NÃO SEI AGORA",
    "não me lembro",
    "não anotei",
  ];

  for (const phrase of unknownPhrases) {
    test(`"${phrase}" → responde requested_km_unknown e volta pra idle`, () => {
      const d = decideConversation(
        inp({
          state: requestedKmState(VEH_1),
          originalText: phrase,
          vehicles: [veh(VEH_1, 30000)],
        }),
      );
      expect(d.decisionKind).toBe("respond");
      expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
      expect(d.responseKey).toBe("requested_km_unknown");
      expect(d.nextState).toBe("idle");
      expect(d.outcome).toBe("cancelled");
      expect(d.nextFallbackCount).toBe(0);
      expect(d.statePatch.state).toBe("idle");
      expect(d.statePatch.draftId).toBeNull();
      expect(d.statePatch.currentIntent).toBeNull();
      expect(d.statePatch.lastMessageId).toBe(MSG_B);
    });
  }

  test("km numérica válida continua funcionando (caminho feliz)", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "47560",
        vehicles: [veh(VEH_1, 30000)],
      }),
    );
    expect(d.decisionKind).toBe("transition");
    expect(d.nextState).toBe("awaiting_km_confirmation");
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
    expect(d.statePatch.draftVersion).toBe(KM_UPDATE_INITIAL_DRAFT_VERSION);
  });

  test("texto incompreensível continua caindo em fallback", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "xyz123abc",
        vehicles: [veh(VEH_1, 30000)],
      }),
    );
    expect(d.responseKey).not.toBe("requested_km_unknown");
    // fallback genérico da seção 10
    expect(["fallback_first", "fallback_second", "fallback_reset"]).toContain(
      d.responseKey,
    );
  });

  test("'cancelar' continua caindo em cancel_task (seção 5)", () => {
    const d = decideConversation(
      inp({
        state: requestedKmState(VEH_1),
        originalText: "cancelar",
        vehicles: [veh(VEH_1, 30000)],
      }),
    );
    expect(d.decisionKind).toBe("reset_task");
    expect(d.responseKey).toBe("task_cancelled");
  });
});

