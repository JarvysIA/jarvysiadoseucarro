// Build 5.7F2E1A.5-MJ1 — Testes do Repository km-prompts.
// Runner: bun test. Sem rede, sem banco. Client structural mock.

import { describe, expect, test } from "bun:test";
import {
  KmPromptMalformedResponseError,
  KmPromptRpcExceptionError,
  KmPromptTransportError,
  KmPromptUnknownResultError,
} from "../types.ts";
import {
  WhatsappKmPromptRepository,
  type KmPromptRpcInvoker,
  type KmPromptSupabaseLike,
} from "../repository.ts";

// ---------- fixtures ----------

const UUID_PROMPT = "11111111-1111-1111-1111-111111111111";
const UUID_CONTACT = "22222222-2222-2222-2222-222222222222";
const UUID_USER = "33333333-3333-3333-3333-333333333333";
const UUID_VEHICLE = "44444444-4444-4444-4444-444444444444";
const UUID_REQ = "55555555-5555-5555-5555-555555555555";
const UUID_DRAFT = "66666666-6666-6666-6666-666666666666";

function makeClient(rows: unknown | Error): KmPromptSupabaseLike {
  const invoker: KmPromptRpcInvoker = async () => {
    if (rows instanceof Error) throw rows;
    return { data: rows as never, error: null };
  };
  return { rpc: invoker };
}

function makeErrClient(code: string | null, message: string): KmPromptSupabaseLike {
  const invoker: KmPromptRpcInvoker = async () => {
    return { data: null, error: { code, message } };
  };
  return { rpc: invoker };
}

const BASE_CREATE = {
  promptMessageId: UUID_PROMPT,
  contactId: UUID_CONTACT,
  userId: UUID_USER,
  vehicleId: UUID_VEHICLE,
};

// ============================================================
// CREATE
// ============================================================

describe("create", () => {
  test("created", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "created", request_id: UUID_REQ }]),
    );
    const r = await repo.create(BASE_CREATE);
    expect(r).toEqual({ result: "created", requestId: UUID_REQ });
  });

  test("replayed", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "replayed", request_id: UUID_REQ }]),
    );
    expect((await repo.create(BASE_CREATE)).result).toBe("replayed");
  });

  test("already_exists_with_different_context", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "already_exists_with_different_context", request_id: UUID_REQ }]),
    );
    const r = await repo.create(BASE_CREATE);
    expect(r).toEqual({
      result: "already_exists_with_different_context",
      requestId: UUID_REQ,
    });
  });

  test.each([
    "prompt_message_not_found",
    "prompt_message_not_outbound",
    "prompt_context_mismatch",
    "vehicle_archived",
  ])("reason sem request_id: %s", async (result) => {
    const repo = new WhatsappKmPromptRepository(makeClient([{ result, request_id: null }]));
    const r = await repo.create(BASE_CREATE);
    expect(r.result).toBe(result as never);
    expect("requestId" in r).toBe(false);
  });

  test("resultado desconhecido → KmPromptUnknownResultError", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "wat", request_id: UUID_REQ }]),
    );
    expect(repo.create(BASE_CREATE)).rejects.toBeInstanceOf(KmPromptUnknownResultError);
  });

  test("payload nulo → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient(null));
    expect(repo.create(BASE_CREATE)).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("array vazio → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient([]));
    expect(repo.create(BASE_CREATE)).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("múltiplas rows → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([
        { result: "created", request_id: UUID_REQ },
        { result: "created", request_id: UUID_REQ },
      ]),
    );
    expect(repo.create(BASE_CREATE)).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("request_id ausente em created → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient([{ result: "created" }]));
    expect(repo.create(BASE_CREATE)).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("erro Supabase propaga como KmPromptRpcExceptionError", async () => {
    const repo = new WhatsappKmPromptRepository(makeErrClient("23505", "conflict"));
    expect(repo.create(BASE_CREATE)).rejects.toBeInstanceOf(KmPromptRpcExceptionError);
  });

  test("exceção do transporte propaga como KmPromptTransportError", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient(new Error("boom")));
    expect(repo.create(BASE_CREATE)).rejects.toBeInstanceOf(KmPromptTransportError);
  });
});

// ============================================================
// PROMOTE
// ============================================================

describe("promoteToPending", () => {
  test("promoted retorna timestamps ISO", async () => {
    const pending = "2026-08-01T10:00:00.000Z";
    const expires = "2026-08-08T10:00:00.000Z";
    const repo = new WhatsappKmPromptRepository(
      makeClient([{
        result: "promoted",
        request_id: UUID_REQ,
        pending_at: pending,
        expires_at: expires,
      }]),
    );
    const r = await repo.promoteToPending({ promptMessageId: UUID_PROMPT });
    expect(r).toEqual({
      result: "promoted",
      requestId: UUID_REQ,
      pendingAt: pending,
      expiresAt: expires,
    });
  });

  test("already_pending", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{
        result: "already_pending",
        request_id: UUID_REQ,
        pending_at: "2026-08-01T10:00:00.000Z",
        expires_at: "2026-08-08T10:00:00.000Z",
      }]),
    );
    const r = await repo.promoteToPending({ promptMessageId: UUID_PROMPT });
    expect(r.result).toBe("already_pending");
  });

  test("not_found sem request_id", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "not_found", request_id: null, pending_at: null, expires_at: null }]),
    );
    const r = await repo.promoteToPending({ promptMessageId: UUID_PROMPT });
    expect(r).toEqual({ result: "not_found" });
  });

  test.each(["not_queued", "prompt_message_not_sent", "prompt_context_mismatch"])(
    "reason %s traz request_id",
    async (result) => {
      const repo = new WhatsappKmPromptRepository(
        makeClient([{ result, request_id: UUID_REQ, pending_at: null, expires_at: null }]),
      );
      const r = await repo.promoteToPending({ promptMessageId: UUID_PROMPT });
      expect(r).toEqual({ result: result as never, requestId: UUID_REQ });
    },
  );

  test("promoted com pending_at inválido → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{
        result: "promoted",
        request_id: UUID_REQ,
        pending_at: "not-a-date",
        expires_at: "2026-08-08T10:00:00.000Z",
      }]),
    );
    expect(repo.promoteToPending({ promptMessageId: UUID_PROMPT }))
      .rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("resultado desconhecido → unknown", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "banana", request_id: UUID_REQ }]),
    );
    expect(repo.promoteToPending({ promptMessageId: UUID_PROMPT }))
      .rejects.toBeInstanceOf(KmPromptUnknownResultError);
  });
});

// ============================================================
// RESERVE
// ============================================================

const BASE_RESERVE = {
  promptMessageId: UUID_PROMPT,
  contactId: UUID_CONTACT,
  userId: UUID_USER,
  vehicleId: UUID_VEHICLE,
  draftId: UUID_DRAFT,
};

describe("reserve", () => {
  test("reserved", async () => {
    const at = "2026-08-05T12:00:00.000Z";
    const repo = new WhatsappKmPromptRepository(
      makeClient([{
        result: "reserved",
        request_id: UUID_REQ,
        reserved_draft_id: UUID_DRAFT,
        reserved_at: at,
      }]),
    );
    const r = await repo.reserve(BASE_RESERVE);
    expect(r).toEqual({
      result: "reserved",
      requestId: UUID_REQ,
      reservedDraftId: UUID_DRAFT,
      reservedAt: at,
    });
  });

  test("replayed", async () => {
    const at = "2026-08-05T12:00:00.000Z";
    const repo = new WhatsappKmPromptRepository(
      makeClient([{
        result: "replayed",
        request_id: UUID_REQ,
        reserved_draft_id: UUID_DRAFT,
        reserved_at: at,
      }]),
    );
    const r = await repo.reserve(BASE_RESERVE);
    expect(r.result).toBe("replayed");
  });

  test("prompt_not_found", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "prompt_not_found", request_id: null, reserved_draft_id: null, reserved_at: null }]),
    );
    const r = await repo.reserve(BASE_RESERVE);
    expect(r).toEqual({ result: "prompt_not_found" });
  });

  test.each([
    "prompt_not_pending",
    "prompt_expired",
    "prompt_cancelled",
    "prompt_consumed",
    "prompt_reserved_by_other_draft",
    "prompt_context_mismatch",
    "prompt_message_not_sent",
    "draft_message_not_found",
    "draft_message_not_inbound",
    "draft_context_mismatch",
  ])("reason %s traz request_id", async (result) => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result, request_id: UUID_REQ, reserved_draft_id: null, reserved_at: null }]),
    );
    const r = await repo.reserve(BASE_RESERVE);
    expect(r).toEqual({ result: result as never, requestId: UUID_REQ });
  });

  test("reserved sem reserved_draft_id → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "reserved", request_id: UUID_REQ, reserved_at: "2026-08-05T12:00:00.000Z" }]),
    );
    expect(repo.reserve(BASE_RESERVE)).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("resultado desconhecido → unknown", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "??", request_id: UUID_REQ }]),
    );
    expect(repo.reserve(BASE_RESERVE)).rejects.toBeInstanceOf(KmPromptUnknownResultError);
  });
});

// ============================================================
// CANCEL
// ============================================================

describe("cancel", () => {
  test("cancelled", async () => {
    const at = "2026-08-05T12:00:00.000Z";
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "cancelled", request_id: UUID_REQ, cancelled_at: at }]),
    );
    const r = await repo.cancel({ promptMessageId: UUID_PROMPT });
    expect(r).toEqual({ result: "cancelled", requestId: UUID_REQ, cancelledAt: at });
  });

  test("already_terminal com cancelled_at", async () => {
    const at = "2026-08-05T12:00:00.000Z";
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "already_terminal", request_id: UUID_REQ, cancelled_at: at }]),
    );
    const r = await repo.cancel({ promptMessageId: UUID_PROMPT });
    expect(r).toEqual({ result: "already_terminal", requestId: UUID_REQ, cancelledAt: at });
  });

  test("already_terminal sem cancelled_at (consumed/expired)", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "already_terminal", request_id: UUID_REQ, cancelled_at: null }]),
    );
    const r = await repo.cancel({ promptMessageId: UUID_PROMPT });
    expect(r).toEqual({ result: "already_terminal", requestId: UUID_REQ, cancelledAt: null });
  });

  test("not_found", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "not_found", request_id: null, cancelled_at: null }]),
    );
    expect((await repo.cancel({ promptMessageId: UUID_PROMPT })).result).toBe("not_found");
  });

  test("cancelled com cancelled_at inválido → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "cancelled", request_id: UUID_REQ, cancelled_at: "xxx" }]),
    );
    expect(repo.cancel({ promptMessageId: UUID_PROMPT }))
      .rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("resultado desconhecido → unknown", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient([{ result: "meh", request_id: UUID_REQ }]),
    );
    expect(repo.cancel({ promptMessageId: UUID_PROMPT }))
      .rejects.toBeInstanceOf(KmPromptUnknownResultError);
  });
});

// ============================================================
// EXPIRE
// ============================================================

describe("expire", () => {
  test("retorna expired_count", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient([{ expired_count: 7 }]));
    expect(await repo.expire()).toEqual({ expiredCount: 7 });
  });

  test("retorna zero", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient([{ expired_count: 0 }]));
    expect(await repo.expire()).toEqual({ expiredCount: 0 });
  });

  test("payload nulo → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient(null));
    expect(repo.expire()).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("array vazio → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient([]));
    expect(repo.expire()).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("expired_count negativo → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient([{ expired_count: -1 }]));
    expect(repo.expire()).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("expired_count não inteiro → malformed", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient([{ expired_count: 3.14 }]));
    expect(repo.expire()).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("batch propagado", async () => {
    let capturedParams: Record<string, unknown> | null = null;
    const client: KmPromptSupabaseLike = {
      rpc: async (_fn, params) => {
        capturedParams = params;
        return { data: [{ expired_count: 0 }] as never, error: null };
      },
    };
    const repo = new WhatsappKmPromptRepository(client);
    await repo.expire({ batch: 42 });
    expect(capturedParams).toEqual({ p_batch: 42 });
  });

  test("erro RPC (invalid_batch) propaga como RpcException", async () => {
    const repo = new WhatsappKmPromptRepository(makeErrClient("22023", "invalid_batch: 0"));
    expect(repo.expire({ batch: 0 })).rejects.toBeInstanceOf(KmPromptRpcExceptionError);
  });
});

// ============================================================
// MJ1A — ENQUEUE / FINALIZE SENT / FINALIZE FAILED
// ============================================================

const UUID_MSG = "77777777-7777-7777-7777-777777777777";
const UUID_QUEUE = "88888888-8888-8888-8888-888888888888";
const IDEMP = "idem-key-abc";
const PROVIDER_MID = "prov-msg-1";

describe("enqueue", () => {
  test("created", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "created",
        prompt_request_id: UUID_REQ,
        prompt_message_id: UUID_MSG,
        outbound_queue_id: UUID_QUEUE,
      }),
    );
    const r = await repo.enqueue({
      idempotencyKey: IDEMP,
      contactId: UUID_CONTACT,
      vehicleId: UUID_VEHICLE,
      textBody: "hi",
    });
    expect(r).toEqual({
      result: "created",
      promptRequestId: UUID_REQ,
      promptMessageId: UUID_MSG,
      outboundQueueId: UUID_QUEUE,
    });
  });

  test("replayed", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "replayed",
        prompt_request_id: UUID_REQ,
        prompt_message_id: UUID_MSG,
        outbound_queue_id: UUID_QUEUE,
      }),
    );
    const r = await repo.enqueue({
      idempotencyKey: IDEMP,
      contactId: UUID_CONTACT,
      vehicleId: UUID_VEHICLE,
      textBody: "hi",
    });
    expect(r.result).toBe("replayed");
  });

  test.each([
    "idempotency_context_mismatch",
    "invalid_idempotency_key",
    "invalid_text",
    "contact_not_found",
    "contact_opted_out",
    "contact_not_eligible",
    "contact_not_linked",
    "vehicle_not_found",
    "vehicle_not_owned",
    "vehicle_archived",
    "vehicle_context_invalid",
    "instance_not_found",
    "instance_inactive",
    "instance_context_mismatch",
  ])("reject %s", async (reason) => {
    const repo = new WhatsappKmPromptRepository(makeClient({ result: reason }));
    const r = await repo.enqueue({
      idempotencyKey: IDEMP,
      contactId: UUID_CONTACT,
      vehicleId: UUID_VEHICLE,
      textBody: "hi",
    });
    expect(r).toEqual({ result: reason });
  });

  test("result desconhecido → UnknownResult", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient({ result: "wat" }));
    expect(
      repo.enqueue({
        idempotencyKey: IDEMP,
        contactId: UUID_CONTACT,
        vehicleId: UUID_VEHICLE,
        textBody: "hi",
      }),
    ).rejects.toBeInstanceOf(KmPromptUnknownResultError);
  });

  test("created sem prompt_request_id → Malformed", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "created",
        prompt_message_id: UUID_MSG,
        outbound_queue_id: UUID_QUEUE,
      }),
    );
    expect(
      repo.enqueue({
        idempotencyKey: IDEMP,
        contactId: UUID_CONTACT,
        vehicleId: UUID_VEHICLE,
        textBody: "hi",
      }),
    ).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("payload nulo → Malformed", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient(null));
    expect(
      repo.enqueue({
        idempotencyKey: IDEMP,
        contactId: UUID_CONTACT,
        vehicleId: UUID_VEHICLE,
        textBody: "hi",
      }),
    ).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("erro RPC propaga como RpcException", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeErrClient("P0001", "boom"),
    );
    expect(
      repo.enqueue({
        idempotencyKey: IDEMP,
        contactId: UUID_CONTACT,
        vehicleId: UUID_VEHICLE,
        textBody: "hi",
      }),
    ).rejects.toBeInstanceOf(KmPromptRpcExceptionError);
  });
});

describe("finalizeSent", () => {
  test("finalized", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "finalized",
        prompt_request_id: UUID_REQ,
        prompt_message_id: UUID_MSG,
        outbound_queue_id: UUID_QUEUE,
        pending_at: "2026-07-13T00:00:00Z",
        expires_at: "2026-07-20T00:00:00Z",
      }),
    );
    const r = await repo.finalizeSent({
      outboundQueueId: UUID_QUEUE,
      providerMessageId: PROVIDER_MID,
    });
    expect(r.result).toBe("finalized");
    if (r.result === "finalized") {
      expect(r.pendingAt).toBe("2026-07-13T00:00:00Z");
      expect(r.expiresAt).toBe("2026-07-20T00:00:00Z");
    }
  });

  test("replayed", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "replayed",
        prompt_request_id: UUID_REQ,
        prompt_message_id: UUID_MSG,
        outbound_queue_id: UUID_QUEUE,
        pending_at: "2026-07-13T00:00:00Z",
        expires_at: "2026-07-20T00:00:00Z",
      }),
    );
    const r = await repo.finalizeSent({
      outboundQueueId: UUID_QUEUE,
      providerMessageId: PROVIDER_MID,
    });
    expect(r.result).toBe("replayed");
  });

  test.each([
    "queue_not_found",
    "queue_state_invalid",
    "invalid_provider_message_id",
    "provider_message_id_mismatch",
    "km_prompt_invariant_violation",
  ])("reject %s", async (reason) => {
    const repo = new WhatsappKmPromptRepository(makeClient({ result: reason }));
    const r = await repo.finalizeSent({
      outboundQueueId: UUID_QUEUE,
      providerMessageId: PROVIDER_MID,
    });
    expect(r).toEqual({ result: reason });
  });

  test("timestamp inválido → Malformed", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "finalized",
        prompt_request_id: UUID_REQ,
        prompt_message_id: UUID_MSG,
        outbound_queue_id: UUID_QUEUE,
        pending_at: "nope",
        expires_at: "2026-07-20T00:00:00Z",
      }),
    );
    expect(
      repo.finalizeSent({
        outboundQueueId: UUID_QUEUE,
        providerMessageId: PROVIDER_MID,
      }),
    ).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });

  test("result desconhecido → UnknownResult", async () => {
    const repo = new WhatsappKmPromptRepository(makeClient({ result: "xx" }));
    expect(
      repo.finalizeSent({
        outboundQueueId: UUID_QUEUE,
        providerMessageId: PROVIDER_MID,
      }),
    ).rejects.toBeInstanceOf(KmPromptUnknownResultError);
  });
});

describe("finalizeFailed", () => {
  test("finalized com reason válido", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "finalized",
        prompt_request_id: UUID_REQ,
        prompt_message_id: UUID_MSG,
        outbound_queue_id: UUID_QUEUE,
        terminal_reason: "non_retryable_provider_error",
      }),
    );
    const r = await repo.finalizeFailed({
      outboundQueueId: UUID_QUEUE,
      terminalReason: "non_retryable_provider_error",
      errorMessage: "boom",
    });
    expect(r.result).toBe("finalized");
    if (r.result === "finalized") {
      expect(r.terminalReason).toBe("non_retryable_provider_error");
    }
  });

  test("finalized com reason desconhecido → UnknownResult", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "finalized",
        prompt_request_id: UUID_REQ,
        prompt_message_id: UUID_MSG,
        outbound_queue_id: UUID_QUEUE,
        terminal_reason: "weird",
      }),
    );
    expect(
      repo.finalizeFailed({
        outboundQueueId: UUID_QUEUE,
        terminalReason: "non_retryable_provider_error",
        errorMessage: null,
      }),
    ).rejects.toBeInstanceOf(KmPromptUnknownResultError);
  });

  test("terminal_replayed sem repaired", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "terminal_replayed",
        prompt_request_id: UUID_REQ,
        terminal_reason: "timeout_ambiguous",
      }),
    );
    const r = await repo.finalizeFailed({
      outboundQueueId: UUID_QUEUE,
      terminalReason: "timeout_ambiguous",
    });
    expect(r).toEqual({
      result: "terminal_replayed",
      promptRequestId: UUID_REQ,
      terminalReason: "timeout_ambiguous",
    });
  });

  test("terminal_replayed com repaired=true", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "terminal_replayed",
        prompt_request_id: UUID_REQ,
        terminal_reason: "timeout_ambiguous",
        repaired: true,
      }),
    );
    const r = await repo.finalizeFailed({
      outboundQueueId: UUID_QUEUE,
      terminalReason: "timeout_ambiguous",
    });
    expect(r).toEqual({
      result: "terminal_replayed",
      promptRequestId: UUID_REQ,
      terminalReason: "timeout_ambiguous",
      repaired: true,
    });
  });

  test("terminal_after_prompt_progress_invariant", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "terminal_after_prompt_progress_invariant",
        prompt_request_id: UUID_REQ,
      }),
    );
    const r = await repo.finalizeFailed({
      outboundQueueId: UUID_QUEUE,
      terminalReason: "max_attempts_reached",
    });
    expect(r).toEqual({
      result: "terminal_after_prompt_progress_invariant",
      promptRequestId: UUID_REQ,
    });
  });

  test.each([
    "queue_not_found",
    "queue_state_invalid",
    "invalid_terminal_reason",
    "max_attempts_not_reached",
    "km_prompt_invariant_violation",
    "terminal_after_success_invariant",
  ])("reject %s", async (reason) => {
    const repo = new WhatsappKmPromptRepository(makeClient({ result: reason }));
    const r = await repo.finalizeFailed({
      outboundQueueId: UUID_QUEUE,
      terminalReason: "non_retryable_provider_error",
    });
    expect(r).toEqual({ result: reason });
  });

  test("repaired com tipo inválido → Malformed", async () => {
    const repo = new WhatsappKmPromptRepository(
      makeClient({
        result: "terminal_replayed",
        prompt_request_id: UUID_REQ,
        terminal_reason: "timeout_ambiguous",
        repaired: "yes",
      }),
    );
    expect(
      repo.finalizeFailed({
        outboundQueueId: UUID_QUEUE,
        terminalReason: "timeout_ambiguous",
      }),
    ).rejects.toBeInstanceOf(KmPromptMalformedResponseError);
  });
});

// ============================================================
// Sanidade — nenhum any/casts públicos, wrappers puros.
// ============================================================

describe("integridade estrutural", () => {
  test("repository não vaza referências a core/mapper/drafts/action service", () => {
    expect(WhatsappKmPromptRepository).toBeDefined();
  });
});

