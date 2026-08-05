// Build corretivo 3/5 — Cobertura de teste do reconhecimento de número
// "pelado" (sem R$, sem "reais", sem vírgula-decimal) como valor de despesa,
// gated por categoria reconhecida na mesma mensagem e limitado por teto de
// bom senso (R$20.000). Não altera código de produção — só testa.

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

function veh(id = VEH_1): ConversationVehicle {
  return {
    id,
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

// ---------------------------------------------------------------------------
// A) Devem passar a funcionar: categoria + número pelado dentro do teto
// ---------------------------------------------------------------------------

describe("bare number + categoria — deve virar despesa", () => {
  const cases: ReadonlyArray<{ text: string; valor: number; categoria: string }> = [
    { text: "GNV 30", valor: 30, categoria: "Combustível" },
    { text: "pneu 25", valor: 25, categoria: "Manutenção" },
    { text: "mecânico 280", valor: 280, categoria: "Manutenção" },
    { text: "oficina 300", valor: 300, categoria: "Manutenção" },
    { text: "conserto 800", valor: 800, categoria: "Manutenção" },
  ];
  for (const c of cases) {
    test(`"${c.text}" → ${c.categoria} R$${c.valor}`, () => {
      const d = decideConversation(inp({ originalText: c.text }));
      expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
      expect(d.nextState).toBe("awaiting_expense_confirmation");
      expect(d.responseParams.valor).toBe(c.valor);
      expect(d.responseParams.categoria).toBe(c.categoria);
    });
  }

  // Atualizado no P0-3B-R: "revisão" sem item de motor específico reconhecido
  // agora pergunta qual item foi feito, em vez de assumir a revisão completa
  // do marco — decisão de produto, ver commit desta branch. Antes ia direto
  // para awaiting_expense_confirmation com categoria "Revisão".
  test('"peças revisão 300" → awaiting_item_specification (não mais Revisão direta)', () => {
    const d = decideConversation(inp({ originalText: "peças revisão 300" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_item_specification");
    expect(d.responseKey).toBe("expense_item_specification_prompt");
    expect(d.responseParams.valor).toBe(300);
    expect(d.responseParams.itemSpecificationTrigger).toBe("revision_item_unspecified");
    const payload = d.statePatch.draftPayload as Record<string, unknown> | null;
    expect(payload?.trigger).toBe("revision_item_unspecified");
    expect(payload?.fallbackCategory).toBe("Manutenção");
  });
});

// ---------------------------------------------------------------------------
// B) Não pode regredir: caminho feliz original (R$, vírgula, "reais")
// ---------------------------------------------------------------------------

describe("caminho feliz original — não regredir", () => {
  test('"conserto 800,00" → Manutenção R$800', () => {
    const d = decideConversation(inp({ originalText: "conserto 800,00" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseParams.valor).toBe(800);
    expect(d.responseParams.categoria).toBe("Manutenção");
  });

  test('"oficina R$450,00" → Manutenção R$450', () => {
    const d = decideConversation(inp({ originalText: "oficina R$450,00" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.responseParams.valor).toBe(450);
    expect(d.responseParams.categoria).toBe("Manutenção");
  });

  test('"gastei 190 reais no posto" → Combustível R$190', () => {
    const d = decideConversation(inp({ originalText: "gastei 190 reais no posto" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.responseParams.valor).toBe(190);
    expect(d.responseParams.categoria).toBe("Combustível");
  });
});

// ---------------------------------------------------------------------------
// C) Segurança 1 — sem categoria, número pelado NÃO vira despesa
// ---------------------------------------------------------------------------

describe("segurança — número sem categoria não vira despesa", () => {
  const cases = ["300", "cheguei as 8", "aniversário dia 15"];
  for (const text of cases) {
    test(`"${text}" → eventKind unknown, fallback`, () => {
      const d = decideConversation(inp({ originalText: text }));
      expect(d.eventKind).toBe("unknown");
      expect(d.nextState).not.toBe("awaiting_expense_confirmation");
      expect(d.nextState).not.toBe("awaiting_expense_category");
    });
  }
});

// ---------------------------------------------------------------------------
// D) Segurança 2 — acima do teto, mesmo com categoria, NÃO vira despesa
// ---------------------------------------------------------------------------

describe("segurança — número pelado acima do teto não vira despesa", () => {
  const cases = ["revisao 40000", "revisao 105000", "pneu 105000"];
  for (const text of cases) {
    test(`"${text}" → não vira despesa`, () => {
      const d = decideConversation(inp({ originalText: text }));
      expect(d.eventKind).not.toBe(EXPENSE_REPORTED_EVENT_KIND);
      expect(d.nextState).not.toBe("awaiting_expense_confirmation");
      expect(d.nextState).not.toBe("awaiting_expense_category");
    });
  }
});

// ---------------------------------------------------------------------------
// E) Ainda NÃO funcionam (esperado — é o build 4). Só documenta.
// ---------------------------------------------------------------------------

describe("build 4 — ainda não funcionam (documentação)", () => {
  // "completei", "óleo" e "som" agora têm categoria (Build 4/6) e passam
  // a funcionar com número pelado. Mantemos aqui apenas palavras sem categoria.
  const cases = ["ar 800", "guincho 100", "lâmpada 45", "escapamento 200"];
  for (const text of cases) {
    test(`"${text}" → ainda cai no fallback (esperado)`, () => {
      const d = decideConversation(inp({ originalText: text }));
      expect(d.eventKind).not.toBe(EXPENSE_REPORTED_EVENT_KIND);
    });
  }
});
