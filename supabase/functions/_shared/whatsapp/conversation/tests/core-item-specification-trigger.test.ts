// Build P0-3B-R (Passo B) — Cobertura da interceptação dos gatilhos de
// especificação de item ("revisão"/"revisão preventiva" sozinha, "ar
// condicionado" sozinho, "manutenção" sozinha) na detecção T1 de despesa
// (core.ts, chamada 4 de matchExpenseCategoria). Arquivo dedicado (em vez de
// estender core-expense-t1.test.ts) para isolar o risco desta mudança
// específica — a primeira vez que core.ts importa de expenses/semantics —
// sem misturar diffs com a cobertura já existente do fluxo T1 padrão.

import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type { ConversationCoreInput, ConversationState, ConversationVehicle } from "../types.ts";
import { EXPENSE_REPORTED_EVENT_KIND } from "../expense-create-protocol.ts";

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

function veh(id: string, brand = "Fiat", model = "Argo", plate = "ABC1D23"): ConversationVehicle {
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

describe("T1 despesa — gatilho de especificação de item (Passo B)", () => {
  test("'revisão 300 reais' → awaiting_item_specification, trigger revision_item_unspecified", () => {
    const d = decideConversation(
      inp({ originalText: "revisão 300 reais", vehicles: [veh(VEH_1)] }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("transition");
    expect(d.nextState).toBe("awaiting_item_specification");
    expect(d.responseKey).toBe("expense_item_specification_prompt");
    expect(d.statePatch.draftType).toBe("expense");
    expect(d.statePatch.draftVersion).toBe(0);
    expect(d.statePatch.draftId).toBe(MSG_A);
    expect(d.responseParams.valor).toBe(300);
    expect(d.responseParams.itemSpecificationTrigger).toBe("revision_item_unspecified");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.phase).toBe("awaiting_item_specification");
    expect(payload?.trigger).toBe("revision_item_unspecified");
    expect(payload?.fallbackCategory).toBe("Manutenção");
  });

  test("'ar condicionado 200 reais' → awaiting_item_specification, trigger ac_service_unspecified", () => {
    const d = decideConversation(
      inp({ originalText: "ar condicionado 200 reais", vehicles: [veh(VEH_1)] }),
    );
    expect(d.nextState).toBe("awaiting_item_specification");
    expect(d.responseKey).toBe("expense_item_specification_prompt");
    expect(d.responseParams.valor).toBe(200);
    expect(d.responseParams.itemSpecificationTrigger).toBe("ac_service_unspecified");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.trigger).toBe("ac_service_unspecified");
    expect(payload?.fallbackCategory).toBe("Manutenção");
  });

  test("regressão: 'pneu 160 reais' continua indo direto para awaiting_expense_confirmation", () => {
    const d = decideConversation(inp({ originalText: "pneu 160 reais", vehicles: [veh(VEH_1)] }));
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Manutenção");
    expect(d.responseParams.valor).toBe(160);
  });

  test("regressão: 'gasolina 80 reais' continua indo direto para awaiting_expense_confirmation", () => {
    const d = decideConversation(
      inp({ originalText: "gasolina 80 reais", vehicles: [veh(VEH_1)] }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Combustível");
    expect(d.responseParams.valor).toBe(80);
  });

  test("regressão: categoria genuinamente não reconhecida continua indo para awaiting_expense_category", () => {
    const d = decideConversation(inp({ originalText: "xyz 50 reais", vehicles: [veh(VEH_1)] }));
    expect(d.nextState).toBe("awaiting_expense_category");
    expect(d.responseKey).toBe("expense_category_prompt");
    expect(d.responseParams.valor).toBe(50);
  });

  test("adjacência: 'revisão, troquei o oleo 300 reais' → motor sempre vence dentro do reconhecedor novo (resolved, não needs_item_specification), segue direto para awaiting_expense_confirmation com Revisão", () => {
    const d = decideConversation(
      inp({ originalText: "revisão, troquei o oleo 300 reais", vehicles: [veh(VEH_1)] }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Revisão");
    expect(d.responseParams.valor).toBe(300);
  });

  // Atualizado no P0-3B-R (Passo D-2): antes desta troca, este texto ia para
  // awaiting_expense_category, porque a CHAMADA 4 ainda usava o parser
  // LEGADO, que achava "revisão, troquei a bateria" ambíguo (batia "revisao"
  // em Revisão E "bateria" em Manutenção ao mesmo tempo — uma falsa
  // ambiguidade exclusiva do vocabulário mais simples do legado). Com a
  // CHAMADA 4 usando recognizeExpenseSemantics (que já resolvia isso
  // corretamente como "resolved", Manutenção — motor não reconhece "bateria"
  // isoladamente, só o classificador não-motor reconhece, sem ambiguidade),
  // a falsa ambiguidade herdada do legado desaparece: vai direto para
  // awaiting_expense_confirmation.
  test("adjacência: 'revisão, troquei a bateria 300 reais' → motor não reconhece 'bateria' isoladamente, recognizeExpenseSemantics resolve Manutenção (resolved, não needs_item_specification) → awaiting_expense_confirmation direto (falsa ambiguidade do legado resolvida no Passo D-2)", () => {
    const d = decideConversation(
      inp({ originalText: "revisão, troquei a bateria 300 reais", vehicles: [veh(VEH_1)] }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Manutenção");
    expect(d.responseParams.valor).toBe(300);
  });
});

describe("T1 despesa — turno 2 de awaiting_item_specification (Passo C)", () => {
  function itemSpecState(overrides: Partial<ConversationState> = {}): ConversationState {
    return state({
      state: "awaiting_item_specification",
      currentIntent: "expense",
      awaitingField: "item_specification",
      draftType: "expense",
      draftId: MSG_A,
      draftVersion: 0,
      draftPayload: {
        phase: "awaiting_item_specification",
        valor: 300,
        requestMessageId: MSG_A,
        trigger: "revision_item_unspecified",
        fallbackCategory: "Manutenção",
      },
      ...overrides,
    });
  }

  test("a) responde 'óleo' → awaiting_expense_confirmation, categoria Revisão, valor preservado", () => {
    const d = decideConversation(
      inp({
        state: itemSpecState(),
        originalText: "óleo",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.eventKind).toBe("category_reply");
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Revisão");
    expect(d.responseParams.valor).toBe(300);
    expect(d.statePatch.draftVersion).toBe(1);
    expect(d.statePatch.draftId).toBe(MSG_A);
    expect(d.statePatch.activeVehicleId).toBe(VEH_1);
  });

  test("b) responde 'sei lá' → awaiting_expense_confirmation, categoria Manutenção (fallback), sem repetir a pergunta", () => {
    const d = decideConversation(
      inp({
        state: itemSpecState(),
        originalText: "sei lá",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Manutenção");
    expect(d.responseParams.valor).toBe(300);
  });

  test("c) responde 'banana' (lixo genuinamente aleatório) → mesmo resultado de (b), sem distinção", () => {
    const d = decideConversation(
      inp({
        state: itemSpecState(),
        originalText: "banana",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Manutenção");
    expect(d.responseParams.valor).toBe(300);
  });

  test("d) gatilho ac_service_unspecified, responde 'conserto' → categoria Manutenção (fallback, 'conserto' não é conceito de motor)", () => {
    const d = decideConversation(
      inp({
        state: itemSpecState({
          draftPayload: {
            phase: "awaiting_item_specification",
            valor: 200,
            requestMessageId: MSG_A,
            trigger: "ac_service_unspecified",
            fallbackCategory: "Manutenção",
          },
        }),
        originalText: "conserto",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseParams.categoria).toBe("Manutenção");
    expect(d.responseParams.valor).toBe(200);
  });

  test("e) gatilho ac_service_unspecified, responde 'filtro do ar condicionado' → categoria Revisão (reconhece cabin_filter)", () => {
    const d = decideConversation(
      inp({
        state: itemSpecState({
          draftPayload: {
            phase: "awaiting_item_specification",
            valor: 200,
            requestMessageId: MSG_A,
            trigger: "ac_service_unspecified",
            fallbackCategory: "Manutenção",
          },
        }),
        originalText: "filtro do ar condicionado",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseParams.categoria).toBe("Revisão");
    expect(d.responseParams.valor).toBe(200);
  });

  test("f) mídia durante awaiting_item_specification → media_unclear_during_confirmation, mantém o estado", () => {
    const d = decideConversation(
      inp({
        state: itemSpecState(),
        messageType: "image",
        originalText: null,
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.responseKey).toBe("media_unclear_during_confirmation");
    expect(d.nextState).toBe("awaiting_item_specification");
    expect(d.decisionKind).toBe("respond");
  });

  test("g) 2+ veículos elegíveis, activeVehicleId null → awaiting_vehicle em vez de awaiting_expense_confirmation", () => {
    const d = decideConversation(
      inp({
        state: itemSpecState({ activeVehicleId: null }),
        originalText: "óleo",
        vehicles: [veh(VEH_1), veh(VEH_2, "VW", "Gol", "XYZ2E34")],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_vehicle");
    expect(d.responseKey).toBe("vehicle_ambiguous");
    expect(d.statePatch.draftType).toBe("expense");
    expect(d.statePatch.draftVersion).toBe(1);
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.phase).toBe("awaiting_vehicle");
    expect(payload?.categoria).toBe("Revisão");
  });
});

describe("T1 despesa — gatilho maintenance_unspecified (3º gatilho)", () => {
  test("a) turno 1: 'manutenção 800 reais' → awaiting_item_specification, trigger maintenance_unspecified", () => {
    const d = decideConversation(
      inp({ originalText: "manutenção 800 reais", vehicles: [veh(VEH_1)] }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_item_specification");
    expect(d.responseKey).toBe("expense_item_specification_prompt");
    expect(d.responseParams.valor).toBe(800);
    expect(d.responseParams.itemSpecificationTrigger).toBe("maintenance_unspecified");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.trigger).toBe("maintenance_unspecified");
    expect(payload?.fallbackCategory).toBe("Manutenção");
  });

  function maintenanceItemSpecState(overrides: Partial<ConversationState> = {}): ConversationState {
    return state({
      state: "awaiting_item_specification",
      currentIntent: "expense",
      awaitingField: "item_specification",
      draftType: "expense",
      draftId: MSG_A,
      draftVersion: 0,
      draftPayload: {
        phase: "awaiting_item_specification",
        valor: 800,
        requestMessageId: MSG_A,
        trigger: "maintenance_unspecified",
        fallbackCategory: "Manutenção",
      },
      ...overrides,
    });
  }

  test("b) turno 2: responde 'óleo' → awaiting_expense_confirmation, categoria Revisão", () => {
    const d = decideConversation(
      inp({
        state: maintenanceItemSpecState(),
        originalText: "óleo",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Revisão");
    expect(d.responseParams.valor).toBe(800);
  });

  test("c) turno 2: responde 'só um reparo mesmo' (sem termo de motor) → awaiting_expense_confirmation, categoria Manutenção (fallback)", () => {
    const d = decideConversation(
      inp({
        state: maintenanceItemSpecState(),
        originalText: "só um reparo mesmo",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Manutenção");
    expect(d.responseParams.valor).toBe(800);
  });
});

// Passo D-3 (P0-3B-R): CHAMADA 1 (awaiting_expense_category) agora também
// intercepta needs_item_specification, transicionando para
// awaiting_item_specification — mesma lacuna de precisão que motiva o
// gatilho em T1 (chamada 4) se aplica igualmente quando o usuário responde
// "revisão"/"ar condicionado"/"manutenção" à pergunta de categoria. Fricção
// extra (3 perguntas em vez de 2 neste caminho específico) é uma escolha de
// produto consciente.
describe("awaiting_expense_category — gatilho de especificação de item (Passo D-3)", () => {
  const MSG_C = "33333333-3333-4333-8333-333333333333";

  test("a) fluxo completo de 3 turnos: '800 reais' → awaiting_expense_category → 'revisão' → awaiting_item_specification → 'óleo' → awaiting_expense_confirmation (Revisão)", () => {
    const t1 = decideConversation(inp({ originalText: "800 reais", vehicles: [veh(VEH_1)] }));
    expect(t1.nextState).toBe("awaiting_expense_category");
    expect(t1.responseKey).toBe("expense_category_prompt");

    const categoryState = state({
      state: "awaiting_expense_category",
      currentIntent: "expense",
      awaitingField: "categoria",
      draftType: "expense",
      draftId: t1.statePatch.draftId as string,
      draftVersion: t1.statePatch.draftVersion as number,
      draftPayload: t1.statePatch.draftPayload as Record<string, unknown>,
    });

    const t2 = decideConversation(
      inp({
        state: categoryState,
        originalText: "revisão",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(t2.nextState).toBe("awaiting_item_specification");
    expect(t2.responseKey).toBe("expense_item_specification_prompt");
    expect(t2.responseParams.itemSpecificationTrigger).toBe("revision_item_unspecified");
    expect(t2.responseParams.valor).toBe(800);

    const itemSpecState = state({
      state: "awaiting_item_specification",
      currentIntent: "expense",
      awaitingField: "item_specification",
      draftType: "expense",
      draftId: t2.statePatch.draftId as string,
      draftVersion: t2.statePatch.draftVersion as number,
      draftPayload: t2.statePatch.draftPayload as Record<string, unknown>,
    });

    const t3 = decideConversation(
      inp({
        state: itemSpecState,
        originalText: "óleo",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_C,
      }),
    );
    expect(t3.nextState).toBe("awaiting_expense_confirmation");
    expect(t3.responseKey).toBe("expense_create_confirmation");
    expect(t3.responseParams.categoria).toBe("Revisão");
    expect(t3.responseParams.valor).toBe(800);
  });

  test("b) não-regressão: 2ª resposta 'gasolina' (categoria clara) segue direto para awaiting_expense_confirmation, sem passar por awaiting_item_specification", () => {
    const t1 = decideConversation(inp({ originalText: "800 reais", vehicles: [veh(VEH_1)] }));
    expect(t1.nextState).toBe("awaiting_expense_category");

    const categoryState = state({
      state: "awaiting_expense_category",
      currentIntent: "expense",
      awaitingField: "categoria",
      draftType: "expense",
      draftId: t1.statePatch.draftId as string,
      draftVersion: t1.statePatch.draftVersion as number,
      draftPayload: t1.statePatch.draftPayload as Record<string, unknown>,
    });

    const t2 = decideConversation(
      inp({
        state: categoryState,
        originalText: "gasolina",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(t2.nextState).toBe("awaiting_expense_confirmation");
    expect(t2.responseKey).toBe("expense_create_confirmation");
    expect(t2.responseParams.categoria).toBe("Combustível");
    expect(t2.responseParams.valor).toBe(800);
  });

  test("c) não-regressão: 2ª resposta 'xyz' (não reconhecida) continua repetindo a pergunta de categoria, sem contar fallback", () => {
    const t1 = decideConversation(inp({ originalText: "800 reais", vehicles: [veh(VEH_1)] }));
    expect(t1.nextState).toBe("awaiting_expense_category");

    const categoryState = state({
      state: "awaiting_expense_category",
      currentIntent: "expense",
      awaitingField: "categoria",
      draftType: "expense",
      draftId: t1.statePatch.draftId as string,
      draftVersion: t1.statePatch.draftVersion as number,
      draftPayload: t1.statePatch.draftPayload as Record<string, unknown>,
    });

    const t2 = decideConversation(
      inp({
        state: categoryState,
        originalText: "xyz",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(t2.nextState).toBe("awaiting_expense_category");
    expect(t2.responseKey).toBe("expense_category_prompt");
    expect(t2.responseParams.valor).toBe(800);
    expect(t2.nextFallbackCount).toBe(0);
  });
});
