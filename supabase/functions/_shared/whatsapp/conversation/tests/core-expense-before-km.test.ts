// Build corretivo 5/6 — despesa reconhecida ANTES de KM quando as duas
// aparecem na mesma mensagem. Troca de ordem, sem mudança de lógica interna.

import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type {
  ConversationCoreInput,
  ConversationState,
  ConversationVehicle,
} from "../types.ts";
import { EXPENSE_REPORTED_EVENT_KIND } from "../expense-create-protocol.ts";
import { KM_REPORTED_EVENT_KIND } from "../km-update-protocol.ts";

const MSG_A = "11111111-1111-4111-8111-111111111111";
const VEH_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";

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

function veh(id = VEH_1): ConversationVehicle {
  return {
    id,
    brand: "Fiat",
    model: "Argo",
    plate: "ABC1D23",
    isArchived: false,
    isEligible: true,
    kmAtual: 100000,
    whatsappAccessMode: "full",
    optionalLabel: null,
  };
}

function inp(overrides: Partial<ConversationCoreInput> = {}): ConversationCoreInput {
  return {
    sourceMessageId: MSG_A,
    messageType: "text",
    originalText: "",
    now: "2026-07-17T12:00:00.000Z",
    state: state(),
    vehicles: [veh()],
    fallbackCount: 0,
    isReplay: false,
    ...overrides,
  };
}

describe("despesa + km ao mesmo tempo → reconhece despesa primeiro", () => {
  const cases = [
    { text: "Troca de óleo R$190,00 com 105.000km", categoria: "Revisão", valor: 190 },
    { text: "105.000km, troca de óleo R$190,00", categoria: "Revisão", valor: 190 },
    {
      text: "troquei o oleo do carro hoje ficou 190 reais e ta rodando com 105 mil km",
      categoria: "Revisão",
      valor: 190,
    },
    { text: "Troquei a pastilha de freio R$190,00 105000km", categoria: "Revisão", valor: 190 },
  ];

  for (const c of cases) {
    test(`"${c.text}" → despesa ${c.categoria} R$${c.valor}`, () => {
      const d = decideConversation(inp({ originalText: c.text }));
      expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
      expect(d.decisionKind).toBe("transition");
      expect(d.nextState).toBe("awaiting_expense_confirmation");
      expect(d.responseParams.valor).toBe(c.valor);
      expect(d.responseParams.categoria).toBe(c.categoria);
    });
  }
});

describe("km pura não regrede", () => {
  const cases = [
    "rodei 105000 km hoje",
    "km atual 105000",
    "carro ta com 105 mil km",
  ];
  for (const text of cases) {
    test(`"${text}" → reconhece KM`, () => {
      const d = decideConversation(inp({ originalText: text }));
      expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
      expect(d.nextState).toBe("awaiting_km_confirmation");
      expect(d.responseParams.newKm).toBe(105000);
    });
  }
});

describe("despesa pura não regrede", () => {
  test('"gastei 190 reais no posto" → Combustível R$190', () => {
    const d = decideConversation(inp({ originalText: "gastei 190 reais no posto" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseParams.valor).toBe(190);
    expect(d.responseParams.categoria).toBe("Combustível");
  });

  test('"oficina 300" → Manutenção R$300', () => {
    const d = decideConversation(inp({ originalText: "oficina 300" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseParams.valor).toBe(300);
    expect(d.responseParams.categoria).toBe("Manutenção");
  });

  test('"óleo 220" → Revisão R$220', () => {
    const d = decideConversation(inp({ originalText: "óleo 220" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseParams.valor).toBe(220);
    expect(d.responseParams.categoria).toBe("Revisão");
  });
});
