// Build 5.7F2E1A.5-MJ1A — Testes do renderer puro.
import { describe, expect, it } from "bun:test";
import { renderKmPromptText } from "../render.ts";

const PREFIX = "Oi! Pra atualizar o histórico do seu ";
const SUFFIX =
  ", me manda a quilometragem atual — só o número, por exemplo: 45320.";

describe("renderKmPromptText", () => {
  it("renderiza label normal exatamente na microcopy", () => {
    expect(renderKmPromptText({ vehicleLabel: "Argo" })).toBe(
      `${PREFIX}Argo${SUFFIX}`,
    );
  });

  it("faz trim", () => {
    expect(renderKmPromptText({ vehicleLabel: "  Argo  " })).toBe(
      `${PREFIX}Argo${SUFFIX}`,
    );
  });

  it("colapsa múltiplos espaços", () => {
    expect(renderKmPromptText({ vehicleLabel: "Fiat   Argo\t2023" })).toBe(
      `${PREFIX}Fiat Argo 2023${SUFFIX}`,
    );
  });

  it("remove caracteres de controle", () => {
    expect(renderKmPromptText({ vehicleLabel: "Arg\u0007o\u0000" })).toBe(
      `${PREFIX}Arg o${SUFFIX}`,
    );
  });

  it("label vazia → fallback carro", () => {
    expect(renderKmPromptText({ vehicleLabel: "" })).toBe(
      `${PREFIX}carro${SUFFIX}`,
    );
  });

  it("label apenas whitespace → fallback carro", () => {
    expect(renderKmPromptText({ vehicleLabel: "   \t\n  " })).toBe(
      `${PREFIX}carro${SUFFIX}`,
    );
  });

  it("label acima de 60 caracteres é truncada", () => {
    const long = "A".repeat(120);
    const out = renderKmPromptText({ vehicleLabel: long });
    // 60 A's
    expect(out).toBe(`${PREFIX}${"A".repeat(60)}${SUFFIX}`);
  });

  it("é determinística", () => {
    const a = renderKmPromptText({ vehicleLabel: "Argo" });
    const b = renderKmPromptText({ vehicleLabel: "Argo" });
    expect(a).toBe(b);
  });

  it("não injeta emoji, menu, link ou plano", () => {
    const out = renderKmPromptText({ vehicleLabel: "Argo" });
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).not.toMatch(/plano|ativa|premium|app/i);
    expect(out).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
