// Security-Audit-Fixes — testes de unlockHistory (fix do bypass: destravar
// history_locked sem checar pagamento do Histórico Premium).
//
// Mesmo precedente de saque-padrinho.test.ts: client estrutural injetado
// via DI, nunca mock.module(). Matchers do shim local (bun-test.d.ts): só
// toBe/toContain/not.toBe/not.toContain.

import { describe, expect, test } from "bun:test";
import { unlockHistory, type UnlockHistoryClient } from "../unlock-history";

function makeMockClient(opts: {
  ownerId?: string | null;
  hasPaidHistorico?: boolean;
}) {
  const calls = {
    veiculoUpdate: [] as { history_locked: boolean }[],
  };
  const veiculoRow = opts.ownerId === undefined ? null : { user_id: opts.ownerId as string };

  const client = {
    from(table: string) {
      if (table === "veiculos") {
        return {
          select: (_cols: string) => {
            const builder = {
              eq: (_c: string, _v: unknown) => builder,
              maybeSingle: async () => ({ data: veiculoRow, error: null }),
            };
            return builder;
          },
          update: (row: { history_locked: boolean }) => {
            const updateBuilder = {
              eq: async (_c: string, _v: unknown) => {
                calls.veiculoUpdate.push(row);
                return { error: null };
              },
            };
            return updateBuilder;
          },
        };
      }
      // pagamentos_pix
      const builder = {
        eq: (_c: string, _v: unknown) => builder,
        limit: (_n: number) => builder,
        maybeSingle: async () => ({
          data: opts.hasPaidHistorico ? { id: "pay-1" } : null,
          error: null,
        }),
      };
      return { select: (_cols: string) => builder };
    },
  } as unknown as UnlockHistoryClient;

  return { client, calls };
}

describe("unlockHistory", () => {
  test("rejeita se o veículo não pertence ao usuário", async () => {
    const { client, calls } = makeMockClient({ ownerId: "outro-user", hasPaidHistorico: true });
    const result = await unlockHistory("v1", "user-1", client);
    expect(result.ok).toBe(false);
    expect(calls.veiculoUpdate.length).toBe(0);
  });

  test("rejeita sem pagamento confirmado do Histórico Premium", async () => {
    const { client, calls } = makeMockClient({ ownerId: "user-1", hasPaidHistorico: false });
    const result = await unlockHistory("v1", "user-1", client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.erro).toContain("Pagamento");
    }
    expect(calls.veiculoUpdate.length).toBe(0);
  });

  test("destrava quando dono confere e pagamento pago existe", async () => {
    const { client, calls } = makeMockClient({ ownerId: "user-1", hasPaidHistorico: true });
    const result = await unlockHistory("v1", "user-1", client);
    expect(result.ok).toBe(true);
    expect(calls.veiculoUpdate.length).toBe(1);
    expect(calls.veiculoUpdate[0].history_locked).toBe(false);
  });
});
