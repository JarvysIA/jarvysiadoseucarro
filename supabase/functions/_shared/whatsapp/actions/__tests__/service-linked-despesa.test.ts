// Build 6c/9 do item 6 — transporte do campo opcional linkedDespesaId
// através de executeConfirmedKmUpdate até o comando entregue ao executor.

import { describe, expect, test } from "bun:test";

import { executeConfirmedKmUpdate } from "../service.ts";
import {
  type ConfirmedKmUpdateInput,
  type KmUpdateExecutionCommand,
  type KmUpdateExecutorPort,
  type KmUpdateExecutorResult,
} from "../types.ts";

const DESPESA_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";

function baseInput(
  overrides: Partial<ConfirmedKmUpdateInput> = {},
): ConfirmedKmUpdateInput {
  return {
    draftId: "draft-1",
    conversationStateId: "cs-1",
    confirmationMessageId: "cm-1",
    sourceMessageId: "sm-1",
    queueItemId: "q-1",
    userId: "u-1",
    contactId: "c-1",
    vehicleId: "v-1",
    expectedPreviousKm: 10000,
    newKm: 12000,
    correctionConfirmed: false,
    correctionReason: null,
    expectedStateVersion: 3,
    orchestratorVersion: "5.7f2e1c",
    ...overrides,
  };
}

function makeExecutor(result: KmUpdateExecutorResult): {
  port: KmUpdateExecutorPort;
  calls: KmUpdateExecutionCommand[];
} {
  const calls: KmUpdateExecutionCommand[] = [];
  const port: KmUpdateExecutorPort = {
    executeKmUpdate: (command) => {
      calls.push(command);
      return Promise.resolve(result);
    },
  };
  return { port, calls };
}

const APPLIED: KmUpdateExecutorResult = {
  kind: "applied",
  actionExecutionId: "ae-1",
  previousKm: 10000,
  newKm: 12000,
};

describe("executeConfirmedKmUpdate — linkedDespesaId (build 6c/9)", () => {
  test("input sem linkedDespesaId → comando não tem a chave", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const result = await executeConfirmedKmUpdate(baseInput(), { executor: port });
    expect(result.kind).toBe("completed");
    expect(calls.length).toBe(1);
    expect(
      Object.prototype.hasOwnProperty.call(calls[0], "linkedDespesaId"),
    ).toBe(false);
  });

  test("input com linkedDespesaId=<uuid> → comando carrega esse mesmo valor", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const result = await executeConfirmedKmUpdate(
      baseInput({ linkedDespesaId: DESPESA_ID }),
      { executor: port },
    );
    expect(result.kind).toBe("completed");
    expect(calls.length).toBe(1);
    expect(calls[0].linkedDespesaId).toBe(DESPESA_ID);
  });

  test("input com linkedDespesaId='' → malformed / linked_despesa_id_invalid, executor NÃO é chamado", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const result = await executeConfirmedKmUpdate(
      baseInput({ linkedDespesaId: "" }),
      { executor: port },
    );
    expect(result).toEqual({
      kind: "malformed",
      reason: "linked_despesa_id_invalid",
    });
    expect(calls.length).toBe(0);
  });

  test("regressão — sem linkedDespesaId, comando entregue é estruturalmente igual ao fluxo pré-6c", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    await executeConfirmedKmUpdate(baseInput(), { executor: port });
    // shape exato — se linkedDespesaId aparecer aqui, comparações estruturais
    // em testes existentes quebrariam.
    expect(calls[0]).toEqual({
      actionType: "km_update",
      draftId: "draft-1",
      conversationStateId: "cs-1",
      confirmationMessageId: "cm-1",
      sourceMessageId: "sm-1",
      queueItemId: "q-1",
      userId: "u-1",
      contactId: "c-1",
      vehicleId: "v-1",
      expectedPreviousKm: 10000,
      newKm: 12000,
      isCorrection: false,
      correctionConfirmed: false,
      correctionReason: null,
      expectedStateVersion: 3,
      orchestratorVersion: "5.7f2e1c",
    });
  });
});
