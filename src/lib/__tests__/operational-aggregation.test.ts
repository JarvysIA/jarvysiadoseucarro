// Build Operational-Monitoring — testes da agregação pura usada por
// getOperationalHealthFn (pagamentos por status / detecção de 'pendente'
// travado há mais de 1h). Importa de operational-aggregation.ts (não de
// admin-users.functions.ts) pelo mesmo motivo documentado em
// financial-aggregation.test.ts: este último importa requireSupabaseAuth
// no topo, que puxa @supabase/supabase-js — módulo ausente neste sandbox.
// Matchers do shim local (bun-test.d.ts): só toBe/toContain/not.toBe/not.toContain.

import { describe, expect, test } from "bun:test";
import {
  aggregatePaymentsByStatus,
  countStuckPendingPayments,
} from "../operational-aggregation";

describe("aggregatePaymentsByStatus", () => {
  test("conta ocorrências por status", () => {
    const result = aggregatePaymentsByStatus([
      { status: "pago" },
      { status: "expirado" },
      { status: "pago" },
      { status: "pago" },
    ]);

    expect(result.length).toBe(2);
    const pago = result.find((r) => r.status === "pago");
    const expirado = result.find((r) => r.status === "expirado");
    expect(pago?.count).toBe(3);
    expect(expirado?.count).toBe(1);
  });

  test("lista vazia devolve array vazio", () => {
    expect(aggregatePaymentsByStatus([]).length).toBe(0);
  });
});

describe("countStuckPendingPayments", () => {
  const NOW = new Date("2026-09-13T12:00:00Z").getTime();

  test("conta só 'pendente' com created_at há mais de 1h", () => {
    const result = countStuckPendingPayments(
      [
        { status: "pendente", created_at: "2026-09-13T10:00:00Z" }, // 2h atrás — travado
        { status: "pendente", created_at: "2026-09-13T11:50:00Z" }, // 10min atrás — não travado
        { status: "pago", created_at: "2026-09-13T09:00:00Z" }, // não é pendente
      ],
      NOW,
    );
    expect(result).toBe(1);
  });

  test("nenhum pendente travado devolve 0", () => {
    const result = countStuckPendingPayments(
      [{ status: "pendente", created_at: "2026-09-13T11:55:00Z" }],
      NOW,
    );
    expect(result).toBe(0);
  });

  test("lista vazia devolve 0", () => {
    expect(countStuckPendingPayments([], NOW)).toBe(0);
  });
});
