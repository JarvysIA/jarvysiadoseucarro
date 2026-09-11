// Build Financial-Dashboard — testes da agregação pura usada por
// getFinancialSummaryFn (agrupar pagamentos por tipo_produto / eventos de
// IA por event_type). Sem precedente de teste de createServerFn().handler()
// neste arquivo (nem no resto do projeto) — não inventado aqui, só a lógica
// pura extraída é coberta. Importa de financial-aggregation.ts (não de
// admin-users.functions.ts) porque este último importa requireSupabaseAuth
// no topo, que puxa @supabase/supabase-js — módulo ausente neste sandbox,
// o que quebraria o carregamento do arquivo de teste inteiro. Matchers do
// shim local (bun-test.d.ts): só toBe/toContain/not.toBe/not.toContain.

import { describe, expect, test } from "bun:test";
import { aggregateAiUsageByType, aggregateRevenueByType } from "../financial-aggregation";

describe("aggregateRevenueByType", () => {
  test("soma valores do mesmo tipo_produto e mantém tipos separados", () => {
    const result = aggregateRevenueByType([
      { tipo_produto: "ativacao", valor: 100 },
      { tipo_produto: "historico", valor: 50 },
      { tipo_produto: "ativacao", valor: 59.4 },
    ]);

    expect(result.length).toBe(2);
    const ativacao = result.find((r) => r.tipo === "ativacao");
    const historico = result.find((r) => r.tipo === "historico");
    expect(ativacao?.valor).toBe(159.4);
    expect(historico?.valor).toBe(50);
  });

  test("lista vazia devolve array vazio", () => {
    expect(aggregateRevenueByType([]).length).toBe(0);
  });

  test("tipo_produto desconhecido não quebra — só aparece com o valor bruto", () => {
    const result = aggregateRevenueByType([{ tipo_produto: "novo_tipo_futuro", valor: 10 }]);
    expect(result.length).toBe(1);
    expect(result[0]?.tipo).toBe("novo_tipo_futuro");
    expect(result[0]?.valor).toBe(10);
  });
});

describe("aggregateAiUsageByType", () => {
  test("conta ocorrências por event_type", () => {
    const result = aggregateAiUsageByType([
      { event_type: "ocr_receipt" },
      { event_type: "dr_jarvys_chat" },
      { event_type: "ocr_receipt" },
      { event_type: "ocr_receipt" },
    ]);

    expect(result.length).toBe(2);
    const ocr = result.find((r) => r.tipo === "ocr_receipt");
    const chat = result.find((r) => r.tipo === "dr_jarvys_chat");
    expect(ocr?.count).toBe(3);
    expect(chat?.count).toBe(1);
  });

  test("lista vazia devolve array vazio", () => {
    expect(aggregateAiUsageByType([]).length).toBe(0);
  });
});
