import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type {
  ConversationCoreInput,
  ConversationState,
  ConversationStateName,
  ConversationVehicle,
} from "../types.ts";

const FULL_VEHICLE: ConversationVehicle = {
  id: "aaaaaaaa-1111-4222-8333-555555555555",
  brand: "Fiat",
  model: "Argo",
  plate: "ABC1D23",
  isArchived: false,
  isEligible: true,
  kmAtual: 10000,
  whatsappAccessMode: "full",
  optionalLabel: null,
};

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

function inp(overrides: Partial<ConversationCoreInput> = {}): ConversationCoreInput {
  return {
    sourceMessageId: "msg-unknown-1",
    messageType: "unknown",
    originalText: null,
    now: "2026-07-18T12:00:00.000Z",
    state: state(),
    vehicles: [],
    fallbackCount: 3,
    isReplay: false,
    ...overrides,
  };
}

const CONFIRMATION_STATES: ConversationStateName[] = [
  "awaiting_km_confirmation",
  "awaiting_km_correction",
  "awaiting_expense_confirmation",
  "awaiting_expense_correction",
];

describe("core — unknown (no text) during confirmation nudge", () => {
  for (const s of CONFIRMATION_STATES) {
    test(`unknown + null text during ${s} → nudge, state unchanged`, () => {
      const d = decideConversation(inp({ messageType: "unknown", state: state({ state: s }) }));
      expect(d.decisionKind).toBe("respond");
      expect(d.eventKind).toBe("media");
      expect(d.responseKey).toBe("media_unclear_during_confirmation");
      expect(d.deferToLegacyRouter).toBe(false);
      expect(d.nextState).toBe(s);
      expect(d.statePatch.lastMessageId).toBe("msg-unknown-1");
      expect(d.nextFallbackCount).toBe(3);
      expect(d.reasonCode).toBe("unknown_notext_during_confirmation_nudge");
    });
  }

  for (const s of CONFIRMATION_STATES) {
    test(`unknown + empty text during ${s} → nudge, state unchanged`, () => {
      const d = decideConversation(
        inp({ messageType: "unknown", originalText: "", state: state({ state: s }) }),
      );
      expect(d.decisionKind).toBe("respond");
      expect(d.eventKind).toBe("media");
      expect(d.responseKey).toBe("media_unclear_during_confirmation");
      expect(d.deferToLegacyRouter).toBe(false);
      expect(d.nextState).toBe(s);
      expect(d.statePatch.lastMessageId).toBe("msg-unknown-1");
      expect(d.nextFallbackCount).toBe(3);
      expect(d.reasonCode).toBe("unknown_notext_during_confirmation_nudge");
    });
  }

  test("unknown + null text at idle → unchanged fallback behavior", () => {
    const d = decideConversation(
      inp({
        messageType: "unknown",
        originalText: null,
        state: state({ state: "idle" }),
        fallbackCount: 0,
      }),
    );
    expect(d.decisionKind).toBe("fallback");
    expect(d.eventKind).toBe("unknown");
    expect(d.responseKey).toBe("fallback_first");
    expect(d.nextState).toBe("idle");
    expect(d.nextFallbackCount).toBe(1);
    expect(d.reasonCode).toBe("fallback_attempt_1");
  });

  test("unknown + text 'sim' during awaiting_expense_confirmation → confirm, not nudge", () => {
    const d = decideConversation(
      inp({
        sourceMessageId: "aaaaaaaa-1111-4222-8333-444444444444",
        messageType: "unknown",
        originalText: "sim",
        state: state({
          state: "awaiting_expense_confirmation",
          draftType: "expense",
          draftId: "aaaaaaaa-1111-4222-8333-444444444444",
          draftVersion: 2,
          draftPayload: {
            phase: "awaiting_confirmation",
            vehicleId: "aaaaaaaa-1111-4222-8333-555555555555",
            valor: 150,
            categoria: "Combustível",
            requestMessageId: "aaaaaaaa-1111-4222-8333-444444444444",
          },
        }),
        vehicles: [FULL_VEHICLE],
      }),
    );
    expect(d.decisionKind).toBe("confirm_expense_create");
    expect(d.eventKind).toBe("confirm");
    expect(d.responseKey).toBeNull();
    expect(d.deferToLegacyRouter).toBe(false);
    expect(d.nextState).toBe("awaiting_expense_confirmation");
  });

  test("image during awaiting_expense_confirmation still nudges (no regression)", () => {
    const d = decideConversation(
      inp({
        messageType: "image",
        state: state({ state: "awaiting_expense_confirmation" }),
        vehicles: [FULL_VEHICLE],
      }),
    );
    expect(d.decisionKind).toBe("respond");
    expect(d.eventKind).toBe("media");
    expect(d.responseKey).toBe("media_unclear_during_confirmation");
    expect(d.deferToLegacyRouter).toBe(false);
    expect(d.nextState).toBe("awaiting_expense_confirmation");
  });
});
