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
import { EXPENSE_CATEGORIES } from "../expense-create-draft.ts";
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
    expect(d.responseParams.options).toEqual([...EXPENSE_CATEGORIES]);
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

// ---------------------------------------------------------------------------
// E) Regressão / interações
// ---------------------------------------------------------------------------

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
