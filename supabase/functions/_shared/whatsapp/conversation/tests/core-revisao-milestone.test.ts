// Build corretivo 6/6 — "revisão dos 40 mil" NÃO vira valor nem km.
import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type {
  ConversationCoreInput,
  ConversationState,
  ConversationVehicle,
} from "../types.ts";
import { EXPENSE_REPORTED_EVENT_KIND } from "../expense-create-protocol.ts";
import { KM_REPORTED_EVENT_KIND } from "../km-update-protocol.ts";

const MSG = "11111111-1111-4111-8111-111111111111";
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

function veh(): ConversationVehicle {
  return {
    id: VEH_1,
    brand: "Fiat",
    model: "Argo",
    plate: "ABC1D23",
    isArchived: false,
    isEligible: true,
    kmAtual: null,
    whatsappAccessMode: "full",
    optionalLabel: null,
  };
}

function inp(overrides: Partial<ConversationCoreInput> = {}): ConversationCoreInput {
  return {
    sourceMessageId: MSG,
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

describe("revisão N mil — não vira despesa nem km", () => {
  const cases = [
    "fiz a revisao dos 40 mil",
    "revisao dos 40 mil",
    "fiz a revisao de 40 mil km",
    "revisao dos 40 mil, troquei oleo e filtro",
    "revisao de 90 mil",
    "revisao dos 200 mil km",
  ];
  for (const text of cases) {
    test(`"${text}" → fallback`, () => {
      const d = decideConversation(inp({ originalText: text }));
      expect(d.eventKind).not.toBe(EXPENSE_REPORTED_EVENT_KIND);
      expect(d.eventKind).not.toBe(KM_REPORTED_EVENT_KIND);
      expect(d.nextState).not.toBe("awaiting_expense_confirmation");
      expect(d.nextState).not.toBe("awaiting_expense_category");
      expect(d.nextState).not.toBe("awaiting_km_confirmation");
    });
  }
});

describe("revisão COM valor real declarado — despesa funciona", () => {
  test("revisao dos 40 mil, gastei 350 reais → Revisão R$350", () => {
    const d = decideConversation(
      inp({ originalText: "revisao dos 40 mil, gastei 350 reais" }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.responseParams.valor).toBe(350);
    expect(d.responseParams.categoria).toBe("Revisão");
  });
  test("fiz a revisao dos 40 mil, foi 500 reais → Revisão R$500", () => {
    const d = decideConversation(
      inp({ originalText: "fiz a revisao dos 40 mil, foi 500 reais" }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.responseParams.valor).toBe(500);
    expect(d.responseParams.categoria).toBe("Revisão");
  });
});

describe("km genuína com 'mil' — sem 'revisao' — não regride", () => {
  test("carro esta com 105 mil km → km 105000", () => {
    const d = decideConversation(inp({ originalText: "carro esta com 105 mil km" }));
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
  });
  test("rodei 40 mil essa semana → km 40000", () => {
    const d = decideConversation(inp({ originalText: "rodei 40 mil essa semana" }));
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
  });
  test("hoje bateu 40 mil no carro → km 40000", () => {
    const d = decideConversation(inp({ originalText: "hoje bateu 40 mil no carro" }));
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
  });
});

describe("revisão sem 'N mil' — não regride", () => {
  test("fiz a revisao, gastei 350 reais → Revisão R$350", () => {
    const d = decideConversation(
      inp({ originalText: "fiz a revisao, gastei 350 reais" }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.responseParams.valor).toBe(350);
    expect(d.responseParams.categoria).toBe("Revisão");
  });
  test("revisao completa → fallback", () => {
    const d = decideConversation(inp({ originalText: "revisao completa" }));
    expect(d.eventKind).not.toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.eventKind).not.toBe(KM_REPORTED_EVENT_KIND);
  });
});

describe("regressão geral — builds anteriores", () => {
  test("Troca de óleo R$190,00 com 105.000km → Revisão R$190", () => {
    const d = decideConversation(
      inp({ originalText: "Troca de óleo R$190,00 com 105.000km" }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.responseParams.valor).toBe(190);
    expect(d.responseParams.categoria).toBe("Revisão");
  });
  test("oficina 300 → Manutenção R$300", () => {
    const d = decideConversation(inp({ originalText: "oficina 300" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.responseParams.valor).toBe(300);
    expect(d.responseParams.categoria).toBe("Manutenção");
  });
  test("óleo 220 → Revisão R$220", () => {
    const d = decideConversation(inp({ originalText: "óleo 220" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.responseParams.valor).toBe(220);
    expect(d.responseParams.categoria).toBe("Revisão");
  });
  test("rodei 105000 km hoje → km 105000", () => {
    const d = decideConversation(inp({ originalText: "rodei 105000 km hoje" }));
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
  });
});
