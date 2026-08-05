// Build 4b/9 complemento — testa o TEXTO renderizado (decideConversation + renderResponse)
// para os cenários de manutenção/revisão via WhatsApp.

import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import { renderResponse } from "../responses.ts";
import type { ConversationCoreInput, ConversationState, ConversationVehicle } from "../types.ts";

const MSG_A = "11111111-1111-4111-8111-111111111111";
const MSG_B = "22222222-2222-4222-8222-222222222222";
const MSG_C = "33333333-3333-4333-8333-333333333333";
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

function renderFrom(input: ConversationCoreInput): {
  text: string;
  decision: ReturnType<typeof decideConversation>;
} {
  const d = decideConversation(input);
  const text = renderResponse(d.responseKey, d.responseParams);
  return { text, decision: d };
}

const FILTER_QUESTION = "Qual filtro foi trocado (ar, cabine ou combustível)?";
const DESCRIPTION_INVITE = "Se quiser contar mais sobre o que foi feito, pode falar 🙂";

describe("Build 4b — texto renderizado final para despesa de manutenção/revisão", () => {
  test("(1) pastilha reconhecida → texto contém (pastilha)", () => {
    const { text } = renderFrom(
      inp({
        originalText: "Troquei a pastilha de freio, 220 reais",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(text).toContain("(pastilha)");
    expect(text).not.toContain(FILTER_QUESTION);
    expect(text).not.toContain(DESCRIPTION_INVITE);
  });

  test("(2) óleo + filtro → texto contém (óleo)", () => {
    const { text } = renderFrom(
      inp({
        originalText: "Troquei o óleo e o filtro, 220 reais",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(text).toContain("(óleo)");
  });

  test("(3) sem item + texto curto → convite de descrição no final", () => {
    const { text } = renderFrom(
      inp({
        originalText: "oficina 300",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(text.endsWith(DESCRIPTION_INVITE)).toBe(true);
  });

  test("(4) sem item + texto longo → sem convite de descrição", () => {
    const { text } = renderFrom(
      inp({
        originalText: "Manutenção geral no carro todo, revisei tudo mesmo, 500 reais",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(text).not.toContain(DESCRIPTION_INVITE);
  });

  // Atualizado no P0-3B-R: "manutenção" bare agora é um gatilho de
  // especificação de item — corrige um bug real do sistema legado, que
  // perguntava "qual filtro" mas NUNCA usava a resposta para reclassificar a
  // categoria (ficava Manutenção mesmo se o item fosse do motor
  // determinístico, ex.: filtro de ar/cabine). Com o fluxo novo, se o turno 2
  // reconhecer um item de motor, a despesa é corretamente promovida a
  // Revisão.
  test("(5) 'manutenção, troquei o filtro' → needs_item_specification (não mais pergunta de filtro do legado)", () => {
    const { text, decision } = renderFrom(
      inp({
        originalText: "Manutenção, troquei o filtro, 30 reais",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(decision.nextState).toBe("awaiting_item_specification");
    expect(decision.responseKey).toBe("expense_item_specification_prompt");
    expect(decision.responseParams.itemSpecificationTrigger).toBe("maintenance_unspecified");
    expect(text).not.toContain(FILTER_QUESTION);
  });

  // Fluxo completo de 2 turnos para este mesmo texto, provando a correção:
  // turno 2 reconhecendo "filtro de ar" (engine_air_filter) promove a
  // categoria para Revisão, em vez de ficar presa em Manutenção como o
  // legado fazia.
  test("(5b) turno 2 de 'manutenção, troquei o filtro' — responde 'filtro de ar' → promovido a Revisão", () => {
    const t1 = decideConversation(
      inp({ originalText: "Manutenção, troquei o filtro, 30 reais", vehicles: [veh(VEH_1)] }),
    );
    const t2 = decideConversation(
      inp({
        state: state({
          state: "awaiting_item_specification",
          currentIntent: "expense",
          awaitingField: "item_specification",
          draftType: "expense",
          draftId: t1.statePatch.draftId as string,
          draftVersion: t1.statePatch.draftVersion as number,
          draftPayload: t1.statePatch.draftPayload as Record<string, unknown>,
        }),
        originalText: "filtro de ar",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(t2.nextState).toBe("awaiting_expense_confirmation");
    expect(t2.responseKey).toBe("expense_create_confirmation");
    expect(t2.responseParams.categoria).toBe("Revisão");
    expect(t2.responseParams.valor).toBe(30);
  });

  test("(6) pastilha + filtro ambíguo → contém (pastilha) E pergunta do filtro", () => {
    const { text } = renderFrom(
      inp({
        originalText: "troquei a pastilha e o filtro, 220 reais",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(text).toContain("(pastilha)");
    expect(text.endsWith(FILTER_QUESTION)).toBe(true);
  });

  test("(7) Combustível → formato antigo, sem parênteses/convite/pergunta", () => {
    const { text } = renderFrom(
      inp({
        originalText: "Abasteci 100 de gasolina",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(text).not.toContain("(");
    expect(text).not.toContain(DESCRIPTION_INVITE);
    expect(text).not.toContain(FILTER_QUESTION);
    expect(text).toContain("R$ 100,00");
    expect(text).toContain("Combustível");
  });

  test("(8) 2 veículos + item conhecido → após escolher o carro, texto ainda contém o item", () => {
    const v1 = veh(VEH_1, "Fiat", "Argo", "ABC1D23");
    const v2 = veh(VEH_2, "VW", "Gol", "XYZ2E34");
    const text0 = "Troquei o óleo e o filtro, 220 reais";
    const d1 = decideConversation(
      inp({
        originalText: text0,
        vehicles: [v1, v2],
      }),
    );
    expect(d1.nextState).toBe("awaiting_vehicle");

    const pendingState = state({
      state: "awaiting_vehicle",
      currentIntent: "expense",
      awaitingField: "vehicle",
      draftType: "expense",
      draftId: MSG_A,
      draftVersion: 0,
      draftPayload: d1.statePatch.draftPayload as ConversationState["draftPayload"],
    });
    const { text } = renderFrom(
      inp({
        state: pendingState,
        originalText: "argo",
        vehicles: [v1, v2],
        sourceMessageId: MSG_B,
      }),
    );
    expect(text).toContain("(óleo)");
  });

  test("(9) fluxo completo: 'Filtro 26,90' → responde 'Manutenção' → texto final tem pergunta do filtro", () => {
    const v1 = veh(VEH_1);
    const d1 = decideConversation(
      inp({
        originalText: "Filtro 26,90",
        vehicles: [v1],
      }),
    );
    // categoria desconhecida → pergunta de categoria
    expect(d1.nextState).toBe("awaiting_expense_category");

    const pendingState = state({
      state: "awaiting_expense_category",
      currentIntent: "expense",
      awaitingField: "category",
      draftType: "expense",
      draftId: MSG_A,
      draftVersion: 0,
      draftPayload: d1.statePatch.draftPayload as ConversationState["draftPayload"],
      activeVehicleId: VEH_1,
    });

    const { text, decision } = renderFrom(
      inp({
        state: pendingState,
        originalText: "Manutenção",
        vehicles: [v1],
        sourceMessageId: MSG_C,
      }),
    );
    expect(decision.nextState).toBe("awaiting_expense_confirmation");
    expect(text.endsWith(FILTER_QUESTION)).toBe(true);
  });
});
