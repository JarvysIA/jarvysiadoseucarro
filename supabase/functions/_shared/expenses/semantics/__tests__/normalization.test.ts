import { describe, expect, it } from "bun:test";
import { normalizeExpenseSemanticText } from "../normalization.ts";

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
