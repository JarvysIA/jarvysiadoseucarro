// Build 5.7F2E1A.5-CLEANUP — Testes de wiring da fábrica
// createConfirmedExpenseCreateDeps. Mirror estrutural de deps.test.ts (KM).
// Sem banco, sem Deno, sem env. Usa um client fake com .rpc() para provar
// que o Repository real é ligado corretamente ao executeConfirmedExpenseCreate.

import { describe, test, expect } from "bun:test";

import { createConfirmedExpenseCreateDeps } from "../expense-deps.ts";
import { WhatsappExpenseActionRepository } from "../expense-repository.ts";
import { executeConfirmedExpenseCreate } from "../expense-service.ts";
import type {
  ConfirmedExpenseCreateInput,
  ConfirmedExpenseCreateLogFields,
} from "../expense-types.ts";

type RpcCall = { fn: string; params: Record<string, unknown> };

function makeFakeClient(response: { data: unknown; error: unknown }) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      return response as { data: unknown; error: null };
    },
  };
  return { client, calls };
}

const VALID_UUID = "00000000-0000-0000-0000-000000000001";

function baseInput(
  overrides: Partial<ConfirmedExpenseCreateInput> = {},
): ConfirmedExpenseCreateInput {
  return {
    draftId: VALID_UUID,
    conversationStateId: VALID_UUID,
    confirmationMessageId: VALID_UUID,
    sourceMessageId: VALID_UUID,
    queueItemId: VALID_UUID,
    userId: VALID_UUID,
    contactId: VALID_UUID,
    vehicleId: VALID_UUID,
    categoria: "Combustível",
    valor: 123.45,
    descricao: null,
    expectedStateVersion: 1,
    orchestratorVersion: "v1",
    ...overrides,
  };
}

describe("createConfirmedExpenseCreateDeps", () => {
  test("instancia deps.executor como WhatsappExpenseActionRepository real", () => {
    const { client } = makeFakeClient({ data: null, error: null });
    const deps = createConfirmedExpenseCreateDeps(client);
    expect(deps.executor).toBeInstanceOf(WhatsappExpenseActionRepository);
    expect(deps.logger).toBeUndefined();
    expect(deps.clock).toBeUndefined();
  });

  test("propaga logger e clock opcionais", () => {
    const { client } = makeFakeClient({ data: null, error: null });
    const logger = { log: (_f: ConfirmedExpenseCreateLogFields) => {} };
    const clock = () => 42;
    const deps = createConfirmedExpenseCreateDeps(client, { logger, clock });
    expect(deps.logger).toBe(logger);
    expect(deps.clock).toBe(clock);
  });

  test("wiring ponta a ponta: executeConfirmedExpenseCreate -> Repository -> client.rpc (applied)", async () => {
    const { client, calls } = makeFakeClient({
      data: {
        kind: "applied",
        actionExecutionId: VALID_UUID,
        despesaId: VALID_UUID,
        valor: 123.45,
        categoria: "Combustível",
      },
      error: null,
    });
    const deps = createConfirmedExpenseCreateDeps(client);
    const result = await executeConfirmedExpenseCreate(baseInput(), deps);

    expect(calls.length).toBe(1);
    expect(calls[0].fn).toBe("execute_whatsapp_expense_create");
    expect(calls[0].params).toMatchObject({
      p_draft_id: VALID_UUID,
      p_categoria: "Combustível",
      p_valor: 123.45,
      p_expected_state_version: 1,
      p_orchestrator_version: "v1",
    });
    expect(result).toEqual({
      kind: "completed",
      actionExecutionId: VALID_UUID,
      despesaId: VALID_UUID,
      valor: 123.45,
      categoria: "Combustível",
    });
  });

  test("wiring propaga rejected da RPC pro service", async () => {
    const { client } = makeFakeClient({
      data: { kind: "rejected", reason: "vehicle_not_owned" },
      error: null,
    });
    const deps = createConfirmedExpenseCreateDeps(client);
    const result = await executeConfirmedExpenseCreate(baseInput(), deps);
    expect(result).toEqual({ kind: "rejected", reason: "vehicle_not_owned" });
  });

  test("wiring: erro do Repository vira outcome_unknown no service", async () => {
    const { client } = makeFakeClient({
      data: null,
      error: { message: "boom", code: "XX000" },
    });
    const deps = createConfirmedExpenseCreateDeps(client);
    const result = await executeConfirmedExpenseCreate(baseInput(), deps);
    expect(result.kind).toBe("outcome_unknown");
  });
});
