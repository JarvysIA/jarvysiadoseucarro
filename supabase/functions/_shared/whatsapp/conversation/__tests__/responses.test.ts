import { describe, expect, test } from "bun:test";
import { renderResponse } from "../responses.ts";

const ALL_KEYS = [
  "greeting",
  "help",
  "nothing_to_confirm",
  "nothing_to_cancel",
  "task_cancelled",
  "conversation_reset",
  "vehicle_selected",
  "vehicle_ambiguous",
  "vehicle_not_found",
  "no_eligible_vehicle",
  "fallback_first",
  "fallback_second",
  "fallback_reset",
  "km_update_applied",
  "km_update_no_change",
  "km_update_retry_needed",
  "expense_category_prompt",
  "expense_create_confirmation",
  "expense_create_correction_confirmation",
  "expense_create_completed",
  "expense_create_retry_needed",
] as const;

// Guarda de linguagem: nunca prometer recursos, expor infra ou erros internos.
const FORBIDDEN = [
  "api", "endpoint", "banco", "database", "queue", "fila",
  "provider", "z-api", "zapi", "supabase", "webhook",
  "erro interno", "internal error", "500", "undefined",
  "cron", "rate limit", "openai", "gpt",
];

describe("renderResponse guardrails", () => {
  for (const key of ALL_KEYS) {
    test(`${key} respects language rules`, () => {
      const msg = renderResponse(key, {
        vehicleLabel: "Fiat Argo",
        options: ["Fiat Argo", "Fiat Uno"],
      });
      expect(msg.length).toBeGreaterThan(0);
      expect(msg.length).toBeLessThanOrEqual(280);
      const low = msg.toLowerCase();
      for (const bad of FORBIDDEN) {
        expect(low.includes(bad)).toBe(false);
      }
      // no mais de um emoji — heurística: no máximo 1 char não-ASCII sequência de pictogramas
      const emojiCount = (msg.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
      expect(emojiCount).toBeLessThanOrEqual(1);
    });
  }

  test("vehicle_selected uses label", () => {
    expect(renderResponse("vehicle_selected", { vehicleLabel: "Fiat Argo" })).toContain(
      "Fiat Argo",
    );
  });

  test("vehicle_ambiguous joins options", () => {
    const msg = renderResponse("vehicle_ambiguous", { options: ["Fiat Argo", "Fiat Uno"] });
    expect(msg).toContain("Fiat Argo");
    expect(msg).toContain("Fiat Uno");
  });

  test("km_update_applied uses label and km", () => {
    const msg = renderResponse("km_update_applied", { vehicleLabel: "Fiat Argo", newKm: 45000 });
    expect(msg).toContain("Fiat Argo");
    expect(msg).toContain("45000");
  });

  test("km_update_no_change uses label and km", () => {
    const msg = renderResponse("km_update_no_change", { vehicleLabel: "Fiat Argo", newKm: 45000 });
    expect(msg).toContain("Fiat Argo");
    expect(msg).toContain("45000");
  });

  test("km_update_retry_needed does not depend on params", () => {
    const msg = renderResponse("km_update_retry_needed", {});
    expect(msg.length).toBeGreaterThan(0);
  });

  test("expense_category_prompt uses valor and options", () => {
    const msg = renderResponse("expense_category_prompt", {
      valor: 30,
      options: ["Manutenção", "Lavagem"],
    });
    expect(msg).toContain("R$ 30,00");
    expect(msg).toContain("Manutenção");
    expect(msg).toContain("Lavagem");
  });

  test("expense_create_confirmation uses valor/categoria/label", () => {
    const msg = renderResponse("expense_create_confirmation", {
      valor: 149.9,
      categoria: "Combustível",
      vehicleLabel: "Fiat Argo",
    });
    expect(msg).toContain("R$ 149,90");
    expect(msg).toContain("Combustível");
    expect(msg).toContain("Fiat Argo");
  });

  test("expense_create_correction_confirmation uses valor/categoria/label", () => {
    const msg = renderResponse("expense_create_correction_confirmation", {
      valor: 149.9,
      categoria: "Combustível",
      vehicleLabel: "Fiat Argo",
    });
    expect(msg).toContain("R$ 149,90");
    expect(msg).toContain("Combustível");
    expect(msg).toContain("Fiat Argo");
  });

  test("expense_create_completed uses valor/categoria/label", () => {
    const msg = renderResponse("expense_create_completed", {
      valor: 149.9,
      categoria: "Combustível",
      vehicleLabel: "Fiat Argo",
    });
    expect(msg).toContain("R$ 149,90");
    expect(msg).toContain("Combustível");
    expect(msg).toContain("Fiat Argo");
  });

  test("expense_create_retry_needed does not depend on params", () => {
    const msg = renderResponse("expense_create_retry_needed", {});
    expect(msg.length).toBeGreaterThan(0);
  });

  test("formatValor formats thousands and cents", () => {
    const msg = renderResponse("expense_create_confirmation", {
      valor: 1234.5,
      categoria: "Manutenção",
      vehicleLabel: "Fiat Uno",
    });
    expect(msg).toContain("R$ 1.234,50");
  });

  test("formatValor with missing/invalid value does not throw", () => {
    const msg = renderResponse("expense_create_confirmation", {
      categoria: "Combustível",
      vehicleLabel: "Fiat Argo",
    });
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toContain("?");
  });
});
