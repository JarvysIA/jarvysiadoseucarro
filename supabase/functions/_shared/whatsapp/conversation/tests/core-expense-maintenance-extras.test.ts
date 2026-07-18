// Build 4a/9 (item 6) — cobre a população dos novos campos aditivos
// recognizedTags/descricao(Preliminar) no draftPayload de despesa quando
// a categoria for Revisão/Manutenção. Não altera respostas visíveis.

import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type {
  ConversationCoreInput,
  ConversationState,
  ConversationVehicle,
} from "../types.ts";

const MSG_A = "11111111-1111-4111-8111-111111111111";
const MSG_B = "22222222-2222-4222-8222-222222222222";
const VEH_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const VEH_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";

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
  brand = "Fiat",
  model = "Argo",
  plate = "ABC1D23",
): ConversationVehicle {
  return {
    id,
    brand,
    model,
    plate,
    isArchived: false,
    isEligible: true,
    kmAtual: null,
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
    vehicles: [],
    fallbackCount: 0,
    isReplay: false,
    ...overrides,
  };
}

describe("Build 4a — extras de manutenção no draftPayload de despesa", () => {
  test("(1) Revisão + item + 1 veículo → recognizedTags=['pastilha'], descricao=texto", () => {
    const text = "Troquei a pastilha de freio, 220 reais";
    const d = decideConversation(inp({ originalText: text, vehicles: [veh(VEH_1)] }));
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    const p = d.statePatch.draftPayload as Record<string, unknown>;
    expect(p.categoria).toBe("Revisão");
    expect(p.recognizedTags).toEqual(["pastilha"]);
    expect(p.descricao).toBe(text);
  });

  test("(2) Manutenção sem item + texto curto → recognizedTags=[], descricao=null", () => {
    const d = decideConversation(
      inp({ originalText: "oficina 300", vehicles: [veh(VEH_1)] }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    const p = d.statePatch.draftPayload as Record<string, unknown>;
    expect(p.categoria).toBe("Manutenção");
    expect(p.recognizedTags).toEqual([]);
    expect(p.descricao).toBeNull();
  });

  test("(3) Combustível NUNCA recebe recognizedTags nem descricao", () => {
    const d = decideConversation(
      inp({ originalText: "Abasteci 100 de gasolina", vehicles: [veh(VEH_1)] }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    const p = d.statePatch.draftPayload as Record<string, unknown>;
    expect(p.categoria).toBe("Combustível");
    expect("recognizedTags" in p).toBe(false);
    expect("descricao" in p).toBe(false);
    expect("descricaoPreliminar" in p).toBe(false);
  });

  test("(4) Manutenção sem item mas texto longo → recognizedTags=[], descricao=texto", () => {
    const text = "Manutenção geral no carro todo, revisei tudo mesmo, 500 reais";
    const d = decideConversation(inp({ originalText: text, vehicles: [veh(VEH_1)] }));
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    const p = d.statePatch.draftPayload as Record<string, unknown>;
    expect(p.categoria).toBe("Manutenção");
    expect(p.recognizedTags).toEqual([]);
    expect(p.descricao).toBe(text);
  });

  test("(5) 2 veículos → awaiting_vehicle carrega recognizedTags/descricaoPreliminar; ao escolher, viram descricao", () => {
    const text = "Troquei o óleo e o filtro, 220 reais";
    const v1 = veh(VEH_1, "Fiat", "Argo", "ABC1D23");
    const v2 = veh(VEH_2, "VW", "Gol", "XYZ2E34");
    const d1 = decideConversation(inp({ originalText: text, vehicles: [v1, v2] }));
    expect(d1.nextState).toBe("awaiting_vehicle");
    const p1 = d1.statePatch.draftPayload as Record<string, unknown>;
    expect(p1.categoria).toBe("Revisão");
    expect(p1.recognizedTags).toEqual(["oleo"]);
    expect(p1.descricaoPreliminar).toBe(text);

    // Reply escolhendo o veículo
    const pendingState = state({
      state: "awaiting_vehicle",
      currentIntent: "expense",
      awaitingField: "vehicle",
      draftType: "expense",
      draftId: MSG_A,
      draftVersion: 0,
      draftPayload: p1 as unknown as ConversationState["draftPayload"],
    });
    const d2 = decideConversation(
      inp({
        state: pendingState,
        originalText: "argo",
        vehicles: [v1, v2],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d2.nextState).toBe("awaiting_expense_confirmation");
    const p2 = d2.statePatch.draftPayload as Record<string, unknown>;
    expect(p2.recognizedTags).toEqual(["oleo"]);
    expect(p2.descricao).toBe(text);
    // descricaoPreliminar não deve vazar pro payload de confirmação
    expect("descricaoPreliminar" in p2).toBe(false);
  });

  test("(6) responseKey/responseParams não mudam quando o extra é populado", () => {
    const d = decideConversation(
      inp({
        originalText: "Troquei a pastilha de freio, 220 reais",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(d.responseKey).toBe("expense_create_confirmation");
    // responseParams continua exatamente com as 3 chaves visíveis de sempre
    expect(Object.keys(d.responseParams).sort()).toEqual(
      ["categoria", "valor", "vehicleLabel"],
    );
    expect((d.responseParams as Record<string, unknown>).categoria).toBe("Revisão");
    expect((d.responseParams as Record<string, unknown>).valor).toBe(220);
    // Não vaza extras nos params visíveis
    expect("recognizedTags" in d.responseParams).toBe(false);
    expect("descricao" in d.responseParams).toBe(false);
  });

  test("(7) Regressão: fluxo de KM não recebe extras", () => {
    const d = decideConversation(
      inp({ originalText: "km 45000", vehicles: [veh(VEH_1)] }),
    );
    // T1 de KM produz draftType="km_update"
    expect(d.statePatch.draftType).toBe("km_update");
    const p = d.statePatch.draftPayload as Record<string, unknown>;
    expect("recognizedTags" in p).toBe(false);
    expect("descricao" in p).toBe(false);
    expect("descricaoPreliminar" in p).toBe(false);
  });
});
