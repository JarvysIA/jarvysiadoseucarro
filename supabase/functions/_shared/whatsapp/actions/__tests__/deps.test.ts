// Build 5.7F2E1D — Testes de wiring da fábrica createConfirmedKmUpdateDeps.
// Sem banco, sem Deno, sem env. Usa um client fake com .rpc() para provar
// que o Repository real é ligado corretamente ao executeConfirmedKmUpdate.

import { describe, test, expect } from "bun:test";

import { createConfirmedKmUpdateDeps } from "../deps.ts";
import { WhatsappKmActionRepository } from "../repository.ts";
import { executeConfirmedKmUpdate } from "../service.ts";
import type {
  ConfirmedKmUpdateInput,
  ConfirmedKmUpdateLogFields,
} from "../types.ts";

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

function baseInput(overrides: Partial<ConfirmedKmUpdateInput> = {}): ConfirmedKmUpdateInput {
  return {
    draftId: VALID_UUID,
    conversationStateId: VALID_UUID,
    confirmationMessageId: VALID_UUID,
    sourceMessageId: VALID_UUID,
    queueItemId: VALID_UUID,
    userId: VALID_UUID,
    contactId: VALID_UUID,
    vehicleId: VALID_UUID,
    expectedPreviousKm: 100,
    newKm: 500,
    correctionConfirmed: false,
    expectedStateVersion: 1,
    orchestratorVersion: "v1",
    ...overrides,
  };
}

describe("createConfirmedKmUpdateDeps", () => {
  test("instancia deps.executor como WhatsappKmActionRepository real", () => {
    const { client } = makeFakeClient({ data: null, error: null });
    const deps = createConfirmedKmUpdateDeps(client);
    expect(deps.executor).toBeInstanceOf(WhatsappKmActionRepository);
    expect(deps.logger).toBeUndefined();
    expect(deps.clock).toBeUndefined();
  });

  test("propaga logger e clock opcionais", () => {
    const { client } = makeFakeClient({ data: null, error: null });
    const logger = { log: (_f: ConfirmedKmUpdateLogFields) => {} };
    const clock = () => 42;
    const deps = createConfirmedKmUpdateDeps(client, { logger, clock });
    expect(deps.logger).toBe(logger);
    expect(deps.clock).toBe(clock);
  });

  test("wiring ponta a ponta: executeConfirmedKmUpdate -> Repository -> client.rpc (applied)", async () => {
    const { client, calls } = makeFakeClient({
      data: {
        kind: "applied",
        actionExecutionId: VALID_UUID,
        previousKm: 100,
        newKm: 500,
      },
      error: null,
    });
    const deps = createConfirmedKmUpdateDeps(client);
    const result = await executeConfirmedKmUpdate(baseInput(), deps);

    expect(calls.length).toBe(1);
    expect(calls[0].fn).toBe("execute_whatsapp_km_update");
    expect(calls[0].params).toMatchObject({
      p_draft_id: VALID_UUID,
      p_new_km: 500,
      p_expected_previous_km: 100,
      p_is_correction: false,
      p_correction_confirmed: false,
      p_expected_state_version: 1,
      p_orchestrator_version: "v1",
    });
    expect(result).toEqual({
      kind: "completed",
      actionExecutionId: VALID_UUID,
      previousKm: 100,
      newKm: 500,
    });
  });

  test("wiring propaga rejected da RPC pro service", async () => {
    const { client } = makeFakeClient({
      data: { kind: "rejected", reason: "vehicle_not_owned" },
      error: null,
    });
    const deps = createConfirmedKmUpdateDeps(client);
    const result = await executeConfirmedKmUpdate(baseInput(), deps);
    expect(result).toEqual({ kind: "rejected", reason: "vehicle_not_owned" });
  });

  test("wiring: erro do Repository vira outcome_unknown no service", async () => {
    const { client } = makeFakeClient({
      data: null,
      error: { message: "boom", code: "XX000" },
    });
    const deps = createConfirmedKmUpdateDeps(client);
    const result = await executeConfirmedKmUpdate(baseInput(), deps);
    expect(result.kind).toBe("outcome_unknown");
  });
});
