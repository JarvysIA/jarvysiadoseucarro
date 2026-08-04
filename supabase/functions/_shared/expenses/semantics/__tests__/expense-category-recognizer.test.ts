import { describe, expect, it } from "bun:test";
import { recognizeExpenseSemantics } from "../expense-category-recognizer.ts";

describe("expense category recognizer — conceito de motor único", () => {
  it("reconhece 'troquei o oleo' como resolved, Revisão, itemKeys ['oleo_motor']", () => {
    const result = recognizeExpenseSemantics("troquei o oleo");
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
    const result = recognizeExpenseSemantics("troquei oleo e filtro de ar");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Revisão");
      expect(result.itemKeys).toEqual(["oleo_motor"]);
    }
  });

  it("reconhece 'troquei o filtro de oleo do motor' com itemKeys de engine_oil e engine_oil_filter juntos", () => {
    const result = recognizeExpenseSemantics("troquei o filtro de oleo do motor");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Revisão");
      expect([...result.itemKeys].sort()).toEqual(["filtro_oleo", "oleo_motor"]);
    }
  });
});

describe("expense category recognizer — termo não-motor resolvido", () => {
  it("reconhece 'troquei a bateria' como resolved, Manutenção, itemKeys vazio", () => {
    const result = recognizeExpenseSemantics("troquei a bateria");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Manutenção");
      expect(result.itemKeys).toEqual([]);
    }
  });
});

describe("expense category recognizer — termo não-motor ambíguo", () => {
  it("reconhece 'farol' sozinho como needs_clarification com reason category_ambiguous_non_engine", () => {
    const result = recognizeExpenseSemantics("preciso trocar o farol");
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
    const result = recognizeExpenseSemantics("aluguel do box da garagem");
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toBe("unsupported_semantics");
      expect(result.persistable).toBe(false);
    }
  });
});

describe("expense category recognizer — motor sempre vence sobre não-motor", () => {
  it("reconhece 'troquei o oleo e o pneu' como resolved, Revisão (heurística não-motor nem é chamada)", () => {
    const result = recognizeExpenseSemantics("troquei o oleo e o pneu");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.conceptualCategory).toBe("Revisão");
      expect(result.itemKeys).toEqual(["oleo_motor"]);
    }
  });
});

describe("expense category recognizer — entradas vazias", () => {
  it("retorna unsupported para texto vazio, sem lançar erro", () => {
    expect(() => recognizeExpenseSemantics("")).not.toThrow();
    const result = recognizeExpenseSemantics("");
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toBe("unsupported_semantics");
    }
  });

  it("retorna unsupported para null e undefined, sem lançar erro", () => {
    expect(() => recognizeExpenseSemantics(null as unknown as string)).not.toThrow();
    const nullResult = recognizeExpenseSemantics(null as unknown as string);
    expect(nullResult.status).toBe("unsupported");

    expect(() => recognizeExpenseSemantics(undefined as unknown as string)).not.toThrow();
    const undefinedResult = recognizeExpenseSemantics(undefined as unknown as string);
    expect(undefinedResult.status).toBe("unsupported");
  });
});
