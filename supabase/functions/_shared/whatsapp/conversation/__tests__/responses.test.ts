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
});
