import { describe, expect, it } from "bun:test";
import { isDeterministicRevisionItem } from "../../../../../../src/lib/maintenance-jarvys-schedule-rules.ts";
import { recognizeExpenseSemantics } from "../expense-category-recognizer.ts";

describe("expense category recognizer — conceito de motor único", () => {
  it("reconhece 'troquei o oleo' como resolved, Revisão, itemKeys ['oleo_motor']", () => {
    const result = recognizeExpenseSemantics({ originalText: "troquei o oleo" });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Revisão");
      expect(result.itemKeys).toEqual(["oleo_motor"]);
      expect(result.persistable).toBe(true);
    }
  });
});

describe("expense category recognizer — múltiplos conceitos de motor", () => {
  it("reconhece 'troquei oleo e filtro de ar' como resolved, Revisão, união de itemKeys sem duplicatas", () => {
    const result = recognizeExpenseSemantics({ originalText: "troquei oleo e filtro de ar" });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Revisão");
      expect(result.itemKeys).toEqual(["oleo_motor"]);
    }
  });

  it("reconhece 'troquei o filtro de oleo do motor' com itemKeys de engine_oil e engine_oil_filter juntos", () => {
    const result = recognizeExpenseSemantics({ originalText: "troquei o filtro de oleo do motor" });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Revisão");
      expect([...result.itemKeys].sort()).toEqual(["filtro_oleo", "oleo_motor"]);
    }
  });
});

describe("expense category recognizer — termo não-motor resolvido", () => {
  it("reconhece 'troquei a bateria' como resolved, Manutenção, itemKeys vazio", () => {
    const result = recognizeExpenseSemantics({ originalText: "troquei a bateria" });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Manutenção");
      expect(result.itemKeys).toEqual([]);
    }
  });
});

describe("expense category recognizer — termo não-motor ambíguo", () => {
  it("reconhece 'farol' sozinho como needs_clarification com reason category_ambiguous_non_engine", () => {
    const result = recognizeExpenseSemantics({ originalText: "preciso trocar o farol" });
    expect(result.status).toBe("needs_clarification");
    if (result.status === "needs_clarification") {
      expect(result.reason).toBe("category_ambiguous_non_engine");
      expect(result.persistable).toBe(false);
      expect(result.candidateCategories).toContain("Manutenção");
      expect(result.candidateCategories).toContain("Acessórios");
    }
  });
});

describe("expense category recognizer — texto sem nenhum termo reconhecido", () => {
  it("reconhece 'aluguel do box da garagem' como unsupported, reason unsupported_semantics", () => {
    const result = recognizeExpenseSemantics({ originalText: "aluguel do box da garagem" });
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toBe("unsupported_semantics");
      expect(result.persistable).toBe(false);
    }
  });
});

describe("expense category recognizer — motor sempre vence sobre não-motor", () => {
  it("reconhece 'troquei o oleo e o pneu' como resolved, Revisão (heurística não-motor nem é chamada)", () => {
    const result = recognizeExpenseSemantics({ originalText: "troquei o oleo e o pneu" });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Revisão");
      expect(result.itemKeys).toEqual(["oleo_motor"]);
    }
  });
});

describe("expense category recognizer — especificação de item necessária", () => {
  it("reconhece 'ar condicionado' sozinho como needs_item_specification, trigger ac_service_unspecified, fallbackCategory Manutenção", () => {
    const result = recognizeExpenseSemantics({ originalText: "ar condicionado" });
    expect(result.status).toBe("needs_item_specification");
    if (result.status === "needs_item_specification") {
      expect(result.trigger).toBe("ac_service_unspecified");
      expect(result.fallbackCategory).toBe("Manutenção");
      expect(result.persistable).toBe(false);
    }
  });

  it("reconhece 'revisão' sozinha como needs_item_specification, trigger revision_item_unspecified, fallbackCategory Manutenção", () => {
    const result = recognizeExpenseSemantics({ originalText: "revisão" });
    expect(result.status).toBe("needs_item_specification");
    if (result.status === "needs_item_specification") {
      expect(result.trigger).toBe("revision_item_unspecified");
      expect(result.fallbackCategory).toBe("Manutenção");
      expect(result.persistable).toBe(false);
    }
  });

  it("reconhece 'revisão preventiva' como needs_item_specification, trigger revision_item_unspecified", () => {
    const result = recognizeExpenseSemantics({ originalText: "revisão preventiva" });
    expect(result.status).toBe("needs_item_specification");
    if (result.status === "needs_item_specification") {
      expect(result.trigger).toBe("revision_item_unspecified");
      expect(result.fallbackCategory).toBe("Manutenção");
    }
  });

  it("reconhece 'revisão, troquei o oleo' como resolved, Revisão (motor sempre vence, gatilho novo não dispara)", () => {
    const result = recognizeExpenseSemantics({ originalText: "revisão, troquei o oleo" });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Revisão");
      expect(result.itemKeys).toEqual(["oleo_motor"]);
    }
  });

  it("reconhece 'revisão, troquei a bateria' como resolved, Manutenção (não-motor já reconhecido vence, gatilho novo não dispara)", () => {
    const result = recognizeExpenseSemantics({ originalText: "revisão, troquei a bateria" });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Manutenção");
      expect(result.itemKeys).toEqual([]);
    }
  });

  it("reconhece 'manutenção, gastei 800 reais' como needs_item_specification, trigger maintenance_unspecified, fallbackCategory Manutenção", () => {
    const result = recognizeExpenseSemantics({ originalText: "manutenção, gastei 800 reais" });
    expect(result.status).toBe("needs_item_specification");
    if (result.status === "needs_item_specification") {
      expect(result.trigger).toBe("maintenance_unspecified");
      expect(result.fallbackCategory).toBe("Manutenção");
      expect(result.persistable).toBe(false);
    }
  });

  it("reconhece 'manutenção, troquei o oleo' como resolved, Revisão (motor sempre vence, gatilho novo não dispara)", () => {
    const result = recognizeExpenseSemantics({ originalText: "manutenção, troquei o oleo" });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Revisão");
      expect(result.itemKeys).toEqual(["oleo_motor"]);
    }
  });
});

describe("expense category recognizer — 'geral' cede para gatilhos de especificação de item", () => {
  it("'lavagem geral' → resolved, Lavagem (não é mais needs_clarification)", () => {
    const result = recognizeExpenseSemantics({ originalText: "lavagem geral" });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Lavagem");
    }
  });

  it("'conserto geral' → needs_item_specification, trigger maintenance_unspecified (via o novo gatilho 'geral', não 'manutencao')", () => {
    const result = recognizeExpenseSemantics({ originalText: "conserto geral" });
    expect(result.status).toBe("needs_item_specification");
    if (result.status === "needs_item_specification") {
      expect(result.trigger).toBe("maintenance_unspecified");
      expect(result.fallbackCategory).toBe("Manutenção");
    }
  });

  it("'revisão geral' → needs_item_specification, trigger revision_item_unspecified (gatilho de revisão vence, não o de 'geral')", () => {
    const result = recognizeExpenseSemantics({ originalText: "revisão geral" });
    expect(result.status).toBe("needs_item_specification");
    if (result.status === "needs_item_specification") {
      expect(result.trigger).toBe("revision_item_unspecified");
      expect(result.fallbackCategory).toBe("Manutenção");
    }
  });

  it("'ar condicionado geral' → needs_item_specification, trigger ac_service_unspecified (gatilho de ar condicionado vence, não o de 'geral')", () => {
    const result = recognizeExpenseSemantics({ originalText: "ar condicionado geral" });
    expect(result.status).toBe("needs_item_specification");
    if (result.status === "needs_item_specification") {
      expect(result.trigger).toBe("ac_service_unspecified");
      expect(result.fallbackCategory).toBe("Manutenção");
    }
  });

  it("'manutenção geral no carro todo, revisei tudo mesmo, 500 reais' → needs_item_specification, trigger maintenance_unspecified (caso original)", () => {
    const result = recognizeExpenseSemantics({
      originalText: "manutenção geral no carro todo, revisei tudo mesmo, 500 reais",
    });
    expect(result.status).toBe("needs_item_specification");
    if (result.status === "needs_item_specification") {
      expect(result.trigger).toBe("maintenance_unspecified");
      expect(result.fallbackCategory).toBe("Manutenção");
    }
  });
});

describe("expense category recognizer — entradas vazias", () => {
  it("retorna unsupported para texto vazio, sem lançar erro", () => {
    expect(() => recognizeExpenseSemantics({ originalText: "" })).not.toThrow();
    const result = recognizeExpenseSemantics({ originalText: "" });
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toBe("unsupported_semantics");
    }
  });

  it("retorna unsupported para null e undefined, sem lançar erro", () => {
    expect(() =>
      recognizeExpenseSemantics({ originalText: null as unknown as string }),
    ).not.toThrow();
    const nullResult = recognizeExpenseSemantics({ originalText: null as unknown as string });
    expect(nullResult.status).toBe("unsupported");

    expect(() =>
      recognizeExpenseSemantics({ originalText: undefined as unknown as string }),
    ).not.toThrow();
    const undefinedResult = recognizeExpenseSemantics({
      originalText: undefined as unknown as string,
    });
    expect(undefinedResult.status).toBe("unsupported");
  });
});

// Migrado de resolver.test.ts (resolver.ts foi removido — órfão da fase
// S1-S3, superado por este reconhecedor). Mesma checagem cruzada de antes,
// agora contra o sistema novo: toda item key emitida por
// recognizeExpenseSemantics precisa ser reconhecida pelo helper existente
// isDeterministicRevisionItem.
describe("expense category recognizer — checagem cruzada com isDeterministicRevisionItem", () => {
  it("o helper existente reconhece todas as item keys emitidas", () => {
    function resolvedItemKeys(text: string): readonly string[] {
      const result = recognizeExpenseSemantics({ originalText: text });
      expect(result.status).toBe("resolved");
      if (result.status !== "resolved") throw new Error(`Expected resolved for: ${text}`);
      return result.itemKeys;
    }

    const emitted = [
      ...resolvedItemKeys("troquei o oleo do motor"),
      ...resolvedItemKeys("troquei o filtro de oleo"),
    ];
    for (const key of new Set(emitted)) expect(isDeterministicRevisionItem(key)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// I2 — curto-circuito por explicitIntent (inerte por padrão, ver
// expense-category-recognizer.ts para a ordem/rationale)
// ---------------------------------------------------------------------------

describe("I2 — curto-circuito por explicitIntent", () => {
  it("explicitIntent='ask_question' → conversation_only, reason technical_question", () => {
    const result = recognizeExpenseSemantics({
      originalText: "qualquer texto",
      explicitIntent: "ask_question",
    });
    expect(result.status).toBe("conversation_only");
    if (result.status === "conversation_only") {
      expect(result.reason).toBe("technical_question");
      expect(result.persistable).toBe(false);
      expect(result.decisionCode).toBe("non_persistable_conversation");
    }
  });

  it("explicitIntent='discuss_future_service' → conversation_only, reason future_service", () => {
    const result = recognizeExpenseSemantics({
      originalText: "qualquer texto",
      explicitIntent: "discuss_future_service",
    });
    expect(result.status).toBe("conversation_only");
    if (result.status === "conversation_only") {
      expect(result.reason).toBe("future_service");
      expect(result.persistable).toBe(false);
      expect(result.decisionCode).toBe("non_persistable_conversation");
    }
  });

  it("explicitIntent='request_quote' → conversation_only, reason quote", () => {
    const result = recognizeExpenseSemantics({
      originalText: "qualquer texto",
      explicitIntent: "request_quote",
    });
    expect(result.status).toBe("conversation_only");
    if (result.status === "conversation_only") {
      expect(result.reason).toBe("quote");
      expect(result.persistable).toBe(false);
      expect(result.decisionCode).toBe("non_persistable_conversation");
    }
  });

  it("explicitIntent='ambiguous' → needs_clarification, reason expense_or_question_intent_ambiguous, sem candidateCategories", () => {
    const result = recognizeExpenseSemantics({
      originalText: "qualquer texto",
      explicitIntent: "ambiguous",
    });
    expect(result.status).toBe("needs_clarification");
    if (result.status === "needs_clarification") {
      expect(result.reason).toBe("expense_or_question_intent_ambiguous");
      expect(result.persistable).toBe(false);
      expect(result.decisionCode).toBe("clarification_required");
      expect("candidateCategories" in result).toBe(false);
    }
  });

  it("explicitIntent='record_completed_expense' → comportamento IDÊNTICO a explicitIntent ausente (equivalência)", () => {
    const withIntent = recognizeExpenseSemantics({
      originalText: "troquei o oleo",
      explicitIntent: "record_completed_expense",
    });
    const withoutIntent = recognizeExpenseSemantics({ originalText: "troquei o oleo" });
    expect(withIntent).toEqual(withoutIntent);
    expect(withIntent.status).toBe("resolved");
  });

  it.each([
    "troquei o oleo",
    "troquei a bateria",
    "preciso trocar o farol",
    "aluguel do box da garagem",
    "ar condicionado",
    "revisão",
    "lavagem geral",
    "conserto geral",
  ])(
    "explicitIntent ausente (campo omitido) com %p → resultado idêntico ao comportamento pré-existente",
    (text: string) => {
      const result = recognizeExpenseSemantics({ originalText: text });
      // Regressão/equivalência: reproduz exatamente as expectativas já
      // cobertas pelos describes acima para o mesmo texto, sem
      // explicitIntent (curto-circuito do I2 inerte).
      const expectedByText: Record<string, unknown> = {
        "troquei o oleo": { status: "resolved", conceptualCategory: "Revisão" },
        "troquei a bateria": { status: "resolved", conceptualCategory: "Manutenção" },
        "preciso trocar o farol": { status: "needs_clarification" },
        "aluguel do box da garagem": { status: "unsupported" },
        "ar condicionado": { status: "needs_item_specification" },
        revisão: { status: "needs_item_specification" },
        "lavagem geral": { status: "resolved", conceptualCategory: "Lavagem" },
        "conserto geral": { status: "needs_item_specification" },
      };
      const expected = expectedByText[text];
      expect(expected).toBeDefined();
      expect(result.status).toBe((expected as { status: string }).status);
      if ("conceptualCategory" in (expected as Record<string, unknown>)) {
        expect((result as { conceptualCategory?: unknown }).conceptualCategory).toBe(
          (expected as { conceptualCategory: unknown }).conceptualCategory,
        );
      }
    },
  );
});
