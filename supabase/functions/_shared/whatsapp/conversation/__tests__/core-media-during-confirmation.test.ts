import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type {
  ConversationCoreInput,
  ConversationState,
  ConversationStateName,
  ConversationMessageType,
  ConversationVehicle,
} from "../types.ts";

const FULL_VEHICLE: ConversationVehicle = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
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
    sourceMessageId: "msg-media-1",
    messageType: "image",
    originalText: null,
    now: "2026-07-18T12:00:00.000Z",
    state: state(),
    vehicles: [FULL_VEHICLE],
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

describe("core — media during confirmation nudge", () => {
  for (const s of CONFIRMATION_STATES) {
    test(`image during ${s} → nudge, state unchanged`, () => {
      const d = decideConversation(
        inp({ messageType: "image", state: state({ state: s }) }),
      );
      expect(d.decisionKind).toBe("respond");
      expect(d.eventKind).toBe("media");
      expect(d.responseKey).toBe("media_unclear_during_confirmation");
      expect(d.deferToLegacyRouter).toBe(false);
      expect(d.nextState).toBe(s);
      expect(d.statePatch.lastMessageId).toBe("msg-media-1");
      expect(d.nextFallbackCount).toBe(3);
      expect(d.reasonCode).toBe("media_during_confirmation_nudge");
    });
  }

  test("image at idle stays deferred to legacy (unchanged)", () => {
    const d = decideConversation(inp({ messageType: "image", state: state({ state: "idle" }) }));
    expect(d.decisionKind).toBe("defer_legacy_media");
    expect(d.deferToLegacyRouter).toBe(true);
    expect(d.responseKey).toBeNull();
    expect(d.statePatch.lastMessageId).toBeUndefined();
    expect(d.nextFallbackCount).toBe(3);
  });

  test("other media types (audio/pdf/video/file/document) during confirmation also nudge", () => {
    const types: ConversationMessageType[] = ["audio", "pdf", "video", "file", "document"];
    for (const mt of types) {
      const d = decideConversation(
        inp({ messageType: mt, state: state({ state: "awaiting_expense_confirmation" }) }),
      );
      expect(d.responseKey).toBe("media_unclear_during_confirmation");
      expect(d.decisionKind).toBe("respond");
      expect(d.deferToLegacyRouter).toBe(false);
    }
  });
});
