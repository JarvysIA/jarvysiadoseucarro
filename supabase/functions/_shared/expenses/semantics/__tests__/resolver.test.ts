import { describe, expect, it } from "bun:test";
import { isDeterministicRevisionItem } from "../../../../../../src/lib/maintenance-jarvys-schedule-rules.ts";
import { normalizeExpenseSemanticText, resolveExpenseSemantics } from "../index.ts";
import type { ExpenseSemanticResult, ResolvedExpenseSemantics } from "../types.ts";

function resolve(originalText: string): ExpenseSemanticResult {
  return resolveExpenseSemantics({ originalText });
}

function expectResolved(text: string): ResolvedExpenseSemantics {
  const result = resolve(text);
  expect(result.status).toBe("resolved");
  if (result.status !== "resolved") throw new Error(`Expected resolved for: ${text}`);
  return result;
}

describe("normalizeExpenseSemanticText", () => {
  it("normaliza caixa", () => {
    expect(normalizeExpenseSemanticText("ÓLEO DO MOTOR")).toBe("oleo do motor");
  });

  it("remove acentos", () => {
    expect(normalizeExpenseSemanticText("câmbio transmissão óleo")).toBe("cambio transmissao oleo");
  });

  it("normaliza pontuação simples", () => {
    expect(normalizeExpenseSemanticText("Troquei: óleo, filtro.")).toBe("troquei oleo filtro");
  });

  it("normaliza espaços duplicados e extremidades", () => {
    expect(normalizeExpenseSemanticText("  troca   de óleo  ")).toBe("troca de oleo");
  });
});

describe("resolveExpenseSemantics — óleo do motor", () => {
  it("fecha troca de óleo do motor com filtro", () => {
    const result = expectResolved("Troquei o óleo do motor.");
    expect(result.conceptualCategory).toBe("Revisão");
    expect(result.itemKeys).toEqual(["oleo_motor", "filtro_oleo"]);
  });

  it("reconhece especificação fechada entre óleo e motor", () => {
    expect(expectResolved("Troquei o óleo 5W30 do motor.").itemKeys).toEqual([
      "oleo_motor",
      "filtro_oleo",
    ]);
  });

  it("deduplica óleo e filtro explicitamente mencionados", () => {
    expect(expectResolved("Troquei óleo e filtro do motor.").itemKeys).toEqual([
      "oleo_motor",
      "filtro_oleo",
    ]);
  });

  it("mantém somente filtro de óleo explicitamente isolado", () => {
    expect(expectResolved("Troquei o filtro de óleo.").itemKeys).toEqual(["filtro_oleo"]);
  });

  it("não infere óleo a partir de apenas filtro do óleo do motor", () => {
    expect(expectResolved("Troquei apenas o filtro do óleo do motor.").itemKeys).toEqual([
      "filtro_oleo",
    ]);
  });

  it("reconhece substituição concluída do filtro isolado", () => {
    expect(expectResolved("O filtro de óleo estava vazando e foi substituído.").itemKeys).toEqual([
      "filtro_oleo",
    ]);
  });

  it("óleo sem sistema pede esclarecimento", () => {
    expect(resolve("Troquei o óleo.")).toMatchObject({
      status: "needs_clarification",
      persistable: false,
      reason: "oil_system_ambiguous",
    });
  });

  it("óleo e filtro sem sistema não presumem motor", () => {
    expect(resolve("Troquei óleo e filtro.")).toMatchObject({
      status: "needs_clarification",
      reason: "oil_system_ambiguous",
    });
  });
});

describe("resolveExpenseSemantics — transmissão", () => {
  const cases = [
    "Troquei o óleo do câmbio por R$ 1.199.",
    "Troquei o óleo da transmissão por R$ 699.",
    "Fiz a troca do fluido do câmbio.",
    "Troquei o fluido da transmissão.",
  ] as const;

  for (const text of cases) {
    it(`resolve Revisão sem especialização nem filtro: ${text}`, () => {
      const result = expectResolved(text);
      expect(result.conceptualCategory).toBe("Revisão");
      expect(result.itemKeys).toEqual([]);
      expect(result.facts.recognizedSystems).toEqual(["transmission_fluid"]);
      expect(result.decisionCode).toBe("completed_transmission_fluid_without_safe_item_key");
    });
  }

  it("nenhuma expressão de transmissão adiciona filtro do motor ou de transmissão", () => {
    for (const text of cases) {
      const result = expectResolved(text);
      expect(result.itemKeys).not.toContain("filtro_oleo");
      expect(result.itemKeys.some((key) => String(key).includes("cambio"))).toBe(false);
    }
  });
});

describe("resolveExpenseSemantics — intenção", () => {
  const conversationCases = [
    ["Preciso trocar os parafusos da roda.", "future_service"],
    ["Preciso comprar óleo e filtro.", "future_service"],
    ["Comprei óleo e filtro, mas ainda não troquei.", "purchase_before_service"],
    ["Recebi um orçamento para trocar o óleo do câmbio.", "quote"],
    ["Quero saber se esse óleo serve no meu carro.", "technical_question"],
    ["Estou pensando em trocar as pastilhas.", "future_service"],
  ] as const;

  for (const [text, reason] of conversationCases) {
    it(`mantém conversa não persistível: ${text}`, () => {
      expect(resolve(text)).toMatchObject({
        status: "conversation_only",
        persistable: false,
        reason,
      });
    });
  }

  for (const text of [
    "Óleo do câmbio, R$ 1.199.",
    "Pastilha de freio, 600 reais.",
    "Pneus novos, R$ 2.400.",
  ]) {
    it(`valor sem verbo concluído pede confirmação de intenção: ${text}`, () => {
      expect(resolve(text)).toMatchObject({
        status: "needs_clarification",
        persistable: false,
        reason: "expense_or_question_intent_ambiguous",
      });
    });
  }

  it("serviço automotivo concluído sem item determinístico é Manutenção", () => {
    const result = expectResolved("Consertei o escapamento.");
    expect(result.conceptualCategory).toBe("Manutenção");
    expect(result.itemKeys).toEqual([]);
  });
});

describe("resolveExpenseSemantics — fail closed e invariantes", () => {
  it("rejeita candidate item key desconhecida", () => {
    expect(
      resolveExpenseSemantics({
        originalText: "Troquei o óleo do motor.",
        candidateItemKeys: ["inventada"],
      }),
    ).toMatchObject({
      status: "unsupported",
      persistable: false,
      reason: "invalid_candidate_item_key",
    });
  });

  it("rejeita candidate category inválida", () => {
    expect(
      resolveExpenseSemantics({
        originalText: "Troquei o óleo do motor.",
        candidateCategory: "Diversos",
      }),
    ).toMatchObject({
      status: "unsupported",
      persistable: false,
      reason: "invalid_candidate_category",
    });
  });

  it("candidatos válidos não forçam resolução", () => {
    expect(
      resolveExpenseSemantics({
        originalText: "Mensagem sem semântica suportada.",
        candidateCategory: "Revisão",
        candidateItemKeys: ["oleo_motor"],
      }),
    ).toMatchObject({ status: "unsupported", persistable: false });
  });

  it("todos os resultados não resolvidos são explicitamente não persistíveis", () => {
    const results = [
      resolve("Troquei o óleo."),
      resolve("Preciso trocar os parafusos da roda."),
      resolve("texto não suportado"),
      resolveExpenseSemantics({ originalText: "x", candidateItemKeys: ["x"] }),
    ];
    for (const result of results) {
      expect(result.status).not.toBe("resolved");
      expect(result.persistable).toBe(false);
    }
  });

  it("item keys têm ordem determinística e não se duplicam", () => {
    const keys = expectResolved("Troquei óleo e filtro do motor.").itemKeys;
    expect(keys).toEqual(["oleo_motor", "filtro_oleo"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("o helper existente reconhece todas as item keys emitidas", () => {
    const emitted = [
      ...expectResolved("Troquei o óleo do motor.").itemKeys,
      ...expectResolved("Troquei o filtro de óleo.").itemKeys,
    ];
    for (const key of new Set(emitted)) expect(isDeterministicRevisionItem(key)).toBe(true);
  });
});
