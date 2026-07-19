// Build 6a/9 do item 6 — linkedExpenseId propaga do draftId da conversa
// (posto lá por buildExpenseFinalization) para o draft de km_update.

import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type {
  ConversationCoreInput,
  ConversationState,
  ConversationVehicle,
} from "../types.ts";

const MSG = "22222222-2222-4222-8222-222222222222";
const VEH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const DESP = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";

function veh(kmAtual: number | null = 30000): ConversationVehicle {
  return {
    id: VEH,
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

function state(draftId: string | null): ConversationState {
  return {
    state: "awaiting_requested_km",
    currentIntent: "km_update",
    awaitingField: "requested_km",
    requestSource: "system",
    draftType: null,
    draftId,
    draftVersion: 0,
    draftPayload: null,
    activeVehicleId: VEH,
    confirmedAt: null,
    executedAt: null,
    expiresAt: null,
    lastMessageId: null,
  };
}

function inp(draftId: string | null, text = "45000"): ConversationCoreInput {
  return {
    sourceMessageId: MSG,
    messageType: "text",
    originalText: text,
    now: "2026-07-17T12:00:00.000Z",
    state: state(draftId),
    vehicles: [veh()],
    fallbackCount: 0,
    isReplay: false,
  };
}

describe("core — linkedExpenseId no draft de km (build 6a/9)", () => {
  test("draftId = uuid da despesa → draft final leva linkedExpenseId", () => {
    const d = decideConversation(inp(DESP));
    expect(d.nextState).toBe("awaiting_km_confirmation");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.linkedExpenseId).toBe(DESP);
  });

  test("draftId = null → draft final NÃO carrega linkedExpenseId", () => {
    const d = decideConversation(inp(null));
    expect(d.nextState).toBe("awaiting_km_confirmation");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(payload!, "linkedExpenseId"))
      .toBe(false);
  });

  test("draftId não-uuid → draft final NÃO carrega linkedExpenseId", () => {
    const d = decideConversation(inp("not-a-uuid"));
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(Object.prototype.hasOwnProperty.call(payload!, "linkedExpenseId"))
      .toBe(false);
  });
});
