// Build 5.7F2B3 — Testes do Repository do orquestrador WhatsApp.
// Runner: bun test.
// Sem rede, sem banco. Mock structural do SupabaseLike.

import { describe, expect, test } from "bun:test";
import {
  AmbiguousTimeoutError,
  MalformedResponseError,
  RpcExceptionError,
  TransportError,
  UnknownReasonError,
  WhatsappOrchestratorRepository,
  serializePatch,
  serializeResponse,
  type RpcInvoker,
  type SupabaseLike,
  type TransitionInput,
} from "../index.ts";

// ---------- helpers ----------

function makeClient(invoker: RpcInvoker): SupabaseLike {
  return { rpc: invoker };
}

const BASE_TRANSITION: TransitionInput = {
  queueItemId: "11111111-1111-1111-1111-111111111111",
  leaseToken: "22222222-2222-2222-2222-222222222222",
  expectedStateVersion: 3,
  patch: { state: "idle" },
  orchestratorVersion: "5.7f2b3",
  resultSummary: {
    decisionKind: "no_op",
    eventKind: "unknown",
    outcome: "none",
  },
  response: null,
};

const OK_ORCH_RESULT = {
  decisionKind: "no_op",
  eventKind: "unknown",
  outcome: "none",
  responseKey: null,
  nextState: "idle",
  stateVersion: 4,
  outboundQueueId: null,
};

// ============================================================
// serializePatch — SQL keys strict snake_case
// ============================================================

describe("serializePatch", () => {
  test("snake_case mapping + next_state obrigatório", () => {
    const out = serializePatch({
      state: "awaiting_vehicle",
      currentIntent: "log_expense",
      draftId: "abc",
      draftVersion: 2,
      draftPayload: { foo: 1 },
    });
    expect(out).toEqual({
      next_state: "awaiting_vehicle",
      current_intent: "log_expense",
      draft_id: "abc",
      draft_version: 2,
      draft_payload: { foo: 1 },
    });
  });

  test("valor null é preservado (limpa campo na RPC)", () => {
    const out = serializePatch({ state: "idle", currentIntent: null, draftId: null });
    expect(out.current_intent).toBeNull();
    expect(out.draft_id).toBeNull();
  });

  test("undefined é omitido", () => {
    const out = serializePatch({ state: "idle", currentIntent: undefined });
    expect("current_intent" in out).toBe(false);
  });

  test("state ausente/null → RepositoryError", () => {
    expect(() => serializePatch({} as never)).toThrow(/next_state/);
    expect(() => serializePatch({ state: null } as never)).toThrow(/next_state/);
  });

  test("lastMessageId (não aceito pela RPC) rejeita", () => {
    expect(() =>
      serializePatch({ state: "idle", lastMessageId: "xx" } as never),
    ).toThrow(/not accepted/);
  });
});

// ============================================================
// serializeResponse — snake_case, omite chaves undefined
// ============================================================

describe("serializeResponse", () => {
  test("null/undefined → null", () => {
    expect(serializeResponse(null)).toBeNull();
    expect(serializeResponse(undefined)).toBeNull();
  });

  test("mapeia campos e omite opcionais undefined", () => {
    const out = serializeResponse({
      responseKey: "greeting",
      textBody: "Olá",
    });
    expect(out).toEqual({ response_key: "greeting", text_body: "Olá" });
  });

  test("inclui priority/scheduled_at/expires_at quando presentes", () => {
    const out = serializeResponse({
      responseKey: "help",
      textBody: "x",
      priority: 5,
      scheduledAt: "2026-07-11T00:00:00Z",
      expiresAt: "2026-07-11T01:00:00Z",
    });
    expect(out).toEqual({
      response_key: "help",
      text_body: "x",
      priority: 5,
      scheduled_at: "2026-07-11T00:00:00Z",
      expires_at: "2026-07-11T01:00:00Z",
    });
  });
});

// ============================================================
// applyTransition — happy path e envio de resultSummary camelCase
// ============================================================

describe("applyTransition — contrato RPC", () => {
  test("envia p_result_summary em camelCase estrito", async () => {
    let capturedParams: Record<string, unknown> | null = null;
    const client = makeClient(async (_fn, params) => {
      capturedParams = params;
      return {
        data: { ok: true, wasReplay: false, orchestratorResult: OK_ORCH_RESULT },
        error: null,
      };
    });
    const repo = new WhatsappOrchestratorRepository(client);
    const res = await repo.applyTransition(BASE_TRANSITION);

    expect(res.ok).toBe(true);
    expect(capturedParams).not.toBeNull();
    const summary = (capturedParams as Record<string, unknown>).p_result_summary as Record<string, unknown>;
    expect(summary).toEqual({
      decisionKind: "no_op",
      eventKind: "unknown",
      outcome: "none",
    });
    // Não pode existir chave snake_case no summary.
    expect("decision_kind" in summary).toBe(false);
    expect("event_kind" in summary).toBe(false);
  });

  test("envia p_patch em snake_case com next_state", async () => {
    let capturedParams: Record<string, unknown> | null = null;
    const client = makeClient(async (_fn, params) => {
      capturedParams = params;
      return {
        data: { ok: true, wasReplay: false, orchestratorResult: OK_ORCH_RESULT },
        error: null,
      };
    });
    const repo = new WhatsappOrchestratorRepository(client);
    await repo.applyTransition({
      ...BASE_TRANSITION,
      patch: { state: "awaiting_vehicle", currentIntent: "log_expense" },
    });
    const patch = (capturedParams as Record<string, unknown>).p_patch as Record<string, unknown>;
    expect(patch.next_state).toBe("awaiting_vehicle");
    expect(patch.current_intent).toBe("log_expense");
  });

  test("response undefined → p_response null", async () => {
    let capturedParams: Record<string, unknown> | null = null;
    const client = makeClient(async (_fn, params) => {
      capturedParams = params;
      return {
        data: { ok: true, wasReplay: false, orchestratorResult: OK_ORCH_RESULT },
        error: null,
      };
    });
    const repo = new WhatsappOrchestratorRepository(client);
    await repo.applyTransition({ ...BASE_TRANSITION, response: undefined });
    expect((capturedParams as Record<string, unknown>).p_response).toBeNull();
  });
});

// ============================================================
// applyTransition — reasons e state_version_conflict
// ============================================================

describe("applyTransition — reasons", () => {
  test("state_version_conflict propaga currentStateVersion", async () => {
    const client = makeClient(async () => ({
      data: { ok: false, reason: "state_version_conflict", currentStateVersion: 42 },
      error: null,
    }));
    const repo = new WhatsappOrchestratorRepository(client);
    const res = await repo.applyTransition(BASE_TRANSITION);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("state_version_conflict");
      expect(res.currentStateVersion).toBe(42);
    }
  });

  test("lease_lost é reason válido", async () => {
    const client = makeClient(async () => ({
      data: { ok: false, reason: "lease_lost" },
      error: null,
    }));
    const repo = new WhatsappOrchestratorRepository(client);
    const res = await repo.applyTransition(BASE_TRANSITION);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("lease_lost");
  });

  test("reason desconhecido → UnknownReasonError", async () => {
    const client = makeClient(async () => ({
      data: { ok: false, reason: "orchestrator_invariant_violation" }, // reason da migration antiga
      error: null,
    }));
    const repo = new WhatsappOrchestratorRepository(client);
    await expect(repo.applyTransition(BASE_TRANSITION)).rejects.toBeInstanceOf(UnknownReasonError);
  });

  test("payload sem ok → MalformedResponseError", async () => {
    const client = makeClient(async () => ({ data: { foo: "bar" }, error: null }));
    const repo = new WhatsappOrchestratorRepository(client);
    await expect(repo.applyTransition(BASE_TRANSITION)).rejects.toBeInstanceOf(MalformedResponseError);
  });

  test("erro do supabase → RpcExceptionError com sqlState preservado", async () => {
    const client = makeClient(async () => ({
      data: null,
      error: { message: "boom", code: "42P01" },
    }));
    const repo = new WhatsappOrchestratorRepository(client);
    try {
      await repo.applyTransition(BASE_TRANSITION);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcExceptionError);
      expect((err as RpcExceptionError).sqlState).toBe("42P01");
    }
  });
});

// ============================================================
// applyTransition — durable replay
// ============================================================

describe("applyTransition — durable replay", () => {
  test("primeiro timeout → segunda chamada com mesmos params → sucesso wasReplay=true", async () => {
    let call = 0;
    const seenParams: Record<string, unknown>[] = [];
    const client = makeClient(async (_fn, params, opts) => {
      call += 1;
      seenParams.push(params);
      if (call === 1) {
        // Simula timeout: aborta o signal antes de responder.
        return await new Promise((_res, rej) => {
          opts?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            (e as { name?: string }).name = "AbortError";
            rej(e);
          });
        });
      }
      return {
        data: {
          ok: true,
          wasReplay: true,
          orchestratorResult: { ...OK_ORCH_RESULT, stateVersion: 4 },
        },
        error: null,
      };
    });
    const repo = new WhatsappOrchestratorRepository(client, { defaultTimeoutMs: 25 });
    const res = await repo.applyTransition(BASE_TRANSITION);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.wasReplay).toBe(true);
    expect(call).toBe(2);
    // Params da segunda chamada = idênticos aos da primeira.
    expect(seenParams[1]).toEqual(seenParams[0]);
  });

  test("dois timeouts consecutivos → TransportError", async () => {
    const client = makeClient(async (_fn, _params, opts) => {
      return await new Promise((_res, rej) => {
        opts?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          (e as { name?: string }).name = "AbortError";
          rej(e);
        });
      });
    });
    const repo = new WhatsappOrchestratorRepository(client, { defaultTimeoutMs: 15 });
    await expect(repo.applyTransition(BASE_TRANSITION)).rejects.toBeInstanceOf(TransportError);
  });

  test("timeout único NÃO promove a TransportError se o replay retorna reason", async () => {
    let call = 0;
    const client = makeClient(async (_fn, _params, opts) => {
      call += 1;
      if (call === 1) {
        return await new Promise((_res, rej) => {
          opts?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            (e as { name?: string }).name = "AbortError";
            rej(e);
          });
        });
      }
      return { data: { ok: false, reason: "queue_already_terminal" }, error: null };
    });
    const repo = new WhatsappOrchestratorRepository(client, { defaultTimeoutMs: 15 });
    const res = await repo.applyTransition(BASE_TRANSITION);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("queue_already_terminal");
  });

  test("abort externo é ambíguo e dispara replay", async () => {
    let call = 0;
    const externalAbort = new AbortController();
    const client = makeClient(async (_fn, _params, opts) => {
      call += 1;
      if (call === 1) {
        return await new Promise((_res, rej) => {
          opts?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            (e as { name?: string }).name = "AbortError";
            rej(e);
          });
          setTimeout(() => externalAbort.abort(), 5);
        });
      }
      return {
        data: { ok: true, wasReplay: true, orchestratorResult: OK_ORCH_RESULT },
        error: null,
      };
    });
    const repo = new WhatsappOrchestratorRepository(client);
    const res = await repo.applyTransition(BASE_TRANSITION, { signal: externalAbort.signal });
    expect(res.ok).toBe(true);
    expect(call).toBe(2);
  });
});

// ============================================================
// claim
// ============================================================

describe("claim", () => {
  test("mapeia colunas snake_case → camelCase e valida orchestrator_mode", async () => {
    const client = makeClient(async () => ({
      data: [
        {
          queue_id: "q1",
          message_id: "m1",
          contact_id: "c1",
          user_id: "u1",
          instance_pk: "i1",
          provider: "zapi",
          instance_id: "inst-1",
          queue_type: "orchestrator",
          message_type: "text",
          attempts: 0,
          max_attempts: 5,
          lease_token: "lt-1",
          lease_expires_at: "2026-07-11T00:00:00Z",
          was_recovered: false,
          orchestrator_mode: "active",
        },
      ],
      error: null,
    }));
    const repo = new WhatsappOrchestratorRepository(client);
    const items = await repo.claim({ workerId: "w1" });
    expect(items.length).toBe(1);
    expect(items[0].queueId).toBe("q1");
    expect(items[0].orchestratorMode).toBe("active");
    expect(items[0].userId).toBe("u1");
  });

  test("data null → []", async () => {
    const client = makeClient(async () => ({ data: null, error: null }));
    const repo = new WhatsappOrchestratorRepository(client);
    expect(await repo.claim({ workerId: "w1" })).toEqual([]);
  });

  test("orchestrator_mode inválido → MalformedResponseError", async () => {
    const client = makeClient(async () => ({
      data: [
        {
          queue_id: "q", message_id: "m", contact_id: "c", user_id: null,
          instance_pk: "i", provider: "zapi", instance_id: "x",
          queue_type: "orchestrator", message_type: "text",
          attempts: 0, max_attempts: 1, lease_token: "l",
          lease_expires_at: "t", was_recovered: false,
          orchestrator_mode: "shadow", // não aceito
        },
      ],
      error: null,
    }));
    const repo = new WhatsappOrchestratorRepository(client);
    await expect(repo.claim({ workerId: "w1" })).rejects.toBeInstanceOf(MalformedResponseError);
  });
});

// ============================================================
// release
// ============================================================

describe("release", () => {
  test("caminho happy → status/attempts/willRetry", async () => {
    const client = makeClient(async () => ({
      data: { ok: true, status: "queued", attempts: 1, willRetry: true },
      error: null,
    }));
    const repo = new WhatsappOrchestratorRepository(client);
    const res = await repo.release({
      queueItemId: "q",
      leaseToken: "l",
      reason: "transient",
      retryKind: "transient_error",
    });
    expect(res.ok).toBe(true);
    if (res.ok && "status" in res) {
      expect(res.status).toBe("queued");
      expect(res.attempts).toBe(1);
      expect(res.willRetry).toBe(true);
    }
  });

  test("replay durable via release (wasReplay=true)", async () => {
    const client = makeClient(async () => ({
      data: { ok: true, wasReplay: true, orchestratorResult: OK_ORCH_RESULT },
      error: null,
    }));
    const repo = new WhatsappOrchestratorRepository(client);
    const res = await repo.release({
      queueItemId: "q",
      leaseToken: "l",
      reason: "transient",
      retryKind: "transient_error",
    });
    expect(res.ok).toBe(true);
    if (res.ok && "wasReplay" in res && res.wasReplay) {
      expect(res.orchestratorResult.stateVersion).toBe(4);
    }
  });

  test("reason lease_lost mapeia direto", async () => {
    const client = makeClient(async () => ({
      data: { ok: false, reason: "lease_lost" },
      error: null,
    }));
    const repo = new WhatsappOrchestratorRepository(client);
    const res = await repo.release({
      queueItemId: "q",
      leaseToken: "l",
      reason: "x",
      retryKind: "cancelled",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("lease_lost");
  });

  test("release timeout NÃO faz replay automático (TransportError)", async () => {
    const client = makeClient(async (_fn, _params, opts) => {
      return await new Promise((_res, rej) => {
        opts?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          (e as { name?: string }).name = "AbortError";
          rej(e);
        });
      });
    });
    const repo = new WhatsappOrchestratorRepository(client, { defaultTimeoutMs: 10 });
    await expect(
      repo.release({
        queueItemId: "q",
        leaseToken: "l",
        reason: "x",
        retryKind: "transient_error",
      }),
    ).rejects.toBeInstanceOf(TransportError);
  });
});

// ============================================================
// Guardas PII no logger
// ============================================================

describe("logger sanitizado", () => {
  test("nenhum campo do log carrega phone/text_body/user data", async () => {
    const events: Array<Record<string, unknown>> = [];
    const client = makeClient(async () => ({
      data: { ok: true, wasReplay: false, orchestratorResult: OK_ORCH_RESULT },
      error: null,
    }));
    const repo = new WhatsappOrchestratorRepository(client, {
      logger: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    await repo.applyTransition({
      ...BASE_TRANSITION,
      response: { responseKey: "greeting", textBody: "Olá +55 11 99999-8888" },
    });
    for (const e of events) {
      const asJson = JSON.stringify(e);
      expect(asJson.includes("Olá")).toBe(false);
      expect(/\+?55/.test(asJson)).toBe(false);
    }
  });
});
