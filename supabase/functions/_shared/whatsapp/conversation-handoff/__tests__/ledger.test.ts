import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_HANDOFF_RESERVATION_TTL_SECONDS,
  completeConversationHandoffExecution,
  failConversationHandoffExecution,
  markConversationHandoffInvoking,
  reserveConversationHandoffExecution,
} from "../ledger.ts";
import type { RpcInvoker, SupabaseLike } from "../../orchestrator/repository.ts";

// Mock estrutural mínimo — só client.rpc é usado por ledger.ts. Mesmo padrão
// de cast pontual (não any/as unknown as) já usado em
// orchestrator/__tests__/repository.test.ts (makeCtxClient).
function makeClient(invoker: RpcInvoker): SupabaseLike {
  return { rpc: invoker };
}

function jsonInvoker(data: unknown): RpcInvoker {
  return (async () => ({ data, error: null })) as RpcInvoker;
}

function errorInvoker(message: string, code?: string): RpcInvoker {
  return (async () => ({
    data: null,
    error: { message, code: code ?? null },
  })) as RpcInvoker;
}

function throwingInvoker(message: string): RpcInvoker {
  return (async () => {
    throw new Error(message);
  }) as RpcInvoker;
}

type CapturedCall = { fn: string; params: Record<string, unknown> };

function capturingInvoker(data: unknown): { invoker: RpcInvoker; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const invoker = (async (fn: string, params: Record<string, unknown>) => {
    calls.push({ fn, params });
    return { data, error: null };
  }) as RpcInvoker;
  return { invoker, calls };
}

const RESERVE_PARAMS = {
  sourceMessageId: "11111111-1111-1111-1111-111111111111",
  segment: "primary" as const,
  contactId: "22222222-2222-2222-2222-222222222222",
  userId: "33333333-3333-3333-3333-333333333333",
  vehicleId: "44444444-4444-4444-4444-444444444444",
  ttlSeconds: CONVERSATION_HANDOFF_RESERVATION_TTL_SECONDS,
};

const RESERVATION_ID = "55555555-5555-5555-5555-555555555555";

describe("Bloco A — reserve, caminho feliz", () => {
  it("1. primeira reserva de um par novo → isNewReservation:true, status:'reserved'", async () => {
    const client = makeClient(
      jsonInvoker([{ id: RESERVATION_ID, status: "reserved", is_new_reservation: true }]),
    );

    const result = await reserveConversationHandoffExecution(client, RESERVE_PARAMS);

    expect(result).toEqual({
      id: RESERVATION_ID,
      status: "reserved",
      isNewReservation: true,
    });
  });

  it("2. RPC retorna linha 'reserved' não expirada existente → isNewReservation:false", async () => {
    const client = makeClient(
      jsonInvoker([{ id: RESERVATION_ID, status: "reserved", is_new_reservation: false }]),
    );

    const result = await reserveConversationHandoffExecution(client, RESERVE_PARAMS);

    expect(result).toEqual({
      id: RESERVATION_ID,
      status: "reserved",
      isNewReservation: false,
    });
  });

  it("3. RPC retorna linha 'completed' → isNewReservation:false, status:'completed'", async () => {
    const client = makeClient(
      jsonInvoker([{ id: RESERVATION_ID, status: "completed", is_new_reservation: false }]),
    );

    const result = await reserveConversationHandoffExecution(client, RESERVE_PARAMS);

    expect(result).toEqual({
      id: RESERVATION_ID,
      status: "completed",
      isNewReservation: false,
    });
  });

  it("3b. RPC retorna sweep de 'invoking' expirado → isNewReservation:false, status:'failed' (Opção A: nunca reabre invoking expirado)", async () => {
    const client = makeClient(
      jsonInvoker([{ id: RESERVATION_ID, status: "failed", is_new_reservation: false }]),
    );

    const result = await reserveConversationHandoffExecution(client, RESERVE_PARAMS);

    expect(result).toEqual({
      id: RESERVATION_ID,
      status: "failed",
      isNewReservation: false,
    });
  });

  it("3c. RPC retorna sweep de 'reserved' expirado reaberto → isNewReservation:true, status:'reserved' (continua permitido)", async () => {
    const client = makeClient(
      jsonInvoker([{ id: RESERVATION_ID, status: "reserved", is_new_reservation: true }]),
    );

    const result = await reserveConversationHandoffExecution(client, RESERVE_PARAMS);

    expect(result).toEqual({
      id: RESERVATION_ID,
      status: "reserved",
      isNewReservation: true,
    });
  });
});

describe("Bloco B — mark/complete/fail, CAS", () => {
  it("4. markConversationHandoffInvoking CAS bem-sucedido → true", async () => {
    const client = makeClient(jsonInvoker(true));

    const result = await markConversationHandoffInvoking(client, RESERVATION_ID);

    expect(result).toBe(true);
  });

  it("5. markConversationHandoffInvoking CAS falho (RPC retorna false) → false", async () => {
    const client = makeClient(jsonInvoker(false));

    const result = await markConversationHandoffInvoking(client, RESERVATION_ID);

    expect(result).toBe(false);
  });

  it("6. completeConversationHandoffExecution bem-sucedido → true", async () => {
    const client = makeClient(jsonInvoker(true));

    const result = await completeConversationHandoffExecution(client, RESERVATION_ID, "success");

    expect(result).toBe(true);
  });

  it("7. failConversationHandoffExecution bem-sucedido com resultStatus tipado sem 'success' → true", async () => {
    const client = makeClient(jsonInvoker(true));

    const result = await failConversationHandoffExecution(client, RESERVATION_ID, "blocked");

    expect(result).toBe(true);
  });
});

describe("Bloco C — fail-closed em erro de RPC", () => {
  it("8. client.rpc lança exceção em reserve → retorna null, não propaga", async () => {
    const client = makeClient(throwingInvoker("boom-reserve"));

    const result = await reserveConversationHandoffExecution(client, RESERVE_PARAMS);

    expect(result).toBeNull();
  });

  it("9. client.rpc retorna {error} em mark → false", async () => {
    const client = makeClient(errorInvoker("boom-mark", "P0001"));

    const result = await markConversationHandoffInvoking(client, RESERVATION_ID);

    expect(result).toBe(false);
  });

  it("10. client.rpc retorna {error} em complete → false", async () => {
    const client = makeClient(errorInvoker("boom-complete", "P0001"));

    const result = await completeConversationHandoffExecution(client, RESERVATION_ID, "success");

    expect(result).toBe(false);
  });

  it("11. client.rpc retorna {error} em fail → false", async () => {
    const client = makeClient(errorInvoker("boom-fail", "P0001"));

    const result = await failConversationHandoffExecution(
      client,
      RESERVATION_ID,
      "permanent_failure",
    );

    expect(result).toBe(false);
  });

  it("12. nenhum retorno vaza error.message/stack em erro de RPC (reserve/mark/complete/fail)", async () => {
    const secretMarker = "SECRET_ERROR_MARKER_9f3c";

    const reserveResult = await reserveConversationHandoffExecution(
      makeClient(errorInvoker(secretMarker, "P0001")),
      RESERVE_PARAMS,
    );
    const markResult = await markConversationHandoffInvoking(
      makeClient(errorInvoker(secretMarker, "P0001")),
      RESERVATION_ID,
    );
    const completeResult = await completeConversationHandoffExecution(
      makeClient(errorInvoker(secretMarker, "P0001")),
      RESERVATION_ID,
      "success",
    );
    const failResult = await failConversationHandoffExecution(
      makeClient(errorInvoker(secretMarker, "P0001")),
      RESERVATION_ID,
      "blocked",
    );
    const thrownResult = await reserveConversationHandoffExecution(
      makeClient(throwingInvoker(secretMarker)),
      RESERVE_PARAMS,
    );

    for (const value of [reserveResult, markResult, completeResult, failResult, thrownResult]) {
      expect(JSON.stringify(value)).not.toContain(secretMarker);
    }
  });
});

describe("Bloco D — tipos", () => {
  it("13. TypeScript recusa passar 'success' para failConversationHandoffExecution", async () => {
    const client = makeClient(jsonInvoker(true));
    // @ts-expect-error — "success" foi deliberadamente excluído do parâmetro
    // resultStatus de failConversationHandoffExecution via Exclude<...,"success">.
    await failConversationHandoffExecution(client, RESERVATION_ID, "success");
    expect(true).toBe(true);
  });

  it("14. constante CONVERSATION_HANDOFF_RESERVATION_TTL_SECONDS existe e é exatamente 45", () => {
    expect(CONVERSATION_HANDOFF_RESERVATION_TTL_SECONDS).toBe(45);
  });

  it("15. assinatura de reserveConversationHandoffExecution aceita vehicleId: null", async () => {
    const { invoker, calls } = capturingInvoker([
      { id: RESERVATION_ID, status: "reserved", is_new_reservation: true },
    ]);
    const client = makeClient(invoker);

    const result = await reserveConversationHandoffExecution(client, {
      ...RESERVE_PARAMS,
      vehicleId: null,
    });

    expect(result?.isNewReservation).toBe(true);
    expect(calls[0]?.params.p_vehicle_id).toBeNull();
  });
});

describe("Bloco E — pureza e ausência de escrita direta", () => {
  const ledgerSource = readFileSync(
    fileURLToPath(new URL("../ledger.ts", import.meta.url)),
    "utf8",
  );
  const migrationSource = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../migrations/20260813130536_whatsapp_conversation_handoff_ledger.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("16. ledger.ts não faz escrita direta: zero .insert(/.update(/.delete(/.upsert(", () => {
    expect(ledgerSource).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("17. ledger.ts não importa fetch/Supabase createClient/Deno.env", () => {
    expect(ledgerSource).not.toMatch(/\bfetch\(/);
    expect(ledgerSource).not.toMatch(/createClient/);
    expect(ledgerSource).not.toMatch(/Deno\.env/);
  });

  it("18. zero any/as any/as unknown as/@ts-ignore/@ts-nocheck em ledger.ts", () => {
    expect(ledgerSource).not.toMatch(/\bany\b|as any|as unknown as|@ts-ignore|@ts-nocheck/);
  });

  it("19. ledger.ts não hardcoda o número 45 fora da definição da constante", () => {
    const constantDefinitionLine = "CONVERSATION_HANDOFF_RESERVATION_TTL_SECONDS = 45";
    const remainingLines = ledgerSource
      .split("\n")
      .filter((line) => !line.includes(constantDefinitionLine))
      .join("\n");
    expect(remainingLines).not.toContain("45");
  });

  it("20. migration contém a correção em fail_conversation_handoff_execution rejeitando 'success'", () => {
    const failFunctionMatch = migrationSource.match(
      /CREATE OR REPLACE FUNCTION public\.fail_conversation_handoff_execution[\s\S]*?\$fn\$;/,
    );
    expect(failFunctionMatch).not.toBeNull();
    const failFunctionBody = failFunctionMatch?.[0] ?? "";
    expect(failFunctionBody).toContain("'blocked', 'transient_failure', 'permanent_failure'");
    expect(failFunctionBody).not.toContain("'success'");

    const completeFunctionMatch = migrationSource.match(
      /CREATE OR REPLACE FUNCTION public\.complete_conversation_handoff_execution[\s\S]*?\$fn\$;/,
    );
    expect(completeFunctionMatch).not.toBeNull();
    const completeFunctionBody = completeFunctionMatch?.[0] ?? "";
    expect(completeFunctionBody).toContain(
      "'success', 'blocked', 'transient_failure', 'permanent_failure'",
    );
  });
});
