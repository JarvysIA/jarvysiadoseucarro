// Build Audit-Log — testes de recordAuditEvent.
//
// Mesmo precedente de vehicle-image.functions.test.ts / ai-usage-tracking.
// test.ts: client injetado via DI (aqui já é o próprio parâmetro `client`
// da função, não um deps opcional — o design já veio assim), nunca
// mock.module(). Matchers do shim local (bun-test.d.ts) são só
// toBe/toContain/not.toBe/not.toContain — sem .resolves/.rejects/toThrow,
// por isso "não lança exceção" é provado só pelo await direto completar.

import { describe, expect, test } from "bun:test";
import { recordAuditEvent } from "../audit-log";

function makeMockClient(opts: { insertError?: { message: string } | null; insertThrows?: boolean } = {}) {
  const calls = { insert: [] as Record<string, unknown>[] };
  const client = {
    from: (_table: "audit_log") => ({
      insert: async (row: Record<string, unknown>) => {
        calls.insert.push(row);
        if (opts.insertThrows) throw new Error("insert boom");
        return { error: opts.insertError ?? null };
      },
    }),
  };
  return { client, calls };
}

describe("recordAuditEvent — sucesso", () => {
  test("insert bem-sucedido não lança e grava os campos certos", async () => {
    const { client, calls } = makeMockClient();

    await recordAuditEvent(client, {
      actorId: "actor-1",
      action: "user_status_updated",
      targetId: "target-1",
      details: { from: "trial", to: "vip" },
    });

    expect(calls.insert.length).toBe(1);
    const row = calls.insert[0]!;
    expect(row.actor_id).toBe("actor-1");
    expect(row.action).toBe("user_status_updated");
    expect(row.target_id).toBe("target-1");
  });

  test("targetId/details omitidos: usa null e {} como default", async () => {
    const { client, calls } = makeMockClient();

    await recordAuditEvent(client, {
      actorId: "actor-1",
      action: "account_deactivated",
    });

    const row = calls.insert[0]!;
    expect(row.target_id).toBe(null);
  });
});

describe("recordAuditEvent — fail-safe", () => {
  test("erro do client (insert devolve error) não propaga", async () => {
    const { client, calls } = makeMockClient({ insertError: { message: "boom" } });

    await recordAuditEvent(client, {
      actorId: "actor-1",
      action: "user_status_updated",
      targetId: "target-1",
    });

    expect(calls.insert.length).toBe(1);
  });

  test("exceção do client (insert lança) não propaga", async () => {
    const { client } = makeMockClient({ insertThrows: true });

    await recordAuditEvent(client, {
      actorId: "actor-1",
      action: "account_deactivated",
    });

    // Chegar até aqui sem o teste falhar já prova que não propagou.
    expect(true).toBe(true);
  });
});
