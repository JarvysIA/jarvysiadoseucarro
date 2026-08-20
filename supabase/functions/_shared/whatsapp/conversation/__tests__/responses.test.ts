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
  "vehicle_access_restricted",
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
  "expense_create_completed_with_km_prompt",
  "expense_create_retry_needed",
] as const;

// Guarda de linguagem: nunca prometer recursos, expor infra ou erros internos.
const FORBIDDEN = [
  "api",
  "endpoint",
  "banco",
  "database",
  "queue",
  "fila",
  "provider",
  "z-api",
  "zapi",
  "supabase",
  "webhook",
  "erro interno",
  "internal error",
  "500",
  "undefined",
  "cron",
  "rate limit",
  "openai",
  "gpt",
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

  test("vehicle_access_restricted uses the safe deterministic message", () => {
    expect(renderResponse("vehicle_access_restricted", {})).toBe(
      "Essa ação não está disponível por aqui agora.",
    );
  });

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

  // Atualizado no P0-3B-R: expense_category_prompt virou uma pergunta aberta
  // ("essa despesa foi o quê?"), sem lista fechada de categorias — options
  // não é mais lido por este case, mesmo se presente em responseParams.
  test("expense_category_prompt uses valor only (pergunta aberta, sem lista fechada de categorias)", () => {
    const msg = renderResponse("expense_category_prompt", {
      valor: 30,
      options: ["Manutenção", "Lavagem"],
    });
    expect(msg).toBe(
      "Entendi o valor de R$ 30,00. Pra eu registrar certinho, essa despesa foi o quê?",
    );
    expect(msg).not.toContain("Manutenção");
    expect(msg).not.toContain("Lavagem");
  });

  // I5 — microcopy corrigida: não afirma "Registrei"/"registrada" antes da
  // confirmação real do usuário acontecer.
  test("expense_item_specification_prompt (revision_item_unspecified) texto exato", () => {
    const msg = renderResponse("expense_item_specification_prompt", {
      valor: 30,
      itemSpecificationTrigger: "revision_item_unspecified",
    });
    expect(msg).toBe(
      "Entendi que foi revisão, R$ 30,00. Qual item você trocou? (óleo, filtro, pastilha, correia...)",
    );
  });

  test("expense_item_specification_prompt (ramo default, ar-condicionado) texto exato", () => {
    const msg = renderResponse("expense_item_specification_prompt", { valor: 30 });
    expect(msg).toBe(
      "Entendi o valor de R$ 30,00. Foi o filtro do ar-condicionado, ou foi conserto/carga de gás?",
    );
  });

  test("expense_value_prompt texto exato", () => {
    const msg = renderResponse("expense_value_prompt", { categoria: "Revisão" });
    expect(msg).toBe("Show, entendi que foi Revisão! Só falta o valor — quanto foi?");
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

  // I4a — textos fixos, sem interpolação (comparação de string completa).
  test("expense_quote_acknowledged uses the exact approved text", () => {
    expect(renderResponse("expense_quote_acknowledged", {})).toBe(
      "Entendi, é uma pergunta de valor! Ainda não tenho essa informação pra te passar por aqui, mas assim que você fizer o serviço, é só me contar quanto ficou que eu registro 😉",
    );
  });

  test("expense_future_service_acknowledged uses the exact approved text", () => {
    expect(renderResponse("expense_future_service_acknowledged", {})).toBe(
      "Entendi, você ainda vai fazer isso! Quando for concluído, me conta que eu registro certinho.",
    );
  });

  test("expense_technical_question_acknowledged uses the exact approved text", () => {
    expect(renderResponse("expense_technical_question_acknowledged", {})).toBe(
      "Essa é uma pergunta técnica — ainda não consigo responder isso por aqui, mas em breve vou conseguir te ajudar com esse tipo de dúvida também.",
    );
  });

  test("expense_occurrence_clarification uses the exact approved text", () => {
    expect(renderResponse("expense_occurrence_clarification", {})).toBe(
      "Isso já aconteceu (você já pagou/fez) ou é algo que ainda vai rolar?",
    );
  });
});
