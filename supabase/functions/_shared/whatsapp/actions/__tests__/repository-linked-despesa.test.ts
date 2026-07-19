// Build 7/9 item 6 — Repository escolhe a RPC certa conforme linkedDespesaId.

import { describe, expect, test } from "bun:test";
import type { KmUpdateExecutionCommand } from "../types.ts";
import {
  WhatsappKmActionRepository,
  type KmActionRpcInvoker,
  type KmActionSupabaseLike,
} from "../repository.ts";

const UUID_DRAFT = "11111111-1111-1111-1111-111111111111";
const UUID_STATE = "22222222-2222-2222-2222-222222222222";
const UUID_CONF = "33333333-3333-3333-3333-333333333333";
const UUID_SRC = "44444444-4444-4444-4444-444444444444";
const UUID_QUEUE = "55555555-5555-5555-5555-555555555555";
const UUID_USER = "66666666-6666-6666-6666-666666666666";
const UUID_CONTACT = "77777777-7777-7777-7777-777777777777";
const UUID_VEHICLE = "88888888-8888-8888-8888-888888888888";
const UUID_EXEC = "99999999-9999-9999-9999-999999999999";
const UUID_DESPESA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function baseCmd(): KmUpdateExecutionCommand {
  return {
    actionType: "km_update",
    draftId: UUID_DRAFT,
    conversationStateId: UUID_STATE,
    confirmationMessageId: UUID_CONF,
    sourceMessageId: UUID_SRC,
    queueItemId: UUID_QUEUE,
    userId: UUID_USER,
    contactId: UUID_CONTACT,
    vehicleId: UUID_VEHICLE,
    expectedPreviousKm: null,
    newKm: 12345,
    isCorrection: false,
    correctionConfirmed: false,
    correctionReason: null,
    expectedStateVersion: 3,
    orchestratorVersion: "v1",
  };
}

type Call = { fn: string; params: Record<string, unknown> };

function makeCapturingClient(
  payload: unknown,
): { client: KmActionSupabaseLike; calls: Call[] } {
  const calls: Call[] = [];
  const invoker: KmActionRpcInvoker = async (fn, params) => {
    calls.push({ fn, params });
    return { data: payload as never, error: null };
  };
  return { client: { rpc: invoker }, calls };
}

const APPLIED_PAYLOAD = {
  kind: "applied",
  actionExecutionId: UUID_EXEC,
  previousKm: null,
  newKm: 12345,
};

describe("Repository — seleção de RPC por linkedDespesaId", () => {
  test("sem linkedDespesaId → chama execute_whatsapp_km_update sem p_linked_despesa_id", async () => {
    const { client, calls } = makeCapturingClient(APPLIED_PAYLOAD);
    const repo = new WhatsappKmActionRepository(client);
    await repo.executeKmUpdate(baseCmd());
    expect(calls.length).toBe(1);
    expect(calls[0].fn).toBe("execute_whatsapp_km_update");
    expect("p_linked_despesa_id" in calls[0].params).toBe(false);
    expect(calls[0].params.p_draft_id).toBe(UUID_DRAFT);
    expect(calls[0].params.p_new_km).toBe(12345);
  });

  test("com linkedDespesaId → chama execute_whatsapp_km_update_with_expense_link com o UUID", async () => {
    const { client, calls } = makeCapturingClient(APPLIED_PAYLOAD);
    const repo = new WhatsappKmActionRepository(client);
    await repo.executeKmUpdate({ ...baseCmd(), linkedDespesaId: UUID_DESPESA });
    expect(calls.length).toBe(1);
    expect(calls[0].fn).toBe("execute_whatsapp_km_update_with_expense_link");
    expect(calls[0].params.p_linked_despesa_id).toBe(UUID_DESPESA);
    // params base preservados
    expect(calls[0].params.p_draft_id).toBe(UUID_DRAFT);
    expect(calls[0].params.p_conversation_state_id).toBe(UUID_STATE);
    expect(calls[0].params.p_confirmation_message_id).toBe(UUID_CONF);
    expect(calls[0].params.p_source_message_id).toBe(UUID_SRC);
    expect(calls[0].params.p_queue_item_id).toBe(UUID_QUEUE);
    expect(calls[0].params.p_user_id).toBe(UUID_USER);
    expect(calls[0].params.p_contact_id).toBe(UUID_CONTACT);
    expect(calls[0].params.p_vehicle_id).toBe(UUID_VEHICLE);
    expect(calls[0].params.p_expected_previous_km).toBe(null);
    expect(calls[0].params.p_new_km).toBe(12345);
    expect(calls[0].params.p_is_correction).toBe(false);
    expect(calls[0].params.p_correction_confirmed).toBe(false);
    expect(calls[0].params.p_correction_reason).toBe(null);
    expect(calls[0].params.p_expected_state_version).toBe(3);
    expect(calls[0].params.p_orchestrator_version).toBe("v1");
  });

  test("regressão parsing — applied via RPC nova continua sendo parseado", async () => {
    const { client } = makeCapturingClient(APPLIED_PAYLOAD);
    const repo = new WhatsappKmActionRepository(client);
    const r = await repo.executeKmUpdate({
      ...baseCmd(),
      linkedDespesaId: UUID_DESPESA,
    });
    expect(r).toEqual({
      kind: "applied",
      actionExecutionId: UUID_EXEC,
      previousKm: null,
      newKm: 12345,
    });
  });

  test("regressão parsing — no_op via RPC nova", async () => {
    const { client } = makeCapturingClient({
      kind: "no_op",
      actionExecutionId: UUID_EXEC,
      currentKm: 12345,
    });
    const repo = new WhatsappKmActionRepository(client);
    const r = await repo.executeKmUpdate({
      ...baseCmd(),
      linkedDespesaId: UUID_DESPESA,
    });
    expect(r).toEqual({
      kind: "no_op",
      actionExecutionId: UUID_EXEC,
      currentKm: 12345,
    });
  });

  test("regressão parsing — rejected via RPC nova", async () => {
    const { client } = makeCapturingClient({
      kind: "rejected",
      reason: "vehicle_not_owned",
    });
    const repo = new WhatsappKmActionRepository(client);
    const r = await repo.executeKmUpdate({
      ...baseCmd(),
      linkedDespesaId: UUID_DESPESA,
    });
    expect(r).toEqual({ kind: "rejected", reason: "vehicle_not_owned" });
  });

  test("regressão parsing — conflicted via RPC nova", async () => {
    const { client } = makeCapturingClient({
      kind: "conflicted",
      reason: "km_conflict",
      currentKm: 9999,
    });
    const repo = new WhatsappKmActionRepository(client);
    const r = await repo.executeKmUpdate({
      ...baseCmd(),
      linkedDespesaId: UUID_DESPESA,
    });
    expect(r).toEqual({
      kind: "conflicted",
      reason: "km_conflict",
      currentKm: 9999,
    });
  });
});
