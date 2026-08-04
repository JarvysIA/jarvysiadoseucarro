// Build corretivo item 6 (ponta solta 2) — reconhecimento amplo de recusa/
// adiamento em awaiting_requested_km. Testa regressão da lista antiga,
// novos padrões, número puro (caminho feliz) e fallback genérico.
import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type { ConversationCoreInput, ConversationState, ConversationVehicle } from "../types.ts";
import { KM_REPORTED_EVENT_KIND } from "../km-update-protocol.ts";

const MSG = "22222222-2222-4222-8222-222222222222";
const VEH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";

function baseState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    state: "awaiting_requested_km",
    currentIntent: "km_update",
    awaitingField: "requested_km",
    requestSource: "system",
    draftType: null,
    draftId: null,
    draftVersion: null,
    draftPayload: null,
    activeVehicleId: VEH,
    confirmedAt: null,
    executedAt: null,
    expiresAt: null,
    lastMessageId: null,
    ...overrides,
  };
}

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

function inp(originalText: string): ConversationCoreInput {
  return {
    sourceMessageId: MSG,
    messageType: "text",
    originalText,
    now: "2026-07-17T12:00:00.000Z",
    state: baseState(),
    vehicles: [veh()],
    fallbackCount: 0,
    isReplay: false,
  };
}

describe("awaiting_requested_km — regressão frases antigas", () => {
  const legacy = [
    "não sei",
    "não sei agora",
    "não lembro",
    "sei lá",
    "não anotei",
    "depois te falo",
    "mais tarde",
  ];
  for (const phrase of legacy) {
    test(`"${phrase}" → requested_km_unknown`, () => {
      const d = decideConversation(inp(phrase));
      expect(d.responseKey).toBe("requested_km_unknown");
      expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
      expect(d.nextState).toBe("idle");
      expect(d.outcome).toBe("cancelled");
    });
  }
});

describe("awaiting_requested_km — novos padrões amplos", () => {
  const novos = [
    "não faço ideia",
    "sem ideia nenhuma",
    "não conferi ainda",
    "ainda não medi",
    "depois eu confirmo",
    "já te aviso",
    "não verifiquei",
  ];
  for (const phrase of novos) {
    test(`"${phrase}" → requested_km_unknown`, () => {
      const d = decideConversation(inp(phrase));
      expect(d.responseKey).toBe("requested_km_unknown");
      expect(d.reasonCode).toBe("requested_km_declined_unknown");
      expect(d.nextState).toBe("idle");
    });
  }
});

describe("awaiting_requested_km — número puro continua funcionando", () => {
  test('"50000" → km_update_confirmation', () => {
    const d = decideConversation(inp("50000"));
    expect(d.responseKey).toBe("km_update_confirmation");
    expect(d.responseParams.newKm).toBe(50000);
  });
  test('"50.000 km" → km_update_confirmation', () => {
    const d = decideConversation(inp("50.000 km"));
    expect(d.responseKey).toBe("km_update_confirmation");
    expect(d.responseParams.newKm).toBe(50000);
  });
});

describe("awaiting_requested_km — fallback genérico permanece", () => {
  test('"oi, tudo bem?" → fallback, não requested_km_unknown', () => {
    const d = decideConversation(inp("oi, tudo bem?"));
    expect(d.responseKey).not.toBe("requested_km_unknown");
    expect(["fallback_first", "fallback_second", "fallback_reset"]).toContain(d.responseKey);
  });
});
