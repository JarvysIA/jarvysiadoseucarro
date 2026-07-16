// Build 5.7F2E1C — Testes do Repository actions/execute_whatsapp_km_update.
// Runner: bun test. Sem rede, sem banco. Client structural mock.

import { describe, expect, test } from "bun:test";
import type { KmUpdateExecutionCommand } from "../types.ts";
import {
  KmActionMalformedResponseError,
  KmActionRpcExceptionError,
  KmActionTransportError,
  KmActionUnknownResultError,
  WhatsappKmActionRepository,
  parseExecuteKmUpdate,
  type KmActionRpcInvoker,
  type KmActionSupabaseLike,
} from "../repository.ts";

// ---------- fixtures ----------

const UUID_DRAFT = "11111111-1111-1111-1111-111111111111";
const UUID_STATE = "22222222-2222-2222-2222-222222222222";
const UUID_CONF = "33333333-3333-3333-3333-333333333333";
const UUID_SRC = "44444444-4444-4444-4444-444444444444";
const UUID_QUEUE = "55555555-5555-5555-5555-555555555555";
const UUID_USER = "66666666-6666-6666-6666-666666666666";
const UUID_CONTACT = "77777777-7777-7777-7777-777777777777";
const UUID_VEHICLE = "88888888-8888-8888-8888-888888888888";
const UUID_EXEC = "99999999-9999-9999-9999-999999999999";

const CMD: KmUpdateExecutionCommand = {
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

function makeClient(payload: unknown | Error): KmActionSupabaseLike {
  const invoker: KmActionRpcInvoker = async () => {
    if (payload instanceof Error) throw payload;
    return { data: payload as never, error: null };
  };
  return { rpc: invoker };
}

function makeErrClient(
  code: string | null,
  message: string,
): KmActionSupabaseLike {
  const invoker: KmActionRpcInvoker = async () => {
    return { data: null, error: { code, message } };
  };
  return { rpc: invoker };
}

// ============================================================
// applied / replayed / no_op
// ============================================================

describe("kinds felizes", () => {
  test("applied com previousKm null", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        previousKm: null,
        newKm: 12345,
      }),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r).toEqual({
      kind: "applied",
      actionExecutionId: UUID_EXEC,
      previousKm: null,
      newKm: 12345,
    });
  });

  test("applied com previousKm inteiro", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        previousKm: 10000,
        newKm: 12345,
      }),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r).toEqual({
      kind: "applied",
      actionExecutionId: UUID_EXEC,
      previousKm: 10000,
      newKm: 12345,
    });
  });

  test("applied aceita payload como array de 1 elemento", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient([
        {
          kind: "applied",
          actionExecutionId: UUID_EXEC,
          previousKm: 1,
          newKm: 2,
        },
      ]),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r.kind).toBe("applied");
  });

  test("replayed com noChange true", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "replayed",
        actionExecutionId: UUID_EXEC,
        previousKm: 100,
        newKm: 200,
        noChange: true,
      }),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r).toEqual({
      kind: "replayed",
      actionExecutionId: UUID_EXEC,
      previousKm: 100,
      newKm: 200,
      noChange: true,
    });
  });

  test("replayed com noChange false e previousKm null", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "replayed",
        actionExecutionId: UUID_EXEC,
        previousKm: null,
        newKm: 500,
        noChange: false,
      }),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r).toEqual({
      kind: "replayed",
      actionExecutionId: UUID_EXEC,
      previousKm: null,
      newKm: 500,
      noChange: false,
    });
  });

  test("no_op com currentKm inteiro", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "no_op",
        actionExecutionId: UUID_EXEC,
        currentKm: 12345,
      }),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r).toEqual({
      kind: "no_op",
      actionExecutionId: UUID_EXEC,
      currentKm: 12345,
    });
  });

  test("no_op com currentKm null", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "no_op",
        actionExecutionId: UUID_EXEC,
        currentKm: null,
      }),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r.kind).toBe("no_op");
  });
});

// ============================================================
// rejected (8 reasons)
// ============================================================

const REJECTED_REASONS = [
  "contact_missing",
  "contact_unlinked",
  "vehicle_not_found",
  "vehicle_not_owned",
  "vehicle_archived",
  "km_invalid",
  "correction_not_confirmed",
  "invariant_violation",
] as const;

describe("rejected", () => {
  for (const reason of REJECTED_REASONS) {
    test(`rejected reason=${reason}`, async () => {
      const repo = new WhatsappKmActionRepository(
        makeClient({ kind: "rejected", reason }),
      );
      const r = await repo.executeKmUpdate(CMD);
      expect(r).toEqual({ kind: "rejected", reason });
    });
  }
});

// ============================================================
// conflicted (3 reasons, campos extras distintos)
// ============================================================

describe("conflicted", () => {
  test("km_conflict com currentKm inteiro", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "conflicted",
        reason: "km_conflict",
        currentKm: 9999,
      }),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r).toEqual({
      kind: "conflicted",
      reason: "km_conflict",
      currentKm: 9999,
    });
  });

  test("km_conflict com currentKm null", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "conflicted",
        reason: "km_conflict",
        currentKm: null,
      }),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r).toEqual({
      kind: "conflicted",
      reason: "km_conflict",
      currentKm: null,
    });
  });

  test("state_version_conflict com currentStateVersion", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "conflicted",
        reason: "state_version_conflict",
        currentStateVersion: 42,
      }),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r).toEqual({
      kind: "conflicted",
      reason: "state_version_conflict",
      currentStateVersion: 42,
    });
  });

  test("action_execution_conflict SEM campos extras", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "conflicted",
        reason: "action_execution_conflict",
      }),
    );
    const r = await repo.executeKmUpdate(CMD);
    expect(r).toEqual({
      kind: "conflicted",
      reason: "action_execution_conflict",
    });
    // Garantia extra: nem currentKm nem currentStateVersion.
    expect((r as Record<string, unknown>).currentKm).toBeUndefined();
    expect((r as Record<string, unknown>).currentStateVersion).toBeUndefined();
  });
});

// ============================================================
// unknown kind / unknown reason
// ============================================================

describe("unknown", () => {
  test("kind desconhecido", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({ kind: "transient_error", reason: "database_unavailable" }),
    );
    await expect(repo.executeKmUpdate(CMD)).rejects.toBeInstanceOf(
      KmActionUnknownResultError,
    );
  });

  test("rejected reason desconhecida", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({ kind: "rejected", reason: "action_not_confirmed" }),
    );
    await expect(repo.executeKmUpdate(CMD)).rejects.toBeInstanceOf(
      KmActionUnknownResultError,
    );
  });

  test("conflicted reason desconhecida", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "conflicted",
        reason: "idempotency_payload_mismatch",
      }),
    );
    await expect(repo.executeKmUpdate(CMD)).rejects.toBeInstanceOf(
      KmActionUnknownResultError,
    );
  });
});

// ============================================================
// malformed
// ============================================================

describe("malformed", () => {
  test("payload nulo", async () => {
    const repo = new WhatsappKmActionRepository(makeClient(null));
    await expect(repo.executeKmUpdate(CMD)).rejects.toBeInstanceOf(
      KmActionMalformedResponseError,
    );
  });

  test("array vazio", async () => {
    const repo = new WhatsappKmActionRepository(makeClient([]));
    await expect(repo.executeKmUpdate(CMD)).rejects.toBeInstanceOf(
      KmActionMalformedResponseError,
    );
  });

  test("array com mais de 1 linha", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient([
        { kind: "no_op", actionExecutionId: UUID_EXEC, currentKm: 1 },
        { kind: "no_op", actionExecutionId: UUID_EXEC, currentKm: 2 },
      ]),
    );
    await expect(repo.executeKmUpdate(CMD)).rejects.toBeInstanceOf(
      KmActionMalformedResponseError,
    );
  });

  test("applied sem newKm", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        previousKm: null,
      }),
    );
    await expect(repo.executeKmUpdate(CMD)).rejects.toBeInstanceOf(
      KmActionMalformedResponseError,
    );
  });

  test("applied sem previousKm (ausente, não null)", () => {
    expect(() =>
      parseExecuteKmUpdate({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        newKm: 10,
      }),
    ).toThrow(KmActionMalformedResponseError);
  });

  test("replayed sem noChange", () => {
    expect(() =>
      parseExecuteKmUpdate({
        kind: "replayed",
        actionExecutionId: UUID_EXEC,
        previousKm: 1,
        newKm: 2,
      }),
    ).toThrow(KmActionMalformedResponseError);
  });

  test("no_op sem currentKm (ausente)", () => {
    expect(() =>
      parseExecuteKmUpdate({
        kind: "no_op",
        actionExecutionId: UUID_EXEC,
      }),
    ).toThrow(KmActionMalformedResponseError);
  });

  test("rejected sem reason", () => {
    expect(() =>
      parseExecuteKmUpdate({ kind: "rejected" }),
    ).toThrow(KmActionMalformedResponseError);
  });

  test("state_version_conflict sem currentStateVersion", () => {
    expect(() =>
      parseExecuteKmUpdate({
        kind: "conflicted",
        reason: "state_version_conflict",
      }),
    ).toThrow(KmActionMalformedResponseError);
  });

  test("km_conflict com currentKm ausente", () => {
    expect(() =>
      parseExecuteKmUpdate({
        kind: "conflicted",
        reason: "km_conflict",
      }),
    ).toThrow(KmActionMalformedResponseError);
  });

  test("applied com actionExecutionId não-string", () => {
    expect(() =>
      parseExecuteKmUpdate({
        kind: "applied",
        actionExecutionId: 123,
        previousKm: null,
        newKm: 10,
      }),
    ).toThrow(KmActionMalformedResponseError);
  });

  test("applied com previousKm float", () => {
    expect(() =>
      parseExecuteKmUpdate({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        previousKm: 1.5,
        newKm: 10,
      }),
    ).toThrow(KmActionMalformedResponseError);
  });
});

// ============================================================
// erros de transporte / RPC
// ============================================================

describe("transporte / RPC", () => {
  test("response.error preenchido -> KmActionRpcExceptionError", async () => {
    const repo = new WhatsappKmActionRepository(
      makeErrClient("P0001", "boom"),
    );
    await expect(repo.executeKmUpdate(CMD)).rejects.toBeInstanceOf(
      KmActionRpcExceptionError,
    );
  });

  test("response.error preserva code e message", async () => {
    const repo = new WhatsappKmActionRepository(
      makeErrClient("42P01", "relation missing"),
    );
    try {
      await repo.executeKmUpdate(CMD);
      throw new Error("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(KmActionRpcExceptionError);
      const e = err as KmActionRpcExceptionError;
      expect(e.code).toBe("42P01");
      expect(e.message).toBe("relation missing");
    }
  });

  test("rpc() lança excecao -> KmActionTransportError", async () => {
    const repo = new WhatsappKmActionRepository(
      makeClient(new Error("network dead")),
    );
    await expect(repo.executeKmUpdate(CMD)).rejects.toBeInstanceOf(
      KmActionTransportError,
    );
  });
});
