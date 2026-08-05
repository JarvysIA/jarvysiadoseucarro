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

  // Atualizado no P0-3B-R, Passo D-1: "escapamento" já está no dicionário do
  // reconhecedor novo (non-engine-heuristic-classifier.ts) desde builds
  // anteriores; a hint agora permite reinterpretar o número pelado (valor
  // reconhecido = 200). MAS a CHAMADA 4 (categoriaMatch, mais abaixo no mesmo
  // bloco T1) continua usando o parser LEGADO, intocado neste sub-passo —
  // "escapamento" NÃO está no dicionário do legado, então categoriaMatch
  // falha e o fluxo vai para awaiting_expense_category (pergunta a
  // categoria), não direto para awaiting_expense_confirmation com
  // Manutenção. Isso é uma melhoria real (antes: nem virava despesa) mas
  // parcial (só a substituição da CHAMADA 4, num sub-passo futuro, resolve
  // por completo) — exatamente o "pode não mudar o desfecho final" descrito
  // no escopo deste Passo D-1. Removido da lista "ainda não funcionam"
  // abaixo, já que agora reconhece o valor; não colocado na lista simples
  // acima, já que o desfecho final ainda não é a confirmação direta.
  test('"escapamento 200" → valor 200 reconhecido (hint), mas categoria ainda pendente (CHAMADA 4 no legado não conhece "escapamento")', () => {
    const d = decideConversation(inp({ originalText: "escapamento 200" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_expense_category");
    expect(d.responseKey).toBe("expense_category_prompt");
    expect(d.responseParams.valor).toBe(200);
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
  // a funcionar com número pelado. "escapamento" também passou a reconhecer
  // valor (P0-3B-R, Passo D-1), mas com desfecho parcial (vai para
  // awaiting_expense_category, não confirmação direta) — tem teste dedicado
  // na seção A, não se encaixa nem aqui nem no array simples. Mantemos aqui
  // apenas palavras sem categoria em nenhum dos dois sistemas.
  const cases = ["ar 800", "guincho 100", "lâmpada 45"];
  for (const text of cases) {
    test(`"${text}" → ainda cai no fallback (esperado)`, () => {
      const d = decideConversation(inp({ originalText: text }));
      expect(d.eventKind).not.toBe(EXPENSE_REPORTED_EVENT_KIND);
    });
  }
});

// ---------------------------------------------------------------------------
// F) Passo D-1 (P0-3B-R) — categoriaHint trocado de matchExpenseCategoria para
// recognizeExpenseSemantics, condição "ok" trocada para "status !== unsupported".
// ---------------------------------------------------------------------------

describe("categoriaHint agora usa recognizeExpenseSemantics (Passo D-1)", () => {
  // "ar condicionado 200" não tem R$/reais/vírgula, então só vira despesa se a
  // hint permitir a reinterpretação do número pelado. Resultado observado:
  // vira valor=200 e é interceptado pelo bloco de needs_item_specification
  // (Passo B, que roda ANTES de categoriaMatch/CHAMADA 4 no mesmo bloco T1) —
  // vai para awaiting_item_specification, não para awaiting_expense_confirmation
  // direto. NOTA: para este texto específico, o hint LEGADO também já
  // permitiria a reinterpretação (matchExpenseCategoria já reconhecia "ar
  // condicionado" bare como Manutenção antes desta troca) — então este caso
  // não isola sozinho o efeito da condição "status !== unsupported" vs "ok".
  // Documentando o resultado observado, como pedido, mesmo assim.
  test('"ar condicionado 200" → hint permite reinterpretação, needs_item_specification intercepta antes da CHAMADA 4', () => {
    const d = decideConversation(inp({ originalText: "ar condicionado 200" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_item_specification");
    expect(d.responseKey).toBe("expense_item_specification_prompt");
    expect(d.responseParams.valor).toBe(200);
    expect(d.responseParams.itemSpecificationTrigger).toBe("ac_service_unspecified");
  });

  // "gasolina 80" não muda: recognizeExpenseSemantics resolve Combustível
  // (status "resolved" !== "unsupported"), igual ao hint legado permitia
  // (matchExpenseCategoria também já reconhecia "gasolina"). Prova de
  // não-regressão do caso comum, com CHAMADA 4 (legado, intocada) decidindo
  // a categoria final normalmente.
  test('"gasolina 80" → idêntico a antes (não-regressão do caso comum)', () => {
    const d = decideConversation(inp({ originalText: "gasolina 80" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Combustível");
    expect(d.responseParams.valor).toBe(80);
  });

  // "GNV 30" — o próprio caso da regressão descoberta na tentativa original
  // deste Passo D-1: dependia do gap de escopo do GNV (PR #21) estar fechado
  // primeiro. Teste formal confirmando que voltou a funcionar.
  test('"GNV 30" → volta a funcionar (dependia do fechamento do gap de GNV, PR #21)', () => {
    const d = decideConversation(inp({ originalText: "GNV 30" }));
    expect(d.eventKind).toBe(EXPENSE_REPORTED_EVENT_KIND);
    expect(d.nextState).toBe("awaiting_expense_confirmation");
    expect(d.responseKey).toBe("expense_create_confirmation");
    expect(d.responseParams.categoria).toBe("Combustível");
    expect(d.responseParams.valor).toBe(30);
  });
});
