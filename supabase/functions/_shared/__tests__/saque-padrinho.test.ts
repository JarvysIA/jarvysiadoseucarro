// Build Saque-Padrinho — testes do espelho Deno de processarSaquePadrinho
// (supabase/functions/_shared/saque-padrinho.ts). Mesmos 3 cenários do
// lado do app (src/lib/__tests__/saque-padrinho.test.ts) — mantidos
// separados porque os dois arquivos são intencionalmente independentes
// (sem import cross-boundary possível entre Deno e o app). Matchers do
// shim local (bun-test.d.ts): só toBe/toContain/not.toBe/not.toContain.

import { describe, expect, test } from "bun:test";
import { processarSaquePadrinho, type SaquePadrinhoClient } from "../saque-padrinho.ts";

function makeMockClient(opts: {
  movStatus?: string;
  pixRecebimento?: string | null;
  saldoReservado?: number;
}) {
  const calls = {
    movUpdate: [] as { status: string }[],
    carteiraUpdate: [] as { saldo_reservado: number }[],
  };
  const movRow = {
    id: "mov-1",
    padrinho_id: "padrinho-1",
    valor: 50,
    status: opts.movStatus ?? "reservado",
  };
  const profileRow = { pix_recebimento: opts.pixRecebimento ?? "12345678900" };
  let carteiraSaldo = opts.saldoReservado ?? 100;

  const client = {
    from(table: string) {
      if (table === "movimentacoes_indicacao") {
        return {
          select: (_cols: string) => {
            const builder = {
              eq: (_c: string, _v: unknown) => builder,
              maybeSingle: async () => ({ data: { ...movRow }, error: null }),
            };
            return builder;
          },
          update: (row: { status: string }) => {
            const updateBuilder = {
              eq: (_c: string, _v: unknown) => updateBuilder,
              select: async (_cols: string) => {
                if (movRow.status !== "reservado") {
                  return { data: [], error: null };
                }
                calls.movUpdate.push(row);
                movRow.status = row.status;
                return { data: [{ id: movRow.id }], error: null };
              },
            };
            return updateBuilder;
          },
        };
      }
      if (table === "profiles") {
        return {
          select: (_cols: string) => {
            const builder = {
              eq: (_c: string, _v: unknown) => builder,
              maybeSingle: async () => ({ data: profileRow, error: null }),
            };
            return builder;
          },
        };
      }
      if (table === "carteiras_indicacao") {
        return {
          select: (_cols: string) => {
            const builder = {
              eq: (_c: string, _v: unknown) => builder,
              maybeSingle: async () => ({ data: { saldo_reservado: carteiraSaldo }, error: null }),
            };
            return builder;
          },
          update: (row: { saldo_reservado: number }) => {
            return {
              eq: async (_c: string, _v: unknown) => {
                calls.carteiraUpdate.push(row);
                carteiraSaldo = row.saldo_reservado;
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`tabela inesperada no mock: ${table}`);
    },
  } as unknown as SaquePadrinhoClient;

  return { client, calls };
}

function makeFetchImpl(opts: { ok: boolean; status?: number; json?: unknown }) {
  const calls: unknown[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: opts.ok,
      status: opts.status ?? (opts.ok ? 200 : 400),
      json: async () =>
        opts.json ?? (opts.ok ? { id: "asaas-transfer-1" } : { errors: [{ description: "saldo insuficiente" }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("processarSaquePadrinho (Deno) — sucesso", () => {
  test("marca pago e decrementa saldo_reservado", async () => {
    const { client, calls } = makeMockClient({});
    const { fetchImpl } = makeFetchImpl({ ok: true });

    const result = await processarSaquePadrinho("mov-1", "api-key", "sandbox", {
      client,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(calls.movUpdate.length).toBe(1);
    expect(calls.carteiraUpdate[0]?.saldo_reservado).toBe(50);
  });
});

describe("processarSaquePadrinho (Deno) — idempotência", () => {
  test("movimentação já paga: não rechama Asaas nem muda nada no banco", async () => {
    const { client, calls } = makeMockClient({ movStatus: "pago" });
    const { fetchImpl, calls: fetchCalls } = makeFetchImpl({ ok: true });

    const result = await processarSaquePadrinho("mov-1", "api-key", "sandbox", {
      client,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(fetchCalls.length).toBe(0);
    expect(calls.movUpdate.length).toBe(0);
  });
});

describe("processarSaquePadrinho (Deno) — falha do Asaas", () => {
  test("Asaas recusa a transferência: não muda nada no banco", async () => {
    const { client, calls } = makeMockClient({});
    const { fetchImpl } = makeFetchImpl({ ok: false, status: 400 });

    const result = await processarSaquePadrinho("mov-1", "api-key", "sandbox", {
      client,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.erro).toContain("Asaas /transfers 400");
    }
    expect(calls.movUpdate.length).toBe(0);
  });
});
