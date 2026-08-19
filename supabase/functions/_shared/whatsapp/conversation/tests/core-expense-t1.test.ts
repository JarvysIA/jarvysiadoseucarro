// Build expense-create-core-wiring — Cobertura T1 de despesa no core.
// Alvo: decideConversation. Verifica draft direto e drafts parciais
// (awaiting_category e awaiting_vehicle), promoção de versão, correção de
// categoria em confirmação, handoff CONFIRM_EXPENSE_CREATE, e regressão do
// fluxo de KM (que continua com prioridade).

import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type { ConversationCoreInput, ConversationState, ConversationVehicle } from "../types.ts";
import {
  CONFIRM_EXPENSE_CREATE_HANDOFF_KIND,
  EXPENSE_REPORTED_EVENT_KIND,
} from "../expense-create-protocol.ts";
import { KM_REPORTED_EVENT_KIND } from "../km-update-protocol.ts";

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

// ---------------------------------------------------------------------------
// A) Detecção em idle
// ---------------------------------------------------------------------------

describe("T1 despesa — draft direto em idle", () => {
  test("valor + categoria + 1 veículo elegível → awaiting_expense_confirmation v0", () => {
    const v = veh(VEH_1);
    const d = decideConversation(inp({ originalText: "gasolina R$ 80", vehicles: [v] }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("transition");
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.statePatch.draftType).toBe("expense");
    expect(d.statePatch.draftVersion).toBe(0);
    expect(d.statePatch.draftId).toBe(MSG_A);
    expect(d.statePatch.activeVehicleId).toBe(VEH_1);
    expect(d.responseParams.valor).toBe(80);
    expect(d.responseParams.categoria).toBe("Combustível");
    expect(d.responseParams.vehicleLabel).toBeDefined();
  });

  test("valor + categoria + 2+ veículos → awaiting_vehicle v0 draftType expense", () => {
    const d = decideConversation(
      inp({
        originalText: "gasolina R$ 80",
        vehicles: [veh(VEH_1, "Fiat", "Argo", "ABC1D23"), veh(VEH_2, "VW", "Gol", "XYZ2E34")],
      }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_vehicle");
    expect(d.responseKey).toBe("vehicle_ambiguous");
    expect(d.statePatch.draftType).toBe("expense");
    expect(d.statePatch.draftVersion).toBe(0);
  });

  // Atualizado no P0-3B-R (Passo D-2): "botão de vidro" deixou de servir como
  // exemplo de "categoria não reconhecida" — está no dicionário do
  // reconhecedor novo (CATEGORY_KEYWORDS.Manutenção) desde um build anterior,
  // então com a CHAMADA 4 usando o sistema novo ele passa a resolver direto.
  // Trocado por "coxim do motor" (peça automotiva real e plausível — coxim
  // do motor é o suporte de borracha/metal que fixa o motor ao chassi) —
  // confirmado empiricamente que NEM o parser legado NEM o reconhecedor novo
  // têm esse termo em nenhum dicionário, preservando o propósito original do
  // teste (provar que "categoria genuinamente desconhecida" ainda cai em
  // awaiting_expense_category com a pergunta genérica).
  test("valor sem categoria reconhecida → awaiting_expense_category v0", () => {
    const d = decideConversation(
      inp({ originalText: "coxim do motor 30,00", vehicles: [veh(VEH_1)] }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_expense_category");
    expect(d.responseKey).toBe("expense_category_prompt");
    expect(d.statePatch.draftType).toBe("expense");
    expect(d.statePatch.draftVersion).toBe(0);
    expect(d.responseParams.valor).toBe(30);
    // Atualizado: expense_category_prompt virou uma pergunta aberta ("essa
    // despesa foi o quê?"), sem lista fechada de 8 categorias — options não
    // é mais lido pelo texto renderizado (ver responses.ts), e core.ts não
    // passa mais esse campo em responseParams para este responseKey.
    expect(d.responseParams.options).toBeUndefined();
  });

  test("valor reconhecido + 0 veículos → no_eligible_vehicle, sem draft", () => {
    const d = decideConversation(inp({ originalText: "gasolina R$ 80", vehicles: [] }));
    expect(d.responseKey).toBe("no_eligible_vehicle");
    expect(d.decisionKind).toBe("respond");
    expect(d.statePatch.draftType ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B) Resposta em awaiting_expense_category
// ---------------------------------------------------------------------------

describe("T1 despesa — resposta em awaiting_expense_category", () => {
  const catState = state({
    state: "awaiting_expense_category",
    currentIntent: "expense",
    awaitingField: "categoria",
    draftType: "expense",
    draftId: MSG_A,
    draftVersion: 0,
    draftPayload: {
      phase: "awaiting_category",
      valor: 80,
      requestMessageId: MSG_A,
    },
  });

  test("categoria reconhecida + 1 veículo → awaiting_expense_confirmation v1", () => {
    const d = decideConversation(
      inp({
        state: catState,
        originalText: "gasolina",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.eventKind).toBe("category_reply");
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.statePatch.draftVersion).toBe(1);
    expect(d.statePatch.draftId).toBe(MSG_A);
    expect(d.responseParams.categoria).toBe("Combustível");
  });

  test("categoria reconhecida + 2+ veículos → awaiting_vehicle v1", () => {
    const d = decideConversation(
      inp({
        state: catState,
        originalText: "gasolina",
        vehicles: [veh(VEH_1), veh(VEH_2, "VW", "Gol", "XYZ2E34")],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_vehicle");
    expect(d.statePatch.draftType).toBe("expense");
    expect(d.statePatch.draftVersion).toBe(1);
  });

  test("categoria não reconhecida → mantém awaiting_expense_category, sem contar fallback", () => {
    const d = decideConversation(
      inp({
        state: catState,
        originalText: "qualquer coisa",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.eventKind).toBe("category_reply");
    expect(d.nextState).toBe("awaiting_expense_category");
    expect(d.responseKey).toBe("expense_category_prompt");
    expect(d.nextFallbackCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C) Resposta em awaiting_vehicle (draftType expense)
// ---------------------------------------------------------------------------

describe("T1 despesa — resposta em awaiting_vehicle", () => {
  test("draftVersion 0 + veículo resolvido → awaiting_expense_confirmation v1", () => {
    const s = state({
      state: "awaiting_vehicle",
      currentIntent: "expense",
      awaitingField: "vehicle",
      draftType: "expense",
      draftId: MSG_A,
      draftVersion: 0,
      draftPayload: {
        phase: "awaiting_vehicle",
        categoria: "Combustível",
        valor: 80,
        requestMessageId: MSG_A,
      },
    });
    const d = decideConversation(
      inp({
        state: s,
        originalText: "argo",
        vehicles: [veh(VEH_1, "Fiat", "Argo", "ABC1D23")],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.statePatch.draftVersion).toBe(1);
    expect(d.statePatch.activeVehicleId).toBe(VEH_1);
  });

  test("draftVersion 1 (veio de categoria) + veículo resolvido → v2", () => {
    const s = state({
      state: "awaiting_vehicle",
      currentIntent: "expense",
      awaitingField: "vehicle",
      draftType: "expense",
      draftId: MSG_A,
      draftVersion: 1,
      draftPayload: {
        phase: "awaiting_vehicle",
        categoria: "Combustível",
        valor: 80,
        requestMessageId: MSG_A,
      },
    });
    const d = decideConversation(
      inp({
        state: s,
        originalText: "argo",
        vehicles: [veh(VEH_1, "Fiat", "Argo", "ABC1D23")],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.statePatch.draftVersion).toBe(2);
  });

  test("resposta ambígua → segue awaiting_vehicle", () => {
    const s = state({
      state: "awaiting_vehicle",
      currentIntent: "expense",
      awaitingField: "vehicle",
      draftType: "expense",
      draftId: MSG_A,
      draftVersion: 0,
      draftPayload: {
        phase: "awaiting_vehicle",
        categoria: "Combustível",
        valor: 80,
        requestMessageId: MSG_A,
      },
    });
    const d = decideConversation(
      inp({
        state: s,
        originalText: "outro",
        vehicles: [veh(VEH_1), veh(VEH_2, "VW", "Gol", "XYZ2E34")],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_vehicle");
  });
});

// ---------------------------------------------------------------------------
// D) Confirmação, negação e correção
// ---------------------------------------------------------------------------

function confState(overrides: Partial<ConversationState> = {}): ConversationState {
  return state({
    state: "awaiting_expense_confirmation",
    currentIntent: "expense",
    awaitingField: "confirmation",
    draftType: "expense",
    draftId: MSG_A,
    draftVersion: 0,
    activeVehicleId: VEH_1,
    draftPayload: {
      phase: "awaiting_confirmation",
      categoria: "Combustível",
      valor: 80,
      vehicleId: VEH_1,
      requestMessageId: MSG_A,
    },
    ...overrides,
  });
}

describe("T1 despesa — confirm/deny/correction", () => {
  test("awaiting_expense_confirmation + 'sim' → confirm_expense_create", () => {
    const d = decideConversation(
      inp({
        state: confState(),
        originalText: "sim",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.decisionKind).toBe(CONFIRM_EXPENSE_CREATE_HANDOFF_KIND);
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBeNull();
  });

  test("awaiting_expense_confirmation + 'não' → reset_task/task_cancelled", () => {
    const d = decideConversation(
      inp({
        state: confState(),
        originalText: "não",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.decisionKind).toBe("reset_task");
    expect(d.responseKey).toBe("task_cancelled");
    expect(d.nextState).toBe("idle");
  });

  test("awaiting_expense_correction + 'sim' → confirm_expense_create com reasonCode de correção", () => {
    const d = decideConversation(
      inp({
        state: confState({ state: "awaiting_expense_correction" }),
        originalText: "sim",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.decisionKind).toBe(CONFIRM_EXPENSE_CREATE_HANDOFF_KIND);
    expect(d.reasonCode).toBe("expense_create_correction_confirmed_handoff");
  });

  test("awaiting_expense_confirmation + outra categoria válida → awaiting_expense_correction, draftVersion inalterado", () => {
    const s = confState();
    const d = decideConversation(
      inp({ state: s, originalText: "lavagem", vehicles: [veh(VEH_1)], sourceMessageId: MSG_B }),
    );
    expect(d.nextState).toBe("awaiting_expense_correction");
    expect(d.responseKey).toBe("expense_create_correction_confirmation");
    expect(d.statePatch.draftVersion ?? s.draftVersion).toBe(0);
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.categoria).toBe("Lavagem");
  });

  test("awaiting_expense_correction + outra categoria de novo → continua funcionando", () => {
    const s = confState({
      state: "awaiting_expense_correction",
      draftPayload: {
        phase: "awaiting_confirmation",
        categoria: "Lavagem",
        valor: 80,
        vehicleId: VEH_1,
        requestMessageId: MSG_A,
      },
    });
    const d = decideConversation(
      inp({ state: s, originalText: "ipva", vehicles: [veh(VEH_1)], sourceMessageId: MSG_B }),
    );
    expect(d.nextState).toBe("awaiting_expense_correction");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.categoria).toBe("IPVA");
  });

  test("awaiting_expense_confirmation + MESMA categoria do draft → NÃO trata como correção", () => {
    const d = decideConversation(
      inp({
        state: confState(),
        originalText: "gasolina",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).not.toBe("awaiting_expense_correction");
    expect(d.responseKey).not.toBe("expense_create_correction_confirmation");
  });

  test("awaiting_expense_confirmation + texto aleatório sem categoria → fallback, não quebra", () => {
    const d = decideConversation(
      inp({
        state: confState(),
        originalText: "xyzabc",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).not.toBe("awaiting_expense_correction");
    expect(["fallback", "respond"]).toContain(d.decisionKind);
  });
});

// Passo D-4 (P0-3B-R, final): CHAMADA 2 (correção de categoria durante
// awaiting_expense_confirmation/correction) migrada de matchExpenseCategoria
// para recognizeExpenseSemantics — último dos 4 pontos de chamada. Corrigir
// a categoria com "revisão"/"ar condicionado"/"manutenção" sozinha agora
// dispara o mesmo mecanismo de especificação de item de D-2/D-3, mas com
// allowRetry: false (sem 2ª chance — nunca mostrar na tela uma categoria
// diferente da que será de fato gravada).
describe("T1 despesa — correção de categoria via recognizeExpenseSemantics (Passo D-4)", () => {
  const MSG_C = "33333333-3333-4333-8333-333333333333";

  test("a) correção normal: categoria clara e diferente da atual → awaiting_expense_correction (comportamento preservado)", () => {
    const s = confState({
      draftPayload: {
        phase: "awaiting_confirmation",
        categoria: "Lavagem",
        valor: 80,
        vehicleId: VEH_1,
        requestMessageId: MSG_A,
      },
    });
    const d = decideConversation(
      inp({ state: s, originalText: "gasolina", vehicles: [veh(VEH_1)], sourceMessageId: MSG_B }),
    );
    expect(d.nextState).toBe("awaiting_expense_correction");
    expect(d.responseKey).toBe("expense_create_correction_confirmation");
    expect(d.responseParams.categoria).toBe("Combustível");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.categoria).toBe("Combustível");
  });

  test("b) correção com 'revisão' sozinha → dispara especificação de item, awaiting_item_specification com allowRetry: false", () => {
    const d = decideConversation(
      inp({
        state: confState(),
        originalText: "revisão",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_item_specification");
    expect(d.responseKey).toBe("expense_item_specification_prompt");
    expect(d.responseParams.itemSpecificationTrigger).toBe("revision_item_unspecified");
    expect(d.responseParams.valor).toBe(80);
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.allowRetry).toBe(false);
    expect(payload?.retriedOnce).toBe(false);
    expect(payload?.fallbackCategory).toBe("Manutenção");
  });

  test("c) turno 2 dessa especificação: resposta vaga ('sei lá') → NÃO repete (allowRetry false), vai direto para awaiting_expense_confirmation com fallbackCategory", () => {
    const t1 = decideConversation(
      inp({
        state: confState(),
        originalText: "revisão",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(t1.nextState).toBe("awaiting_item_specification");

    const itemSpecState = state({
      state: "awaiting_item_specification",
      currentIntent: "expense",
      awaitingField: "item_specification",
      draftType: "expense",
      draftId: t1.statePatch.draftId as string,
      draftVersion: t1.statePatch.draftVersion as number,
      draftPayload: t1.statePatch.draftPayload as Record<string, unknown>,
      activeVehicleId: VEH_1,
    });

    const t2 = decideConversation(
      inp({
        state: itemSpecState,
        originalText: "sei lá",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_C,
      }),
    );
    expect(t2.nextState).toBe("awaiting_expense_confirmation");
    expect(t2.responseKey).toBe("expense_create_confirmation");
    expect(t2.responseParams.categoria).toBe("Manutenção");
    expect(t2.responseParams.valor).toBe(80);
  });

  test("d) turno 2 alternativo: resposta 'óleo' (motor reconhecido) → awaiting_expense_confirmation com categoria Revisão", () => {
    const t1 = decideConversation(
      inp({
        state: confState(),
        originalText: "revisão",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(t1.nextState).toBe("awaiting_item_specification");

    const itemSpecState = state({
      state: "awaiting_item_specification",
      currentIntent: "expense",
      awaitingField: "item_specification",
      draftType: "expense",
      draftId: t1.statePatch.draftId as string,
      draftVersion: t1.statePatch.draftVersion as number,
      draftPayload: t1.statePatch.draftPayload as Record<string, unknown>,
      activeVehicleId: VEH_1,
    });

    const t2 = decideConversation(
      inp({
        state: itemSpecState,
        originalText: "óleo",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_C,
      }),
    );
    expect(t2.nextState).toBe("awaiting_expense_confirmation");
    expect(t2.responseKey).toBe("expense_create_confirmation");
    expect(t2.responseParams.categoria).toBe("Revisão");
    expect(t2.responseParams.valor).toBe(80);
  });

  test("e) categoria não reconhecida ('xyz') → nada muda, segue fluxo padrão (comportamento de hoje)", () => {
    const d = decideConversation(
      inp({
        state: confState(),
        originalText: "xyz",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.nextState).not.toBe("awaiting_expense_correction");
    expect(d.nextState).not.toBe("awaiting_item_specification");
    expect(d.responseKey).not.toBe("expense_create_correction_confirmation");
    expect(d.responseKey).not.toBe("expense_item_specification_prompt");
  });
});

// ---------------------------------------------------------------------------
// E) Regressão / interações
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// F) I4a — curto-circuito por intenção explícita (só os 3 sinais confiantes
// de não-conclusão: orçamento/futuro/pergunta técnica). "ambiguous" é
// tratado igual a "record_completed_expense" dentro do T1 — a presença de
// valor numérico já é evidência estrutural suficiente. Nenhum draft de
// despesa é criado nos 3 casos novos, volta pro estado idle,
// nextFallbackCount 0.
// ---------------------------------------------------------------------------

describe("T1 despesa — I4a curto-circuito por intenção (quote/futuro/pergunta)", () => {
  test("valor + orçamento ('quanto custa...') → respond, expense_quote_acknowledged, idle", () => {
    const d = decideConversation(
      inp({
        originalText: "quanto custa trocar o oleo, uns 200 reais?",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("respond");
    expect(d.responseKey).toBe("expense_quote_acknowledged");
    expect(d.nextState).toBe("idle");
    expect(d.nextFallbackCount).toBe(0);
    expect(d.statePatch.draftType ?? null).toBeNull();
    expect(d.statePatch.draftPayload ?? null).toBeNull();
  });

  test("valor + intenção futura ('vou trocar...') → respond, expense_future_service_acknowledged, idle", () => {
    const d = decideConversation(
      inp({
        originalText: "vou trocar o oleo, acho que uns 200 reais",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("respond");
    expect(d.responseKey).toBe("expense_future_service_acknowledged");
    expect(d.nextState).toBe("idle");
    expect(d.nextFallbackCount).toBe(0);
    expect(d.statePatch.draftType ?? null).toBeNull();
    expect(d.statePatch.draftPayload ?? null).toBeNull();
  });

  test("valor + pergunta técnica ('sera que...') → respond, expense_technical_question_acknowledged, idle", () => {
    const d = decideConversation(
      inp({
        originalText: "sera que 200 reais e caro pra trocar o oleo?",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("respond");
    expect(d.responseKey).toBe("expense_technical_question_acknowledged");
    expect(d.nextState).toBe("idle");
    expect(d.nextFallbackCount).toBe(0);
    expect(d.statePatch.draftType ?? null).toBeNull();
    expect(d.statePatch.draftPayload ?? null).toBeNull();
  });

  // REGRESSÃO CRÍTICA — os 2 textos que quebraram na tentativa anterior
  // deste build (bare "categoria + valor", sem verbo, sempre classificados
  // "ambiguous" pelo I1): precisam continuar EXATAMENTE como já testado em
  // "T1 despesa — draft direto em idle" (describe A, acima, não tocado).
  test("REGRESSÃO: 'gasolina R$ 80' (ambiguous no I1, sem verbo) → draft criado normalmente, comportamento idêntico ao já testado", () => {
    const d = decideConversation(inp({ originalText: "gasolina R$ 80", vehicles: [veh(VEH_1)] }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("transition");
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.statePatch.draftType).toBe("expense");
    expect(d.responseParams.valor).toBe(80);
    expect(d.responseParams.categoria).toBe("Combustível");
  });

  test("REGRESSÃO: 'coxim do motor 30,00' (ambiguous no I1, categoria não reconhecida) → awaiting_expense_category, comportamento idêntico ao já testado", () => {
    const d = decideConversation(
      inp({ originalText: "coxim do motor 30,00", vehicles: [veh(VEH_1)] }),
    );
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_expense_category");
    expect(d.responseKey).toBe("expense_category_prompt");
    expect(d.statePatch.draftType).toBe("expense");
    expect(d.responseParams.valor).toBe(30);
  });

  // Ambiguous com categoria reconhecível ("farol" é ambíguo entre
  // Manutenção/Acessórios no não-motor) — segue o fluxo normal de despesa,
  // NUNCA produz expense_occurrence_clarification (reservada pro I4b).
  test("valor + ambiguous com categoria reconhecível ('farol 50') → segue fluxo normal de despesa, não expense_occurrence_clarification", () => {
    const d = decideConversation(inp({ originalText: "farol 50", vehicles: [veh(VEH_1)] }));
    expect(d.responseKey).not.toBe("expense_occurrence_clarification");
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
  });

  // Caso de borda: o texto TAMBÉM reconheceria um conceito de motor
  // ("óleo"), mas a intenção é orçamento — orçamento vence, nenhum draft é
  // criado, mesmo "óleo" sendo reconhecível.
  test("BORDA: valor + orçamento sobre item de motor reconhecível ('quanto custa trocar o óleo...') → orçamento vence, sem draft", () => {
    const d = decideConversation(
      inp({
        originalText: "quanto custa trocar o oleo, acho que uns 150 reais?",
        vehicles: [veh(VEH_1)],
      }),
    );
    expect(d.decisionKind).toBe("respond");
    expect(d.responseKey).toBe("expense_quote_acknowledged");
    expect(d.nextState).toBe("idle");
    expect(d.statePatch.draftType ?? null).toBeNull();
    expect(d.statePatch.draftPayload ?? null).toBeNull();
  });
});

describe("T1 despesa — regressões", () => {
  test("KM continua com prioridade: 'km atual 45000 km' → fluxo KM, não expense", () => {
    const d = decideConversation(
      inp({ originalText: "km atual 45000 km", vehicles: [veh(VEH_1)] }),
    );
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
  });

  test("cancel_task funciona em awaiting_expense_category", () => {
    const s = state({
      state: "awaiting_expense_category",
      currentIntent: "expense",
      awaitingField: "categoria",
      draftType: "expense",
      draftId: MSG_A,
      draftVersion: 0,
      draftPayload: { phase: "awaiting_category", valor: 80, requestMessageId: MSG_A },
    });
    const d = decideConversation(
      inp({ state: s, originalText: "cancelar", sourceMessageId: MSG_B }),
    );
    expect(d.decisionKind).toBe("reset_task");
    expect(d.nextState).toBe("idle");
  });

  test("cancel_task funciona em awaiting_expense_confirmation", () => {
    const d = decideConversation(
      inp({
        state: confState(),
        originalText: "cancelar",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.decisionKind).toBe("reset_task");
    expect(d.nextState).toBe("idle");
  });

  test("cancel_task funciona em awaiting_expense_correction", () => {
    const d = decideConversation(
      inp({
        state: confState({ state: "awaiting_expense_correction" }),
        originalText: "cancelar",
        vehicles: [veh(VEH_1)],
        sourceMessageId: MSG_B,
      }),
    );
    expect(d.decisionKind).toBe("reset_task");
  });
});
