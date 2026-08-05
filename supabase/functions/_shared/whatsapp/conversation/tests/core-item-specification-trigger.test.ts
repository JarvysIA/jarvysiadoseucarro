// Build P0-3B-R (Passo B) — Cobertura da interceptação dos 2 gatilhos de
// especificação de item ("revisão"/"revisão preventiva" sozinha, "ar
// condicionado" sozinho) na detecção T1 de despesa (core.ts, chamada 4 de
// matchExpenseCategoria). Arquivo dedicado (em vez de estender
// core-expense-t1.test.ts) para isolar o risco desta mudança específica —
// a primeira vez que core.ts importa de expenses/semantics — sem misturar
// diffs com a cobertura já existente do fluxo T1 padrão.

import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type { ConversationCoreInput, ConversationState, ConversationVehicle } from "../types.ts";
import { EXPENSE_REPORTED_EVENT_KIND } from "../expense-create-protocol.ts";

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

  // NOTA: o PASSO 2.3.b pedia "deve continuar indo direto para
  // awaiting_expense_confirmation com categoria Manutenção" para este texto.
  // Verificado empiricamente (matchExpenseCategoria roda normalmente aqui,
  // já que recognizeExpenseSemantics devolve "resolved", não
  // "needs_item_specification" — o gatilho novo não intercepta) que o
  // parser LEGADO já considerava esse texto ambíguo ANTES desta mudança:
  // "revisao" bate em Revisão e "bateria" bate em Manutenção ao mesmo tempo,
  // então matchExpenseCategoria retorna { ok: false, code:
  // "ambiguous_categoria_candidate" } — comportamento pré-existente,
  // inalterado por este build (a chamada a matchExpenseCategoria e sua
  // lógica de branching não foram tocadas, só reordenadas para depois do
  // novo check). O teste abaixo reflete o resultado real, não o presumido.
  test("adjacência: 'revisão, troquei a bateria 300 reais' → motor não reconhece 'bateria' isoladamente, recognizeExpenseSemantics resolve Manutenção (resolved, não needs_item_specification), mas o parser LEGADO já achava esse texto ambíguo antes desta mudança → awaiting_expense_category (comportamento pré-existente, não uma regressão deste build)", () => {
    const d = decideConversation(
      inp({ originalText: "revisão, troquei a bateria 300 reais", vehicles: [veh(VEH_1)] }),
    );
    expect(d.nextState).toBe("awaiting_expense_category");
    expect(d.responseKey).toBe("expense_category_prompt");
    expect(d.responseParams.valor).toBe(300);
  });
});
