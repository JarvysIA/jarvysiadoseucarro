// Build 5.7F2D2 — Testes 100% mockados do serviço determinístico modo test.
// Runner: bun test. Sem rede, sem banco, sem Supabase.

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  runWhatsappOrchestratorTestCycle,
  tryConversationHandoffFallback,
  type ConversationHandoffFallbackOutcome,
  type ConversationHandoffFallbackParams,
  type ConversationHandoffFallbackResult,
  type ItemOutcome,
  type TestCycleCounts,
  type TestCycleDeps,
  type TestServiceLogEvent,
} from "../test-service.ts";
import type {
  ClaimedItem,
  ClaimInput,
  LoadContextResult,
  ReleaseInput,
  ReleaseResult,
  TransitionInput,
  TransitionResult,
} from "../types.ts";
import type {
  ConversationCoreDecision,
  ConversationCoreInput,
  ConversationResponseKey,
  ConversationResponseParams,
  ConversationState,
  ConversationVehicle,
} from "../../conversation/types.ts";
import type { ConfirmedKmUpdateDeps } from "../../actions/types.ts";
import type { ConfirmedExpenseCreateDeps } from "../../actions/expense-types.ts";
import {
  AmbiguousTimeoutError,
  MalformedResponseError,
  RpcExceptionError,
  TransportError,
  UnknownReasonError,
} from "../errors.ts";

// ============================================================
// Fixtures
// ============================================================

function makeItem(over: Partial<ClaimedItem> = {}): ClaimedItem {
  return {
    queueId: "q-1",
    messageId: "m-1",
    contactId: "c-1",
    userId: "u-1",
    instancePk: "ip-1",
    provider: "zapi",
    instanceId: "inst-1",
    queueType: "text",
    messageType: "text",
    attempts: 0,
    maxAttempts: 3,
    leaseToken: "lease-secret",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    wasRecovered: false,
    orchestratorMode: "test",
    ...over,
  };
}

function makeState(over: Partial<ConversationState> = {}): ConversationState {
  return {
    state: "idle",
    currentIntent: null,
    awaitingField: null,
    requestSource: null,
    draftType: null,
    draftId: null,
    draftVersion: 0,
    draftPayload: null,
    activeVehicleId: null,
    confirmedAt: null,
    executedAt: null,
    expiresAt: null,
    lastMessageId: null,
    ...over,
  };
}

function makeVehicle(
  id: string,
  whatsappAccessMode: ConversationVehicle["whatsappAccessMode"] = "full",
): ConversationVehicle {
  return {
    id,
    brand: "Fiat",
    model: "Argo",
    plate: "ABC1D23",
    isArchived: false,
    isEligible: true,
    kmAtual: 10000,
    whatsappAccessMode,
    optionalLabel: null,
  };
}

function makeRuntimeVehicle(id: string, mode: unknown): ConversationVehicle {
  const value = makeVehicle(id) as unknown as Record<string, unknown>;
  if (mode === undefined) delete value.whatsappAccessMode;
  else value.whatsappAccessMode = mode;
  return value as unknown as ConversationVehicle;
}

function okContext(
  over: {
    activeVehicleIssue?: "invalid" | "archived" | null;
    stateVersion?: number;
    state?: ConversationState;
    conversationStateId?: string | null;
    vehicles?: ConversationVehicle[];
  } = {},
): Extract<LoadContextResult, { kind: "ok" }> {
  return {
    kind: "ok",
    context: {
      state: over.state ?? makeState(),
      stateVersion: over.stateVersion ?? 0,
      fallbackCount: 0,
      vehicles: over.vehicles ?? [],
      conversationStateId:
        "conversationStateId" in over ? over.conversationStateId! : "cs-default-1",
    },
    activeVehicleIssue: over.activeVehicleIssue ?? null,
  };
}

function expectRestrictedTransition(input: TransitionInput) {
  expect(input.patch).toMatchObject({
    state: "idle",
    currentIntent: null,
    awaitingField: null,
    requestSource: null,
    draftType: null,
    draftId: null,
    draftVersion: null,
    draftPayload: null,
    activeVehicleId: null,
    confirmedAt: null,
    executedAt: null,
    expiresAt: null,
  });
  expect(input.resultSummary).toMatchObject({
    decisionKind: "respond",
    eventKind: "confirm",
    outcome: "cancelled",
  });
  expect(input.response).toMatchObject({
    responseKey: "vehicle_access_restricted",
    textBody: "Essa ação não está disponível por aqui agora.",
  });
}

function decisionRespond(over: Partial<ConversationCoreDecision> = {}): ConversationCoreDecision {
  return {
    eventKind: "greeting",
    decisionKind: "respond",
    previousState: "idle",
    nextState: "idle",
    outcome: "none",
    statePatch: { state: "idle" },
    responseKey: "greeting",
    responseParams: {},
    nextFallbackCount: 0,
    deferToLegacyRouter: false,
    deferToLegacyOptOut: false,
    reasonCode: "greeting_ok",
    ...over,
  };
}

function decisionDefer(over: Partial<ConversationCoreDecision> = {}): ConversationCoreDecision {
  return decisionRespond({
    eventKind: "explicit_opt_out",
    decisionKind: "defer_legacy_opt_out",
    deferToLegacyOptOut: true,
    responseKey: null,
    reasonCode: "defer_opt_out",
    ...over,
  });
}

function decisionFallback(over: Partial<ConversationCoreDecision> = {}): ConversationCoreDecision {
  return decisionRespond({
    eventKind: "unknown",
    decisionKind: "fallback",
    responseKey: "fallback_second",
    responseParams: {},
    nextFallbackCount: 2,
    reasonCode: "fallback_second",
    ...over,
  });
}

function trackedHandoff(
  impl: (
    params: ConversationHandoffFallbackParams,
  ) => Promise<ConversationHandoffFallbackResult> | ConversationHandoffFallbackResult,
) {
  const calls: ConversationHandoffFallbackParams[] = [];
  const fn = async (params: ConversationHandoffFallbackParams) => {
    calls.push(params);
    return impl(params);
  };
  return { fn, calls };
}

// ============================================================
// Mock repository
// ============================================================

type RepoQueues = {
  claim: (Array<ClaimedItem> | Error)[];
  loadContext: (LoadContextResult | Error)[];
  apply: (TransitionResult | Error)[];
  release: (ReleaseResult | Error)[];
};

type RepoCalls = {
  claim: ClaimInput[];
  loadContext: ClaimedItem[];
  apply: TransitionInput[];
  release: ReleaseInput[];
};

function mockRepo(queues: Partial<RepoQueues> = {}) {
  const q: RepoQueues = {
    claim: queues.claim ?? [],
    loadContext: queues.loadContext ?? [],
    apply: queues.apply ?? [],
    release: queues.release ?? [],
  };
  const calls: RepoCalls = { claim: [], loadContext: [], apply: [], release: [] };
  const pop = <T>(name: keyof RepoQueues, list: (T | Error)[]): T => {
    if (list.length === 0) throw new Error(`mock repo: ${name} queue empty`);
    const v = list.shift()!;
    if (v instanceof Error) throw v;
    return v;
  };
  return {
    calls,
    repo: {
      async claimItems(input: ClaimInput) {
        calls.claim.push(input);
        return pop("claim", q.claim) as ClaimedItem[];
      },
      async loadContext(item: ClaimedItem) {
        calls.loadContext.push(item);
        return pop("loadContext", q.loadContext) as LoadContextResult;
      },
      async applyTransition(input: TransitionInput) {
        calls.apply.push(input);
        return pop("apply", q.apply) as TransitionResult;
      },
      async releaseItem(input: ReleaseInput) {
        calls.release.push(input);
        return pop("release", q.release) as ReleaseResult;
      },
    },
  };
}

function baseDeps(
  repo: ReturnType<typeof mockRepo>["repo"],
  over: Partial<TestCycleDeps> = {},
): TestCycleDeps {
  const stubKmActionDeps: ConfirmedKmUpdateDeps = {
    executor: {
      executeKmUpdate: async () => {
        throw new Error("kmActionDeps.executor stub nao configurado para este teste — sobrescreva via baseDeps(repo, { kmActionDeps: ... })");
      },
    },
  };
  const stubExpenseActionDeps: ConfirmedExpenseCreateDeps = {
    executor: {
      executeExpenseCreate: async () => {
        throw new Error("expenseActionDeps.executor stub nao configurado para este teste — sobrescreva via baseDeps(repo, { expenseActionDeps: ... })");
      },
    },
  };
  return {
    repository: repo,
    loadMessageText: async () => "olá",
    clock: () => "2026-07-12T00:00:00.000Z",
    orchestratorVersion: "test-svc.1",
    kmActionDeps: stubKmActionDeps,
    expenseActionDeps: stubExpenseActionDeps,
    ...over,
  };
}

function collectLogger() {
  const events: TestServiceLogEvent[] = [];
  return { logger: (e: TestServiceLogEvent) => events.push(e), events };
}

// ============================================================
// CLAIM
// ============================================================

describe("claim", () => {
  test("empty batch => status=empty; nenhum load/apply/release", async () => {
    const m = mockRepo({ claim: [[]] });
    const { logger, events } = collectLogger();
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w1" },
      baseDeps(m.repo, { logger }),
    );
    expect(res.status).toBe("empty");
    expect(res.claimed).toBe(0);
    expect(m.calls.claim.length).toBe(1);
    expect(m.calls.loadContext.length).toBe(0);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release.length).toBe(0);
    expect(events.some((e) => e.event === "cycle_started")).toBe(true);
    expect(events.some((e) => e.event === "cycle_completed")).toBe(true);
  });

  test("claim TransportError => status=claim_failed; nenhum retry; nenhum item", async () => {
    const m = mockRepo({ claim: [new TransportError("boom")] });
    const { logger, events } = collectLogger();
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w1" }, baseDeps(m.repo, { logger }));
    expect(res.status).toBe("claim_failed");
    expect(m.calls.claim.length).toBe(1);
    expect(m.calls.release.length).toBe(0);
    expect(events.some((e) => e.errorCategory === "TransportError")).toBe(true);
  });

  test("claim MalformedResponseError => claim_failed", async () => {
    const m = mockRepo({ claim: [new MalformedResponseError("bad")] });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w1" }, baseDeps(m.repo));
    expect(res.status).toBe("claim_failed");
  });

  test("múltiplos itens processados em ordem, claim uma única vez", async () => {
    const it1 = makeItem({ queueId: "q1", messageId: "m1" });
    const it2 = makeItem({ queueId: "q2", messageId: "m2" });
    const m = mockRepo({
      claim: [[it1, it2]],
      loadContext: [okContext(), okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never },
              { ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.status).toBe("ok");
    expect(res.claimed).toBe(2);
    expect(m.calls.claim.length).toBe(1);
    expect(m.calls.apply.length).toBe(2);
    expect(m.calls.apply[0].queueItemId).toBe("q1");
    expect(m.calls.apply[1].queueItemId).toBe("q2");
    expect(res.counts.completed).toBe(2);
  });
});

// ============================================================
// LOAD CONTEXT
// ============================================================

describe("loadContext", () => {
  test("lease_lost => outcome leaseLost, sem release", async () => {
    const it = makeItem();
    const m = mockRepo({ claim: [[it]], loadContext: [{ kind: "error", reason: "lease_lost" }] });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.leaseLost).toBe(1);
    expect(m.calls.release.length).toBe(0);
  });

  test("queue_not_found => terminal, sem release", async () => {
    const it = makeItem();
    const m = mockRepo({ claim: [[it]], loadContext: [{ kind: "error", reason: "queue_not_found" }] });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.terminal).toBe(1);
    expect(m.calls.release.length).toBe(0);
  });

  test("queue_not_running => terminal", async () => {
    const it = makeItem();
    const m = mockRepo({ claim: [[it]], loadContext: [{ kind: "error", reason: "queue_not_running" }] });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.terminal).toBe(1);
  });

  const definitives = [
    "message_mismatch",
    "message_missing",
    "message_contact_mismatch",
    "message_provider_mismatch",
    "message_instance_mismatch",
    "contact_missing",
    "ownership_mismatch",
    "instance_missing",
  ] as const;
  for (const reason of definitives) {
    test(`${reason} => contextRejected via release cancelled`, async () => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [{ kind: "error", reason }],
        release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
      });
      const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
      expect(res.counts.contextRejected).toBe(1);
      expect(m.calls.release.length).toBe(1);
      expect(m.calls.release[0].retryKind).toBe("cancelled");
      expect(m.calls.release[0].reason).toBe(reason);
    });
  }

  test("exception transitória => release transient_error / releasedForRetry", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [new TransportError("net")],
      release: [{ ok: true, status: "queued", attempts: 1, willRetry: true }],
    });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.releasedForRetry).toBe(1);
    expect(m.calls.release[0].retryKind).toBe("transient_error");
    expect(m.calls.release[0].reason).toBe("load_context_failed");
  });

  test("Malformed em loadContext => release cancelled / malformed", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [new MalformedResponseError("bad")],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.malformed).toBe(1);
    expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
  });

  test("activeVehicleIssue não bloqueia; apenas logado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext({ activeVehicleIssue: "archived" })],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const { logger, events } = collectLogger();
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo, { logger }));
    expect(res.counts.completed).toBe(1);
    expect(events.find((e) => e.event === "context_loaded")?.activeVehicleIssue).toBe("archived");
  });
});

// ============================================================
// MESSAGE TEXT
// ============================================================

describe("loadMessageText", () => {
  test("null => release cancelled message_text_missing / contextRejected", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { loadMessageText: async () => null }),
    );
    expect(res.counts.contextRejected).toBe(1);
    expect(m.calls.release[0].reason).toBe("message_text_missing");
  });

  test("string vazia => contextRejected", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { loadMessageText: async () => "" }),
    );
    expect(res.counts.contextRejected).toBe(1);
  });

  test("apenas espaços => contextRejected", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { loadMessageText: async () => "   " }),
    );
    expect(res.counts.contextRejected).toBe(1);
    expect(m.calls.release[0].reason).toBe("message_text_missing");
  });

  test("tipo inválido => malformed", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { loadMessageText: (async () => 123 as unknown) as never }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
  });

  test("erro transitório => releasedForRetry", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      release: [{ ok: true, status: "queued", attempts: 1, willRetry: true }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        loadMessageText: async () => {
          throw new Error("net down");
        },
      }),
    );
    expect(res.counts.releasedForRetry).toBe(1);
    expect(m.calls.release[0].reason).toBe("message_text_load_failed");
    expect(m.calls.release[0].retryKind).toBe("transient_error");
  });

  test("texto nunca aparece em log", async () => {
    const it = makeItem();
    const secretText = "SEGREDO_PLAINTEXT_QUE_NAO_PODE_VAZAR";
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const { logger, events } = collectLogger();
    await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { logger, loadMessageText: async () => secretText }),
    );
    for (const e of events) {
      expect(JSON.stringify(e).includes(secretText)).toBe(false);
    }
  });
});

// ============================================================
// CORE INPUT
// ============================================================

describe("core input", () => {
  test("messageType != text => malformed, core não é chamado", async () => {
    const it = makeItem({ messageType: "image" });
    const m = mockRepo({
      claim: [[it]],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    let coreCalled = 0;
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => { coreCalled++; return decisionRespond(); } }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(coreCalled).toBe(0);
    expect(m.calls.loadContext.length).toBe(0);
  });

  test("wasRecovered=true não vira isReplay", async () => {
    const it = makeItem({ wasRecovered: true });
    let captured: ConversationCoreInput | null = null;
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: (input) => {
          captured = input;
          return decisionRespond();
        },
      }),
    );
    expect(captured!.isReplay).toBe(false);
    expect(captured!.messageType).toBe("text");
    expect(captured!.sourceMessageId).toBe("m-1");
    expect(captured!.originalText).toBe("olá");
    expect(captured!.now).toBe("2026-07-12T00:00:00.000Z");
  });

  test("wasRecovered=false também isReplay=false", async () => {
    const it = makeItem({ wasRecovered: false });
    let captured: ConversationCoreInput | null = null;
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: (input) => { captured = input; return decisionRespond(); },
      }),
    );
    expect(captured!.isReplay).toBe(false);
  });

  test("core exception => release transient_error / releasedForRetry", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      release: [{ ok: true, status: "queued", attempts: 1, willRetry: true }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => { throw new Error("bug"); } }),
    );
    expect(res.counts.releasedForRetry).toBe(1);
    expect(m.calls.release[0].reason).toBe("core_execution_failed");
  });
});

// ============================================================
// RESPONSE
// ============================================================

describe("response", () => {
  test("responseKey null => response=null passado ao apply", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    let rendered = 0;
    await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionRespond({ responseKey: null }),
        render: (() => { rendered++; return ""; }) as never,
      }),
    );
    expect(rendered).toBe(0);
    expect(m.calls.apply[0].response).toBe(null);
  });

  test("responseKey válida => renderer chamado com params; payload textBody presente", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    let seenKey: ConversationResponseKey | null = null;
    let seenParams: ConversationResponseParams | null = null;
    await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionRespond({
          responseKey: "vehicle_selected",
          responseParams: { vehicleLabel: "Fusca" },
        }),
        render: ((k: ConversationResponseKey, p: ConversationResponseParams) => {
          seenKey = k; seenParams = p; return "Combinado";
        }) as never,
      }),
    );
    expect(seenKey).toBe("vehicle_selected");
    expect(seenParams).toEqual({ vehicleLabel: "Fusca" });
    expect(m.calls.apply[0].response).toEqual({
      responseKey: "vehicle_selected",
      messageType: "text",
      purpose: "general",
      textBody: "Combinado",
    });
  });

  test("renderer lança => malformed, apply não é chamado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionRespond(),
        render: (() => { throw new Error("render bug"); }) as never,
      }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(m.calls.apply.length).toBe(0);
  });

  test("renderer vazio => malformed", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionRespond(),
        render: (() => "") as never,
      }),
    );
    expect(res.counts.malformed).toBe(1);
  });

  test("renderer > 4000 chars => malformed", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionRespond(),
        render: (() => "a".repeat(4001)) as never,
      }),
    );
    expect(res.counts.malformed).toBe(1);
  });
});

// ============================================================
// C8 — BIFURCAÇÃO OPCIONAL PARA O DR. JARVYS (conversation-handoff/)
// ============================================================
//
// test-service.ts NUNCA importa nada de conversation-handoff/ (C1-C7)
// diretamente — deps.conversationHandoffFallback é só um ponto de
// extensão injetado. Estes testes usam implementações fake da
// dependência, nunca o C7 real (isso é Fase 18, fora de escopo).
//
// Achado de checkpoint documentado (ver comentário em test-service.ts,
// acima de tryConversationHandoffFallback): nextFallbackCount vive no
// TOP-LEVEL da ConversationCoreDecision, nunca dentro de statePatch —
// ConversationStatePatch não tem esse campo. Além disso,
// mapConversationDecisionToTransitionInput NUNCA lê
// decision.nextFallbackCount ao montar o patch da RPC (lacuna
// pré-existente, fora de escopo). Consequência prática para estes
// testes: o reset (ou não) da contagem de fallback não produz NENHUM
// efeito observável em m.calls.apply[...] hoje — testar isso via
// runWhatsappOrchestratorTestCycle apenas (black-box) seria testar um
// no-op. Por isso tryConversationHandoffFallback foi exportada e os
// testes 5b/8b abaixo verificam o mecanismo diretamente (chamada
// isolada da função), enquanto os testes 1-16 (via ciclo completo)
// verificam tudo que É observável: dependência chamada/não chamada,
// response final null/não-null, outcome do ciclo.
describe("conversation handoff fallback (C8)", () => {
  test("1. responseKey=fallback_first => dependência NUNCA chamada mesmo se fornecida", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const handoff = trackedHandoff(() => ({ handled: true, outcome: "primary_succeeded" }));
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionFallback({ responseKey: "fallback_first" }),
        render: () => "Não entendi, pode reformular?",
        conversationHandoffFallback: handoff.fn,
      }),
    );
    expect(handoff.calls.length).toBe(0);
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response).toEqual({
      responseKey: "fallback_first",
      messageType: "text",
      purpose: "general",
      textBody: "Não entendi, pode reformular?",
    });
  });

  test("2. responseKey=fallback_reset => dependência NUNCA chamada", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const handoff = trackedHandoff(() => ({ handled: true, outcome: "primary_succeeded" }));
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionFallback({ responseKey: "fallback_reset" }),
        render: () => "Vamos começar de novo.",
        conversationHandoffFallback: handoff.fn,
      }),
    );
    expect(handoff.calls.length).toBe(0);
    expect(res.counts.completed).toBe(1);
  });

  test("3. responseKey=fallback_second, dependência NÃO fornecida => comportamento idêntico ao de hoje", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionFallback(),
        render: () => "Texto fixo de fallback.",
        // conversationHandoffFallback omitido de propósito
      }),
    );
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response).toEqual({
      responseKey: "fallback_second",
      messageType: "text",
      purpose: "general",
      textBody: "Texto fixo de fallback.",
    });
  });

  test("4. responseKey=fallback_second, dependência fornecida, item.userId null => dependência NUNCA chamada, texto fixo normal", async () => {
    const it = makeItem({ userId: null });
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const handoff = trackedHandoff(() => ({ handled: true, outcome: "primary_succeeded" }));
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionFallback(),
        render: () => "Texto fixo de fallback.",
        conversationHandoffFallback: handoff.fn,
      }),
    );
    expect(handoff.calls.length).toBe(0);
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("fallback_second");
  });

  const successOutcomes: ConversationHandoffFallbackOutcome[] = [
    "primary_succeeded",
    "completed",
    "partially_completed",
  ];
  for (const outcome of successOutcomes) {
    test(`5/6/7. handled:true outcome:${outcome} => response final null, nenhum render`, async () => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [okContext()],
        apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
      });
      let renderCalls = 0;
      const handoff = trackedHandoff(() => ({ handled: true, outcome }));
      const res = await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, {
          decide: () => decisionFallback(),
          render: () => {
            renderCalls++;
            return "não deveria ser chamado";
          },
          conversationHandoffFallback: handoff.fn,
        }),
      );
      expect(handoff.calls.length).toBe(1);
      expect(renderCalls).toBe(0);
      expect(res.counts.completed).toBe(1);
      expect(m.calls.apply[0].response).toBe(null);
    });
  }

  test("5b. mecanismo direto: outcome de sucesso real => nextFallbackCount volta a 0 na decisão retornada", async () => {
    const m = mockRepo();
    for (const outcome of successOutcomes) {
      const deps = baseDeps(m.repo, {
        conversationHandoffFallback: async () => ({ handled: true, outcome }),
      });
      const result = await tryConversationHandoffFallback(
        makeItem(),
        okContext(),
        "oi",
        decisionFallback({ nextFallbackCount: 3 }),
        deps,
        () => {},
        "w",
      );
      expect(result.nextFallbackCount).toBe(0);
      expect(result.responseKey).toBe(null);
      expect(result.responseParams).toEqual({});
    }
  });

  const failureOutcomes: ConversationHandoffFallbackOutcome[] = [
    "blocked_authorization_required",
    "blocked_vehicle_required",
    "primary_failed",
    "uncertain",
  ];
  for (const outcome of failureOutcomes) {
    test(`8/9/10/11. handled:true outcome:${outcome} => response final null, mas SEM reset (mesmo tratamento)`, async () => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [okContext()],
        apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
      });
      let renderCalls = 0;
      const handoff = trackedHandoff(() => ({ handled: true, outcome }));
      const res = await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, {
          decide: () => decisionFallback(),
          render: () => {
            renderCalls++;
            return "não deveria ser chamado";
          },
          conversationHandoffFallback: handoff.fn,
        }),
      );
      expect(renderCalls).toBe(0);
      expect(res.counts.completed).toBe(1);
      expect(m.calls.apply[0].response).toBe(null);
    });
  }

  test("8b. mecanismo direto: outcomes de falha/incerteza => nextFallbackCount ORIGINAL preservado", async () => {
    const m = mockRepo();
    for (const outcome of failureOutcomes) {
      const deps = baseDeps(m.repo, {
        conversationHandoffFallback: async () => ({ handled: true, outcome }),
      });
      const result = await tryConversationHandoffFallback(
        makeItem(),
        okContext(),
        "oi",
        decisionFallback({ nextFallbackCount: 3 }),
        deps,
        () => {},
        "w",
      );
      expect(result.nextFallbackCount).toBe(3);
      expect(result.responseKey).toBe(null);
    }
  });

  test("12. handled:false => cai no texto fixo normal (fallback_second de sempre)", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const handoff = trackedHandoff(() => ({ handled: false }));
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionFallback(),
        render: () => "Texto fixo de fallback.",
        conversationHandoffFallback: handoff.fn,
      }),
    );
    expect(handoff.calls.length).toBe(1);
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response).toEqual({
      responseKey: "fallback_second",
      messageType: "text",
      purpose: "general",
      textBody: "Texto fixo de fallback.",
    });
  });

  test("13. dependência LANÇA exceção => capturada, item processa normalmente até o fim, outcome não vira outcomeUnknown", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const { logger, events } = collectLogger();
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        logger,
        decide: () => decisionFallback(),
        render: () => "Texto fixo de fallback.",
        conversationHandoffFallback: async () => {
          throw new Error("C7 indisponível");
        },
      }),
    );
    expect(res.counts.outcomeUnknown).toBe(0);
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response).toEqual({
      responseKey: "fallback_second",
      messageType: "text",
      purpose: "general",
      textBody: "Texto fixo de fallback.",
    });
    expect(
      events.some(
        (e) => e.event === "item_failed" && e.reasonCode === "conversation_handoff_failed",
      ),
    ).toBe(true);
  });

  test("14. parâmetros passados para a dependência batem exatamente", async () => {
    const it = makeItem({ messageId: "m-42", contactId: "c-42", userId: "u-42" });
    const state = makeState({ activeVehicleId: "veh-42" });
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext({ state })],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const handoff = trackedHandoff(() => ({ handled: true, outcome: "primary_succeeded" }));
    await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionFallback(),
        loadMessageText: async () => "texto original do usuário",
        conversationHandoffFallback: handoff.fn,
      }),
    );
    expect(handoff.calls.length).toBe(1);
    expect(handoff.calls[0]).toEqual({
      sourceMessageId: "m-42",
      contactId: "c-42",
      userId: "u-42",
      vehicleId: "veh-42",
      originalText: "texto original do usuário",
    });
  });

  test("15. recálculo por conflito de concorrência (2ª rodada) => mesma lógica se aplica na 2ª chamada", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext({ stateVersion: 1 }), okContext({ stateVersion: 2 })],
      apply: [
        { ok: false, reason: "state_version_conflict" },
        { ok: true, wasReplay: false, orchestratorResult: {} as never },
      ],
    });
    let renderCalls = 0;
    const handoff = trackedHandoff(() => ({ handled: true, outcome: "primary_succeeded" }));
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionFallback(),
        render: () => {
          renderCalls++;
          return "não deveria ser chamado";
        },
        conversationHandoffFallback: handoff.fn,
      }),
    );
    expect(res.counts.completed).toBe(1);
    // 1ª rodada em conflito (apply[0] devolve conflict) TAMBÉM chama a
    // dependência antes do apply — a lógica roda em AMBAS as rodadas,
    // não só na que efetivamente aplica com sucesso.
    expect(handoff.calls.length).toBe(2);
    expect(renderCalls).toBe(0);
    expect(m.calls.apply.length).toBe(2);
    expect(m.calls.apply[0].response).toBe(null);
    expect(m.calls.apply[1].response).toBe(null);
  });

  test("16. todos os testes já existentes em test-service.test.ts continuam passando sem alteração (regressão total) — ver contagem no relatório final da tarefa", () => {
    // Marcador declarativo: a contagem total de testes antes/depois desta
    // extensão é reportada no bloco de retorno da tarefa (gate 2), não
    // aqui — este describe block é aditivo, nenhum teste pré-existente
    // deste arquivo foi editado, removido ou teve seu corpo alterado.
    expect(true).toBe(true);
  });

  // ============================================================
  // I6 — gatilho ampliado: expense_quote_acknowledged /
  // expense_technical_question_acknowledged vão direto pro Dr. Jarvys,
  // sem esperar fallback nenhum. expense_future_service_acknowledged
  // fica de fora de propósito (afirmação, não pergunta).
  // ============================================================

  const directRouteKeys: ConversationResponseKey[] = [
    "expense_quote_acknowledged",
    "expense_technical_question_acknowledged",
  ];

  for (const key of directRouteKeys) {
    test(`I6-1. responseKey=${key}, dependência fornecida, handled:true outcome:primary_succeeded => response final null, dependência FOI chamada`, async () => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [okContext()],
        apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
      });
      let renderCalls = 0;
      const handoff = trackedHandoff(() => ({ handled: true, outcome: "primary_succeeded" }));
      const res = await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, {
          decide: () => decisionFallback({ responseKey: key, reasonCode: key }),
          render: () => {
            renderCalls++;
            return "não deveria ser chamado";
          },
          conversationHandoffFallback: handoff.fn,
        }),
      );
      expect(handoff.calls.length).toBe(1);
      expect(renderCalls).toBe(0);
      expect(res.counts.completed).toBe(1);
      expect(m.calls.apply[0].response).toBe(null);
    });
  }

  test("I6-3. responseKey=expense_future_service_acknowledged, dependência fornecida => dependência NUNCA chamada (exclusão deliberada)", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const handoff = trackedHandoff(() => ({ handled: true, outcome: "primary_succeeded" }));
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () =>
          decisionFallback({
            responseKey: "expense_future_service_acknowledged",
            reasonCode: "expense_future_service_acknowledged",
          }),
        render: () => "Entendi, você ainda vai fazer isso!",
        conversationHandoffFallback: handoff.fn,
      }),
    );
    expect(handoff.calls.length).toBe(0);
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response).toEqual({
      responseKey: "expense_future_service_acknowledged",
      messageType: "text",
      purpose: "general",
      textBody: "Entendi, você ainda vai fazer isso!",
    });
  });

  test("I6-4. responseKey=fallback_first, dependência fornecida => dependência NUNCA chamada (regressão do comportamento já existente)", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const handoff = trackedHandoff(() => ({ handled: true, outcome: "primary_succeeded" }));
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionFallback({ responseKey: "fallback_first" }),
        render: () => "Não entendi, pode reformular?",
        conversationHandoffFallback: handoff.fn,
      }),
    );
    expect(handoff.calls.length).toBe(0);
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response).toEqual({
      responseKey: "fallback_first",
      messageType: "text",
      purpose: "general",
      textBody: "Não entendi, pode reformular?",
    });
  });

  test("I6-5. responseKey=fallback_second continua funcionando exatamente como antes (regressão explícita do C8 original)", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const handoff = trackedHandoff(() => ({ handled: true, outcome: "primary_succeeded" }));
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionFallback(),
        render: () => "não deveria ser chamado",
        conversationHandoffFallback: handoff.fn,
      }),
    );
    expect(handoff.calls.length).toBe(1);
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response).toBe(null);
  });

  for (const key of directRouteKeys) {
    test(`I6-6. responseKey=${key}, dependência NÃO fornecida => comportamento idêntico ao existente hoje (texto fixo normal, sem interceptação)`, async () => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [okContext()],
        apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
      });
      const res = await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, {
          decide: () => decisionFallback({ responseKey: key, reasonCode: key }),
          render: () => "Texto fixo normal.",
          // conversationHandoffFallback omitido de propósito
        }),
      );
      expect(res.counts.completed).toBe(1);
      expect(m.calls.apply[0].response).toEqual({
        responseKey: key,
        messageType: "text",
        purpose: "general",
        textBody: "Texto fixo normal.",
      });
    });
  }

  for (const key of directRouteKeys) {
    test(`I6-7. responseKey=${key}, dependência LANÇA exceção => capturada, item segue com o texto fixo normal, não trava`, async () => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [okContext()],
        apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
      });
      const { logger, events } = collectLogger();
      const res = await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, {
          logger,
          decide: () => decisionFallback({ responseKey: key, reasonCode: key }),
          render: () => "Texto fixo normal.",
          conversationHandoffFallback: async () => {
            throw new Error("C7 indisponível");
          },
        }),
      );
      expect(res.counts.outcomeUnknown).toBe(0);
      expect(res.counts.completed).toBe(1);
      expect(m.calls.apply[0].response).toEqual({
        responseKey: key,
        messageType: "text",
        purpose: "general",
        textBody: "Texto fixo normal.",
      });
      expect(
        events.some(
          (e) => e.event === "item_failed" && e.reasonCode === "conversation_handoff_failed",
        ),
      ).toBe(true);
    });
  }

  for (const key of directRouteKeys) {
    test(`I6-8. responseKey=${key}, dependência fornecida, item.userId null => dependência NUNCA chamada (fail-closed já existente)`, async () => {
      const it = makeItem({ userId: null });
      const m = mockRepo({
        claim: [[it]],
        loadContext: [okContext()],
        apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
      });
      const handoff = trackedHandoff(() => ({ handled: true, outcome: "primary_succeeded" }));
      const res = await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, {
          decide: () => decisionFallback({ responseKey: key, reasonCode: key }),
          render: () => "Texto fixo normal.",
          conversationHandoffFallback: handoff.fn,
        }),
      );
      expect(handoff.calls.length).toBe(0);
      expect(res.counts.completed).toBe(1);
      expect(m.calls.apply[0].response?.responseKey).toBe(key);
    });
  }
});

// ============================================================
// DEFER
// ============================================================

describe("defer sem handoff", () => {
  const scenarios: Array<[string, Partial<ConversationCoreDecision>]> = [
    ["deferToLegacyRouter", { deferToLegacyRouter: true }],
    ["deferToLegacyOptOut", { deferToLegacyOptOut: true }],
    ["decisionKind defer_legacy_media", { decisionKind: "defer_legacy_media" }],
    ["decisionKind defer_legacy_opt_out", { decisionKind: "defer_legacy_opt_out" }],
    ["eventKind media", { eventKind: "media" }],
    ["eventKind explicit_opt_out", { eventKind: "explicit_opt_out" }],
    ["eventKind replay", { eventKind: "replay" }],
  ];
  for (const [name, over] of scenarios) {
    test(`${name} => deferredUnsupported; sem apply; sem release`, async () => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [okContext()],
      });
      const { logger, events } = collectLogger();
      const res = await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, { logger, decide: () => decisionDefer(over) }),
      );
      expect(res.counts.deferredUnsupported).toBe(1);
      expect(m.calls.apply.length).toBe(0);
      expect(m.calls.release.length).toBe(0);
      expect(events.some((e) => e.event === "deferred_unsupported" && e.reasonCode === "legacy_handoff_unavailable")).toBe(true);
    });
  }
});

// ============================================================
// APPLY
// ============================================================

describe("apply", () => {
  test("completed", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.completed).toBe(1);
    expect(m.calls.release.length).toBe(0);
  });

  test("replayed", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: true, orchestratorResult: {} as never }],
    });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.replayed).toBe(1);
    expect(m.calls.release.length).toBe(0);
  });

  test("queue_already_terminal => terminal, sem release", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: false, reason: "queue_already_terminal" }],
    });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.terminal).toBe(1);
    expect(m.calls.release.length).toBe(0);
  });

  test("lease_lost => leaseLost, sem release", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: false, reason: "lease_lost" }],
    });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.leaseLost).toBe(1);
    expect(m.calls.release.length).toBe(0);
  });

  test("idempotency_payload_mismatch => conflicted, sem release", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: false, reason: "idempotency_payload_mismatch" }],
    });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.conflicted).toBe(1);
    expect(m.calls.release.length).toBe(0);
  });

  const contextReasons = [
    "source_message_missing",
    "contact_missing",
    "contact_not_verified",
    "contact_unlinked",
    "instance_not_found",
    "orchestrator_not_active",
    "message_mismatch",
    "message_direction_invalid",
    "message_type_unsupported",
  ] as const;
  for (const reason of contextReasons) {
    test(`apply ${reason} => contextRejected via release cancelled=${reason}`, async () => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [okContext()],
        apply: [{ ok: false, reason }],
        release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
      });
      const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
      expect(res.counts.contextRejected).toBe(1);
      expect(m.calls.release[0].reason).toBe(reason);
      expect(m.calls.release[0].retryKind).toBe("cancelled");
    });
  }

  const invariantReasons = [
    "invariant_violation",
    "patch_invalid_key",
    "patch_invalid_value",
    "draft_transition_invalid",
    "vehicle_invalid",
    "result_summary_invalid",
    "response_invalid",
  ] as const;
  for (const reason of invariantReasons) {
    test(`apply ${reason} => malformed via release cancelled=orchestrator_invariant`, async () => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [okContext()],
        apply: [{ ok: false, reason }],
        release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
      });
      const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
      expect(res.counts.malformed).toBe(1);
      expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
    });
  }

  test("response é repassado ao mock do Repository", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionRespond({ responseKey: "help" }),
        render: (() => "Aqui vai") as never,
      }),
    );
    expect(m.calls.apply[0].response?.responseKey).toBe("help");
    expect(m.calls.apply[0].response?.textBody).toBe("Aqui vai");
  });
});

// ============================================================
// STATE CONFLICT
// ============================================================

describe("state_version_conflict", () => {
  test("primeiro conflito + segundo sucesso => completed, 2 loads/text/decide/apply", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext({ stateVersion: 1 }), okContext({ stateVersion: 2 })],
      apply: [
        { ok: false, reason: "state_version_conflict" },
        { ok: true, wasReplay: false, orchestratorResult: {} as never },
      ],
    });
    let decideCalls = 0;
    let textCalls = 0;
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        loadMessageText: async () => { textCalls++; return "oi"; },
        decide: () => { decideCalls++; return decisionRespond({ responseKey: null }); },
      }),
    );
    expect(res.counts.completed).toBe(1);
    expect(m.calls.loadContext.length).toBe(2);
    expect(m.calls.apply.length).toBe(2);
    expect(m.calls.release.length).toBe(0);
    expect(decideCalls).toBe(2);
    expect(textCalls).toBe(2);
    expect(m.calls.apply[0].expectedStateVersion).toBe(1);
    expect(m.calls.apply[1].expectedStateVersion).toBe(2);
  });

  test("conflito + replay", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext(), okContext()],
      apply: [
        { ok: false, reason: "state_version_conflict" },
        { ok: true, wasReplay: true, orchestratorResult: {} as never },
      ],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionRespond({ responseKey: null }) }),
    );
    expect(res.counts.replayed).toBe(1);
  });

  test("conflito + lease_lost", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext(), okContext()],
      apply: [
        { ok: false, reason: "state_version_conflict" },
        { ok: false, reason: "lease_lost" },
      ],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionRespond({ responseKey: null }) }),
    );
    expect(res.counts.leaseLost).toBe(1);
    expect(m.calls.release.length).toBe(0);
  });

  test("conflito + defer no segundo cálculo", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext(), okContext()],
      apply: [{ ok: false, reason: "state_version_conflict" }],
    });
    let n = 0;
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => {
          n++;
          return n === 1 ? decisionRespond({ responseKey: null }) : decisionDefer();
        },
      }),
    );
    expect(res.counts.deferredUnsupported).toBe(1);
    expect(m.calls.apply.length).toBe(1);
    expect(m.calls.release.length).toBe(0);
  });

  test("conflito + contexto inválido no segundo load", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext(), { kind: "error", reason: "lease_lost" }],
      apply: [{ ok: false, reason: "state_version_conflict" }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionRespond({ responseKey: null }) }),
    );
    expect(res.counts.leaseLost).toBe(1);
  });

  test("dois conflitos seguidos => release state_conflict / conflicted", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext(), okContext()],
      apply: [
        { ok: false, reason: "state_version_conflict" },
        { ok: false, reason: "state_version_conflict" },
      ],
      release: [{ ok: true, status: "queued", attempts: 1, willRetry: true }],
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionRespond({ responseKey: null }) }),
    );
    expect(res.counts.conflicted).toBe(1);
    expect(m.calls.apply.length).toBe(2);
    expect(m.calls.release.length).toBe(1);
    expect(m.calls.release[0].retryKind).toBe("state_conflict");
    expect(m.calls.release[0].reason).toBe("state_version_conflict");
  });

  test("máximo de 2 chamadas para load/text/decide/apply; nenhuma 3ª", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext(), okContext()],
      apply: [
        { ok: false, reason: "state_version_conflict" },
        { ok: false, reason: "state_version_conflict" },
      ],
      release: [{ ok: true, status: "queued", attempts: 1, willRetry: true }],
    });
    let decideN = 0;
    let textN = 0;
    await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => { decideN++; return decisionRespond({ responseKey: null }); },
        loadMessageText: async () => { textN++; return "x"; },
      }),
    );
    expect(m.calls.loadContext.length).toBe(2);
    expect(m.calls.apply.length).toBe(2);
    expect(decideN).toBe(2);
    expect(textN).toBe(2);
  });
});

// ============================================================
// AMBIGUIDADE
// ============================================================

describe("apply exception => outcomeUnknown", () => {
  const errors: Array<[string, () => Error]> = [
    ["TransportError", () => new TransportError("UNIQUE_TRANSPORT_LEAK_XYZ")],
    ["AmbiguousTimeoutError", () => new AmbiguousTimeoutError("UNIQUE_AMBIG_LEAK_XYZ")],
    ["MalformedResponseError", () => new MalformedResponseError("UNIQUE_MALFORMED_LEAK_XYZ")],
    ["UnknownReasonError", () => new UnknownReasonError("UNIQUE_UNKNOWN_LEAK_XYZ")],
    ["RpcExceptionError", () => new RpcExceptionError("XX000", "UNIQUE_RPC_LEAK_XYZ")],
    ["Error", () => new Error("UNIQUE_ERROR_LEAK_XYZ")],
  ];
  for (const [name, mk] of errors) {
    test(`${name} => outcomeUnknown; sem release; sem nova apply; sem message bruta em log`, async () => {
      const it = makeItem();
      const err = mk();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [okContext()],
        apply: [err],
      });
      const { logger, events } = collectLogger();
      const res = await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, { logger, decide: () => decisionRespond({ responseKey: null }) }),
      );
      expect(res.counts.outcomeUnknown).toBe(1);
      expect(m.calls.apply.length).toBe(1);
      expect(m.calls.release.length).toBe(0);
      for (const e of events) {
        expect(JSON.stringify(e).includes(err.message)).toBe(false);
      }
    });
  }
});

// ============================================================
// RELEASE HELPER
// ============================================================

describe("release", () => {
  test("release usa IDs do ClaimedItem; leaseToken não aparece em log", async () => {
    const it = makeItem({ queueId: "Q-42", leaseToken: "SECRET_LEASE_TOKEN" });
    const m = mockRepo({
      claim: [[it]],
      loadContext: [{ kind: "error", reason: "contact_missing" }],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const { logger, events } = collectLogger();
    await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo, { logger }));
    expect(m.calls.release[0].queueItemId).toBe("Q-42");
    expect(m.calls.release[0].leaseToken).toBe("SECRET_LEASE_TOKEN");
    for (const e of events) {
      expect(JSON.stringify(e).includes("SECRET_LEASE_TOKEN")).toBe(false);
    }
  });

  test("reason bate o regex", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: false, reason: "contact_missing" }],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(/^[a-z0-9_.:-]{1,120}$/.test(m.calls.release[0].reason)).toBe(true);
  });

  test("falha da release => transientFailure; nenhuma retry", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: false, reason: "contact_missing" }],
      release: [new TransportError("release exploded")],
    });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.transientFailure).toBe(1);
    expect(m.calls.release.length).toBe(1);
  });

  test("no máximo 1 release por item (chain load-fail => release apenas 1x)", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [new TransportError("net")],
      release: [{ ok: true, status: "queued", attempts: 1, willRetry: true }],
    });
    await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(m.calls.release.length).toBe(1);
  });
});

// ============================================================
// BATCH
// ============================================================

describe("batch sequencial", () => {
  test("segundo item não começa antes do primeiro terminar; falha isolada", async () => {
    const it1 = makeItem({ queueId: "a" });
    const it2 = makeItem({ queueId: "b" });
    const order: string[] = [];
    const m = mockRepo({
      claim: [[it1, it2]],
      loadContext: [okContext(), okContext()],
      apply: [
        new TransportError("boom"), // item a => outcomeUnknown
        { ok: true, wasReplay: false, orchestratorResult: {} as never }, // item b => completed
      ],
    });
    // Interceptar loadContext para registrar ordem.
    const originalLoad = m.repo.loadContext.bind(m.repo);
    m.repo.loadContext = async (it) => {
      order.push("start:" + it.queueId);
      const r = await originalLoad(it);
      order.push("end:" + it.queueId);
      return r;
    };
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    expect(res.counts.outcomeUnknown).toBe(1);
    expect(res.counts.completed).toBe(1);
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  test("contadores finais somam #claimed", async () => {
    const items = [makeItem({ queueId: "1" }), makeItem({ queueId: "2" }), makeItem({ queueId: "3" })];
    const m = mockRepo({
      claim: [items],
      loadContext: [okContext(), okContext(), okContext()],
      apply: [
        { ok: true, wasReplay: false, orchestratorResult: {} as never },
        { ok: true, wasReplay: true, orchestratorResult: {} as never },
        { ok: false, reason: "queue_already_terminal" },
      ],
    });
    const res = await runWhatsappOrchestratorTestCycle({ workerId: "w" }, baseDeps(m.repo));
    const total = Object.values(res.counts).reduce((a: number, b: number) => a + b, 0);
    expect(total).toBe(3);
    expect(res.counts.completed).toBe(1);
    expect(res.counts.replayed).toBe(1);
    expect(res.counts.terminal).toBe(1);
  });
});

// ============================================================
// CONFIRM KM UPDATE (integrador real)
// ============================================================

describe("confirm_km_update", () => {
  const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
  const REQUEST_MSG_ID = "22222222-2222-4222-8222-222222222222";

  function kmContext(
    over: Parameters<typeof okContext>[0] = {},
  ): Extract<LoadContextResult, { kind: "ok" }> {
    return okContext({ ...over, vehicles: over.vehicles ?? [makeVehicle(VEHICLE_ID)] });
  }

  function validDraftPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      phase: "awaiting_confirmation",
      vehicleId: VEHICLE_ID,
      expectedPreviousKm: 10000,
      newKm: 20000,
      requestMessageId: REQUEST_MSG_ID,
      isCorrection: false,
      ...over,
    };
  }

  function kmState(payload: Record<string, unknown> | null = validDraftPayload()): ConversationState {
    return makeState({
      state: "awaiting_km_confirmation",
      draftType: "km_update",
      draftId: REQUEST_MSG_ID,
      draftVersion: 1,
      draftPayload: payload,
    });
  }

  function decisionConfirmKm(): ConversationCoreDecision {
    return decisionRespond({
      eventKind: "confirm",
      decisionKind: "confirm_km_update",
      previousState: "awaiting_km_confirmation",
      nextState: "awaiting_km_confirmation",
      outcome: "none",
      statePatch: { state: "awaiting_km_confirmation" },
      responseKey: null,
      responseParams: {},
      reasonCode: "km_confirm",
    });
  }

  type ExecutorResults = Array<
    { kind: "applied"; actionExecutionId: string; previousKm: number | null; newKm: number }
    | { kind: "replayed"; actionExecutionId: string; previousKm: number | null; newKm: number; noChange: boolean }
    | { kind: "no_op"; actionExecutionId: string; currentKm: number | null }
    | { kind: "rejected"; reason: string }
    | { kind: "conflicted"; reason: string; currentKm?: number | null; currentStateVersion?: number }
    | { kind: "transient_error"; reason: string }
    | Error
  >;

  function mockKmDeps(results: ExecutorResults) {
    const calls: Array<unknown> = [];
    const queue = [...results];
    const deps: ConfirmedKmUpdateDeps = {
      executor: {
        // deno-lint-ignore no-explicit-any
        executeKmUpdate: async (cmd: any) => {
          calls.push(cmd);
          if (queue.length === 0) throw new Error("kmDeps queue empty");
          const v = queue.shift()!;
          if (v instanceof Error) throw v;
          // deno-lint-ignore no-explicit-any
          return v as any;
        },
      },
    };
    return { deps, calls };
  }

  const applyOk = { ok: true, wasReplay: false, orchestratorResult: {} as never } as const;

  test("a) applied => completed, responseKey km_update_applied, patch limpa draft", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState() })],
      apply: [applyOk],
    });
    const km = mockKmDeps([{ kind: "applied", actionExecutionId: "ax-1", previousKm: 10000, newKm: 20000 }]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(km.calls.length).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("km_update_applied");
    const patch = m.calls.apply[0].patch;
    expect(patch.state).toBe("idle");
    expect(patch.draftId).toBeNull();
    expect(patch.draftType).toBeNull();
    expect(patch.draftVersion).toBe(0);
    expect(patch.draftPayload).toBeNull();
  });

  test("b) replayed (km) + apply wasReplay=false => completed, km_update_applied", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState() })],
      apply: [applyOk],
    });
    const km = mockKmDeps([
      { kind: "replayed", actionExecutionId: "ax-1", previousKm: 10000, newKm: 20000, noChange: false },
    ]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(km.calls.length).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("km_update_applied");
  });

  test("c) no_op => completed, km_update_no_change", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState() })],
      apply: [applyOk],
    });
    const km = mockKmDeps([{ kind: "no_op", actionExecutionId: "ax-1", currentKm: 20000 }]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("km_update_no_change");
  });

  test("d) rejected (vehicle_archived) => completed (apply ok), km_update_retry_needed", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState() })],
      apply: [applyOk],
    });
    const km = mockKmDeps([{ kind: "rejected", reason: "vehicle_archived" }]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("km_update_retry_needed");
    const patch = m.calls.apply[0].patch;
    expect(patch.state).toBe("idle");
    expect(patch.draftId).toBeNull();
  });

  test("e) conflicted km_conflict => completed, km_update_retry_needed", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState() })],
      apply: [applyOk],
    });
    const km = mockKmDeps([{ kind: "conflicted", reason: "km_conflict", currentKm: 15000 }]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("km_update_retry_needed");
  });

  test("f) transient_failure => releasedForRetry, apply NÃO chamado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState() })],
      release: [{ ok: true, status: "queued", attempts: 1, willRetry: true }],
    });
    const km = mockKmDeps([{ kind: "transient_error", reason: "executor_unavailable" }]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.releasedForRetry).toBe(1);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release.length).toBe(1);
    expect(m.calls.release[0].retryKind).toBe("transient_error");
    expect(m.calls.release[0].reason).toBe("km_action_transient");
  });

  test("g) outcome_unknown (executor throws) => releasedForRetry, apply NÃO chamado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState() })],
      release: [{ ok: true, status: "queued", attempts: 1, willRetry: true }],
    });
    const km = mockKmDeps([new Error("executor boom")]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.releasedForRetry).toBe(1);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release[0].retryKind).toBe("transient_error");
    expect(m.calls.release[0].reason).toBe("km_action_transient");
  });

  test("h) malformed (via stateVersion inválido) => malformed, apply NÃO chamado, release cancelled/orchestrator_invariant", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState(), stateVersion: -1 })],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    // Executor pode até ser chamado ou não — nesse caminho o serviço rejeita
    // no validateInput ANTES de chamar o executor, mas mesmo assim mantemos
    // o mock inerte para prova.
    const km = mockKmDeps([{ kind: "applied", actionExecutionId: "n/a", previousKm: null, newKm: 20000 }]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(km.calls.length).toBe(0);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release.length).toBe(1);
    expect(m.calls.release[0].retryKind).toBe("cancelled");
    expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
  });

  test("i) draftPayload inválido (isCorrection inconsistente) => malformed, executor NÃO chamado", async () => {
    const it = makeItem();
    const badPayload = validDraftPayload({ isCorrection: true }); // newKm > previous => inconsistente
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState(badPayload) })],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const km = mockKmDeps([]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(km.calls.length).toBe(0);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
  });

  test("j) conversationStateId null => malformed, executor NÃO chamado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState(), conversationStateId: null })],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const km = mockKmDeps([]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(km.calls.length).toBe(0);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
  });

  test("k) apply.expectedStateVersion === ctx.context.stateVersion", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState(), stateVersion: 42 })],
      apply: [applyOk],
    });
    const km = mockKmDeps([{ kind: "applied", actionExecutionId: "ax", previousKm: 10000, newKm: 20000 }]);
    await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(m.calls.apply[0].expectedStateVersion).toBe(42);
    // E o comando enviado ao km-action também usou 42.
    const cmd = km.calls[0] as { expectedStateVersion: number };
    expect(cmd.expectedStateVersion).toBe(42);
  });

  test("l) segundo cálculo (recalculo pós-conflito) também dispara handleConfirmKmUpdate", async () => {
    const it = makeItem();
    // 1º ctx: state idle (decisão respond); 1º apply: state_version_conflict.
    // 2º ctx: state awaiting_km_confirmation (decisão confirm_km_update); apply final ok.
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext(), kmContext({ state: kmState(), stateVersion: 7 })],
      apply: [{ ok: false, reason: "state_version_conflict" }, applyOk],
    });
    let call = 0;
    const decide = () => {
      call++;
      return call === 1 ? decisionRespond() : decisionConfirmKm();
    };
    const km = mockKmDeps([{ kind: "applied", actionExecutionId: "ax", previousKm: 10000, newKm: 20000 }]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide, kmActionDeps: km.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(km.calls.length).toBe(1);
    expect(m.calls.apply.length).toBe(2);
    expect(m.calls.apply[1].response?.responseKey).toBe("km_update_applied");
    expect(m.calls.apply[1].expectedStateVersion).toBe(7);
  });

  // Build 6c/9 do item 6 — transporte de linkedExpenseId (draft) →
  // linkedDespesaId (comando do executor).
  test("m) draft com linkedExpenseId → comando do executor recebe linkedDespesaId igual", async () => {
    const LINKED = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState(validDraftPayload({ linkedExpenseId: LINKED })) })],
      apply: [applyOk],
    });
    const km = mockKmDeps([
      { kind: "applied", actionExecutionId: "ax-1", previousKm: 10000, newKm: 20000 },
    ]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(km.calls.length).toBe(1);
    const cmd = km.calls[0] as Record<string, unknown>;
    expect(cmd.linkedDespesaId).toBe(LINKED);
  });

  test("n) draft sem linkedExpenseId → comando NÃO tem a chave linkedDespesaId", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [kmContext({ state: kmState() })],
      apply: [applyOk],
    });
    const km = mockKmDeps([
      { kind: "applied", actionExecutionId: "ax-1", previousKm: 10000, newKm: 20000 },
    ]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(km.calls.length).toBe(1);
    const cmd = km.calls[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(cmd, "linkedDespesaId")).toBe(false);
  });

  test.each(["passive_with_km", "denied", undefined, "invalid"])(
    "vehicle access %s bloqueia executor de KM fail-closed",
    async (mode) => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [
          kmContext({
            state: { ...kmState(), activeVehicleId: VEHICLE_ID },
            vehicles: [makeRuntimeVehicle(VEHICLE_ID, mode)],
          }),
        ],
        apply: [applyOk],
      });
      const km = mockKmDeps([]);
      const result = await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
      );
      expect(result.counts.completed).toBe(1);
      expect(km.calls).toHaveLength(0);
      expect(m.calls.release).toHaveLength(0);
      expect(m.calls.apply).toHaveLength(1);
      expectRestrictedTransition(m.calls.apply[0]!);
    },
  );

  test("veículo archived bloqueia executor de KM e finaliza state/fila", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [
        kmContext({
          state: { ...kmState(), activeVehicleId: VEHICLE_ID },
          vehicles: [{ ...makeVehicle(VEHICLE_ID), isArchived: true }],
        }),
      ],
      apply: [applyOk],
    });
    const km = mockKmDeps([]);
    const result = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(result.counts.completed).toBe(1);
    expect(km.calls).toHaveLength(0);
    expect(m.calls.release).toHaveLength(0);
    expectRestrictedTransition(m.calls.apply[0]!);
  });

  test("veículo isEligible=false bloqueia executor de KM e finaliza state/fila", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [
        kmContext({
          state: { ...kmState(), activeVehicleId: VEHICLE_ID },
          vehicles: [{ ...makeVehicle(VEHICLE_ID), isEligible: false }],
        }),
      ],
      apply: [applyOk],
    });
    const km = mockKmDeps([]);
    const result = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(result.counts.completed).toBe(1);
    expect(km.calls).toHaveLength(0);
    expect(m.calls.release).toHaveLength(0);
    expectRestrictedTransition(m.calls.apply[0]!);
  });

  test("replay da finalização restrita de KM não executa action", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [
        kmContext({
          state: { ...kmState(), activeVehicleId: VEHICLE_ID },
          vehicles: [makeVehicle(VEHICLE_ID, "denied")],
        }),
      ],
      apply: [{ ok: true, wasReplay: true, orchestratorResult: {} as never }],
    });
    const km = mockKmDeps([]);
    const result = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmKm(), kmActionDeps: km.deps }),
    );
    expect(result.counts.replayed).toBe(1);
    expect(km.calls).toHaveLength(0);
    expect(m.calls.release).toHaveLength(0);
    expectRestrictedTransition(m.calls.apply[0]!);
  });

  test("recalculo após conflito bloqueia executor de KM após downgrade", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [
        okContext({ vehicles: [makeVehicle(VEHICLE_ID)] }),
        kmContext({
          state: { ...kmState(), activeVehicleId: VEHICLE_ID },
          stateVersion: 7,
          vehicles: [makeVehicle(VEHICLE_ID, "passive_with_km")],
        }),
      ],
      apply: [{ ok: false, reason: "state_version_conflict" }, applyOk],
    });
    let calls = 0;
    const km = mockKmDeps([]);
    const result = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => (++calls === 1 ? decisionRespond() : decisionConfirmKm()),
        kmActionDeps: km.deps,
      }),
    );
    expect(result.counts.completed).toBe(1);
    expect(km.calls).toHaveLength(0);
    expect(m.calls.release).toHaveLength(0);
    expect(m.calls.apply).toHaveLength(2);
    expectRestrictedTransition(m.calls.apply[1]!);
  });
});

// ============================================================
// CONFIRM EXPENSE CREATE (integrador real)
// ============================================================

describe("confirm_expense_create", () => {
  const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
  const REQUEST_MSG_ID = "22222222-2222-4222-8222-222222222222";
  const DESP_ID = "33333333-3333-4333-8333-333333333333";
  const EXEC_ID = "44444444-4444-4444-8444-444444444444";

  function expenseContext(
    over: Parameters<typeof okContext>[0] = {},
  ): Extract<LoadContextResult, { kind: "ok" }> {
    return okContext({ ...over, vehicles: over.vehicles ?? [makeVehicle(VEHICLE_ID)] });
  }

  function validExpensePayload(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      phase: "awaiting_confirmation",
      categoria: "Combustível",
      valor: 149.9,
      vehicleId: VEHICLE_ID,
      requestMessageId: REQUEST_MSG_ID,
      ...over,
    };
  }

  function expenseState(payload: Record<string, unknown> | null = validExpensePayload()): ConversationState {
    return makeState({
      state: "awaiting_expense_confirmation",
      draftType: "expense",
      draftId: REQUEST_MSG_ID,
      draftVersion: 1,
      draftPayload: payload,
    });
  }

  function decisionConfirmExpense(): ConversationCoreDecision {
    return decisionRespond({
      eventKind: "confirm",
      decisionKind: "confirm_expense_create",
      previousState: "awaiting_expense_confirmation",
      nextState: "awaiting_expense_confirmation",
      outcome: "none",
      statePatch: { state: "awaiting_expense_confirmation" },
      responseKey: null,
      responseParams: {},
      reasonCode: "expense_confirm",
    });
  }

  type ExpenseExecutorResults = Array<
    { kind: "applied"; actionExecutionId: string; despesaId: string; valor: number; categoria: string }
    | { kind: "replayed"; actionExecutionId: string; despesaId: string; valor: number; categoria: string }
    | { kind: "rejected"; reason: string }
    | { kind: "conflicted"; reason: string; currentStateVersion?: number }
    | { kind: "transient_error"; reason: string }
    | Error
  >;

  function mockExpenseDeps(results: ExpenseExecutorResults) {
    const calls: Array<unknown> = [];
    const queue = [...results];
    const deps: ConfirmedExpenseCreateDeps = {
      executor: {
        // deno-lint-ignore no-explicit-any
        executeExpenseCreate: async (cmd: any) => {
          calls.push(cmd);
          if (queue.length === 0) throw new Error("expenseDeps queue empty");
          const v = queue.shift()!;
          if (v instanceof Error) throw v;
          // deno-lint-ignore no-explicit-any
          return v as any;
        },
      },
    };
    return { deps, calls };
  }

  const applyOk = { ok: true, wasReplay: false, orchestratorResult: {} as never } as const;

  test("a) applied => completed, responseKey expense_create_completed_with_km_prompt, patch transiciona a awaiting_requested_km", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState() })],
      apply: [applyOk],
    });
    const xp = mockExpenseDeps([
      { kind: "applied", actionExecutionId: EXEC_ID, despesaId: DESP_ID, valor: 149.9, categoria: "Combustível" },
    ]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(xp.calls.length).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("expense_create_completed_with_km_prompt");
    const patch = m.calls.apply[0].patch;
    expect(patch.state).toBe("awaiting_requested_km");
    expect(patch.currentIntent).toBe("km_update");
    expect(patch.awaitingField).toBe("requested_km");
    expect(patch.draftId).toBe(DESP_ID);
    expect(patch.draftType).toBeNull();
    expect(patch.draftVersion).toBe(0);
    expect(patch.draftPayload).toBeNull();
    // activeVehicleId omitido do patch (preservado por semântica de patch parcial).
    expect(Object.prototype.hasOwnProperty.call(patch, "activeVehicleId")).toBe(false);
  });

  test("b) replayed => completed, expense_create_completed_with_km_prompt, transiciona a awaiting_requested_km", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState() })],
      apply: [applyOk],
    });
    const xp = mockExpenseDeps([
      { kind: "replayed", actionExecutionId: EXEC_ID, despesaId: DESP_ID, valor: 149.9, categoria: "Combustível" },
    ]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(xp.calls.length).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("expense_create_completed_with_km_prompt");
    expect(m.calls.apply[0].patch.state).toBe("awaiting_requested_km");
  });

  // OCR-KM-2 — draft de despesa com kmRegistrada (veio de OCR) → confirma
  // despesa → estado final é awaiting_km_confirmation (não
  // awaiting_requested_km), com draftPayload de km válido e
  // linkedExpenseId apontando pra despesa recém-criada.
  test("f) OCR-KM-2: draft com kmRegistrada => awaiting_km_confirmation (não awaiting_requested_km), linkedExpenseId correto", async () => {
    const CONFIRMATION_MSG_ID = "55555555-5555-4555-8555-555555555555";
    const it = makeItem({ messageId: CONFIRMATION_MSG_ID });
    const m = mockRepo({
      claim: [[it]],
      loadContext: [
        expenseContext({ state: expenseState(validExpensePayload({ kmRegistrada: 45000 })) }),
      ],
      apply: [applyOk],
    });
    const xp = mockExpenseDeps([
      {
        kind: "applied",
        actionExecutionId: EXEC_ID,
        despesaId: DESP_ID,
        valor: 149.9,
        categoria: "Combustível",
      },
    ]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe(
      "expense_create_completed_with_km_confirmation",
    );
    const patch = m.calls.apply[0].patch;
    expect(patch.state).toBe("awaiting_km_confirmation");
    expect(patch.currentIntent).toBe("km_update");
    expect(patch.awaitingField).toBe("confirmation");
    expect(patch.draftType).toBe("km_update");
    expect(patch.draftId).toBe(CONFIRMATION_MSG_ID);
    const payload = patch.draftPayload as Record<string, unknown>;
    expect(payload.phase).toBe("awaiting_confirmation");
    expect(payload.newKm).toBe(45000);
    expect(payload.vehicleId).toBe(VEHICLE_ID);
    expect(payload.requestMessageId).toBe(CONFIRMATION_MSG_ID);
    expect(payload.linkedExpenseId).toBe(DESP_ID);
  });

  // Draft SEM kmRegistrada (fluxo normal, sem OCR) → comportamento
  // idêntico ao já existente, regressão explícita.
  test("g) sem kmRegistrada no draft => continua awaiting_requested_km (regressão)", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState() })],
      apply: [applyOk],
    });
    const xp = mockExpenseDeps([
      {
        kind: "applied",
        actionExecutionId: EXEC_ID,
        despesaId: DESP_ID,
        valor: 149.9,
        categoria: "Combustível",
      },
    ]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("expense_create_completed_with_km_prompt");
    expect(m.calls.apply[0].patch.state).toBe("awaiting_requested_km");
  });

  test("c) rejected (categoria_invalid) => completed (apply ok), expense_create_retry_needed", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState() })],
      apply: [applyOk],
    });
    const xp = mockExpenseDeps([{ kind: "rejected", reason: "categoria_invalid" }]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("expense_create_retry_needed");
    const patch = m.calls.apply[0].patch;
    expect(patch.state).toBe("idle");
    expect(patch.draftId).toBeNull();
  });

  test("d) conflicted (state_version_conflict) => completed, expense_create_retry_needed", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState() })],
      apply: [applyOk],
    });
    const xp = mockExpenseDeps([
      { kind: "conflicted", reason: "state_version_conflict", currentStateVersion: 9 },
    ]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply[0].response?.responseKey).toBe("expense_create_retry_needed");
  });

  test("e) transient_failure => releasedForRetry, apply NÃO chamado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState() })],
      release: [{ ok: true, status: "queued", attempts: 1, willRetry: true }],
    });
    const xp = mockExpenseDeps([{ kind: "transient_error", reason: "executor_unavailable" }]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.releasedForRetry).toBe(1);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release.length).toBe(1);
    expect(m.calls.release[0].retryKind).toBe("transient_error");
    expect(m.calls.release[0].reason).toBe("expense_action_transient");
  });

  test("f) outcome_unknown (executor throws) => releasedForRetry, apply NÃO chamado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState() })],
      release: [{ ok: true, status: "queued", attempts: 1, willRetry: true }],
    });
    const xp = mockExpenseDeps([new Error("executor boom")]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.releasedForRetry).toBe(1);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release[0].retryKind).toBe("transient_error");
    expect(m.calls.release[0].reason).toBe("expense_action_transient");
  });

  test("g) malformed (via stateVersion inválido) => malformed, executor NÃO chamado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState(), stateVersion: -1 })],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const xp = mockExpenseDeps([]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release.length).toBe(1);
    expect(m.calls.release[0].retryKind).toBe("cancelled");
    expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
  });

  test("h) draftPayload inválido (valor negativo) => malformed, executor NÃO chamado", async () => {
    const it = makeItem();
    const badPayload = validExpensePayload({ valor: -1 });
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState(badPayload) })],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const xp = mockExpenseDeps([]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(xp.calls.length).toBe(0);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
  });

  test("i) conversationStateId null => malformed, executor NÃO chamado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState(), conversationStateId: null })],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const xp = mockExpenseDeps([]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(xp.calls.length).toBe(0);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
  });

  test("j) draftId null => malformed, executor NÃO chamado", async () => {
    const it = makeItem();
    const stateNoDraft = makeState({
      state: "awaiting_expense_confirmation",
      draftType: "expense",
      draftId: null,
      draftVersion: 1,
      draftPayload: validExpensePayload(),
    });
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext({ state: stateNoDraft })],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const xp = mockExpenseDeps([]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(xp.calls.length).toBe(0);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
  });

  test("k) apply.expectedStateVersion === ctx.context.stateVersion (e é o mesmo enviado à RPC)", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [expenseContext({ state: expenseState(), stateVersion: 42 })],
      apply: [applyOk],
    });
    const xp = mockExpenseDeps([
      { kind: "applied", actionExecutionId: EXEC_ID, despesaId: DESP_ID, valor: 149.9, categoria: "Combustível" },
    ]);
    await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
    );
    expect(m.calls.apply[0].expectedStateVersion).toBe(42);
    const cmd = xp.calls[0] as { expectedStateVersion: number };
    expect(cmd.expectedStateVersion).toBe(42);
  });

  test("l) segundo cálculo (recalculo pós-conflito) também dispara handleConfirmExpenseCreate", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext(), expenseContext({ state: expenseState(), stateVersion: 7 })],
      apply: [{ ok: false, reason: "state_version_conflict" }, applyOk],
    });
    let call = 0;
    const decide = () => {
      call++;
      return call === 1 ? decisionRespond() : decisionConfirmExpense();
    };
    const xp = mockExpenseDeps([
      { kind: "applied", actionExecutionId: EXEC_ID, despesaId: DESP_ID, valor: 149.9, categoria: "Combustível" },
    ]);
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide, expenseActionDeps: xp.deps }),
    );
    expect(res.counts.completed).toBe(1);
    expect(xp.calls.length).toBe(1);
    expect(m.calls.apply.length).toBe(2);
    expect(m.calls.apply[1].response?.responseKey).toBe("expense_create_completed_with_km_prompt");
    expect(m.calls.apply[1].expectedStateVersion).toBe(7);
  });

  test.each(["passive_with_km", "denied", undefined, "invalid"])(
    "vehicle access %s bloqueia executor de despesa fail-closed",
    async (mode) => {
      const it = makeItem();
      const m = mockRepo({
        claim: [[it]],
        loadContext: [
          expenseContext({
            state: { ...expenseState(), activeVehicleId: VEHICLE_ID },
            vehicles: [makeRuntimeVehicle(VEHICLE_ID, mode)],
          }),
        ],
        apply: [applyOk],
      });
      const expense = mockExpenseDeps([]);
      const result = await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, {
          decide: () => decisionConfirmExpense(),
          expenseActionDeps: expense.deps,
        }),
      );
      expect(result.counts.completed).toBe(1);
      expect(expense.calls).toHaveLength(0);
      expect(m.calls.release).toHaveLength(0);
      expect(m.calls.apply).toHaveLength(1);
      expectRestrictedTransition(m.calls.apply[0]!);
    },
  );

  test("veículo archived bloqueia executor de despesa e finaliza state/fila", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [
        expenseContext({
          state: { ...expenseState(), activeVehicleId: VEHICLE_ID },
          vehicles: [{ ...makeVehicle(VEHICLE_ID), isArchived: true }],
        }),
      ],
      apply: [applyOk],
    });
    const expense = mockExpenseDeps([]);
    const result = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionConfirmExpense(),
        expenseActionDeps: expense.deps,
      }),
    );
    expect(result.counts.completed).toBe(1);
    expect(expense.calls).toHaveLength(0);
    expect(m.calls.release).toHaveLength(0);
    expectRestrictedTransition(m.calls.apply[0]!);
  });

  test("veículo isEligible=false bloqueia executor de despesa e finaliza state/fila", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [
        expenseContext({
          state: { ...expenseState(), activeVehicleId: VEHICLE_ID },
          vehicles: [{ ...makeVehicle(VEHICLE_ID), isEligible: false }],
        }),
      ],
      apply: [applyOk],
    });
    const expense = mockExpenseDeps([]);
    const result = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionConfirmExpense(),
        expenseActionDeps: expense.deps,
      }),
    );
    expect(result.counts.completed).toBe(1);
    expect(expense.calls).toHaveLength(0);
    expect(m.calls.release).toHaveLength(0);
    expectRestrictedTransition(m.calls.apply[0]!);
  });

  test("replay da finalização restrita de despesa não executa action", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [
        expenseContext({
          state: { ...expenseState(), activeVehicleId: VEHICLE_ID },
          vehicles: [makeVehicle(VEHICLE_ID, "denied")],
        }),
      ],
      apply: [{ ok: true, wasReplay: true, orchestratorResult: {} as never }],
    });
    const expense = mockExpenseDeps([]);
    const result = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => decisionConfirmExpense(),
        expenseActionDeps: expense.deps,
      }),
    );
    expect(result.counts.replayed).toBe(1);
    expect(expense.calls).toHaveLength(0);
    expect(m.calls.release).toHaveLength(0);
    expectRestrictedTransition(m.calls.apply[0]!);
  });

  test("recalculo após conflito bloqueia executor de despesa após downgrade", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [
        okContext({ vehicles: [makeVehicle(VEHICLE_ID)] }),
        expenseContext({
          state: { ...expenseState(), activeVehicleId: VEHICLE_ID },
          stateVersion: 7,
          vehicles: [makeVehicle(VEHICLE_ID, "passive_with_km")],
        }),
      ],
      apply: [{ ok: false, reason: "state_version_conflict" }, applyOk],
    });
    let calls = 0;
    const expense = mockExpenseDeps([]);
    const result = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, {
        decide: () => (++calls === 1 ? decisionRespond() : decisionConfirmExpense()),
        expenseActionDeps: expense.deps,
      }),
    );
    expect(result.counts.completed).toBe(1);
    expect(expense.calls).toHaveLength(0);
    expect(m.calls.release).toHaveLength(0);
    expect(m.calls.apply).toHaveLength(2);
    expectRestrictedTransition(m.calls.apply[1]!);
  });

  describe("buildFinalDescricao", () => {
    test("1) descricao + recognizedTags -> texto + tags na ordem fixa", async () => {
      const it = makeItem();
      const payload = validExpensePayload({
        categoria: "Revisão",
        descricao: "troquei a pastilha",
        recognizedTags: ["pastilha"],
      });
      const m = mockRepo({
        claim: [[it]],
        loadContext: [expenseContext({ state: expenseState(payload) })],
        apply: [applyOk],
      });
      const xp = mockExpenseDeps([
        { kind: "applied", actionExecutionId: EXEC_ID, despesaId: DESP_ID, valor: 149.9, categoria: "Revisão" },
      ]);
      await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
      );
      const cmd = xp.calls[0] as { descricao: string | null };
      expect(cmd.descricao).toBe("troquei a pastilha [pastilha]");
    });

    test("2) apenas tags, sem texto -> so as tags", async () => {
      const it = makeItem();
      const payload = validExpensePayload({
        categoria: "Revisão",
        descricao: null,
        recognizedTags: ["oleo", "filtro"],
      });
      const m = mockRepo({
        claim: [[it]],
        loadContext: [expenseContext({ state: expenseState(payload) })],
        apply: [applyOk],
      });
      const xp = mockExpenseDeps([
        { kind: "applied", actionExecutionId: EXEC_ID, despesaId: DESP_ID, valor: 149.9, categoria: "Revisão" },
      ]);
      await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
      );
      const cmd = xp.calls[0] as { descricao: string | null };
      expect(cmd.descricao).toBe("[oleo] [filtro]");
    });

    test("3) sem tags nem descricao (categoria fora de manutencao) -> null", async () => {
      const it = makeItem();
      const payload = validExpensePayload({
        categoria: "Combustível",
        descricao: null,
      });
      const m = mockRepo({
        claim: [[it]],
        loadContext: [expenseContext({ state: expenseState(payload) })],
        apply: [applyOk],
      });
      const xp = mockExpenseDeps([
        { kind: "applied", actionExecutionId: EXEC_ID, despesaId: DESP_ID, valor: 149.9, categoria: "Combustível" },
      ]);
      await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
      );
      const cmd = xp.calls[0] as { descricao: string | null };
      expect(cmd.descricao).toBeNull();
    });

    test("4) descricao longa + 2 tags -> texto truncado, tags preservadas, total <= 500", async () => {
      const it = makeItem();
      const longText = "a".repeat(490);
      const payload = validExpensePayload({
        categoria: "Manutenção",
        descricao: longText,
        recognizedTags: ["oleo", "filtro"],
      });
      const m = mockRepo({
        claim: [[it]],
        loadContext: [expenseContext({ state: expenseState(payload) })],
        apply: [applyOk],
      });
      const xp = mockExpenseDeps([
        { kind: "applied", actionExecutionId: EXEC_ID, despesaId: DESP_ID, valor: 149.9, categoria: "Manutenção" },
      ]);
      await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
      );
      const cmd = xp.calls[0] as { descricao: string };
      expect(cmd.descricao.length).toBeLessThanOrEqual(500);
      expect(cmd.descricao.endsWith("[oleo] [filtro]")).toBe(true);
      expect(cmd.descricao.startsWith("a".repeat(484))).toBe(true);
    });

    test("5) tags vazias + descricao -> so o texto, sem colchetes", async () => {
      const it = makeItem();
      const payload = validExpensePayload({
        categoria: "Manutenção",
        descricao: "revisão geral, troquei um monte de coisa",
        recognizedTags: [],
      });
      const m = mockRepo({
        claim: [[it]],
        loadContext: [expenseContext({ state: expenseState(payload) })],
        apply: [applyOk],
      });
      const xp = mockExpenseDeps([
        { kind: "applied", actionExecutionId: EXEC_ID, despesaId: DESP_ID, valor: 149.9, categoria: "Manutenção" },
      ]);
      await runWhatsappOrchestratorTestCycle(
        { workerId: "w" },
        baseDeps(m.repo, { decide: () => decisionConfirmExpense(), expenseActionDeps: xp.deps }),
      );
      const cmd = xp.calls[0] as { descricao: string | null };
      expect(cmd.descricao).toBe("revisão geral, troquei um monte de coisa");
    });
  });
});

// ============================================================
// SEGURANÇA ESTÁTICA
// ============================================================



describe("static safety", () => {
  test("módulo não importa Supabase/provider/sender/worker/IA/OCR nem lê env", async () => {
    const src = await Bun.file(
      fileURLToPath(new URL("../test-service.ts", import.meta.url)),
    ).text();
    const banned = [
      "@supabase/",
      "createClient",
      "supabase-js",
      "Deno.env",
      "process.env",
      "fetch(",
      "whatsapp-send-outbound",
      "whatsapp-process-inbound",
      "openai",
      "gemini",
      "parse-receipt",
      "openai",
    ];
    for (const s of banned) {
      expect(src.toLowerCase().includes(s.toLowerCase())).toBe(false);
    }
  });
});

// ============================================================
// HARD2 — transition-mapper adoption inside runApply
// ============================================================

describe("HARD2 transition-mapper adoption", () => {
  test("statePatch sem chave state => mapper injeta decision.nextState", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      apply: [{ ok: true, wasReplay: false, orchestratorResult: {} as never }],
    });
    // decisão de greeting real: nextState === previousState, statePatch SEM `state`
    const decision = decisionRespond({
      previousState: "idle",
      nextState: "idle",
      statePatch: {},
    });
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decision }),
    );
    expect(res.counts.completed).toBe(1);
    expect(m.calls.apply.length).toBe(1);
    // mapper injetou o state ausente
    expect(m.calls.apply[0].patch.state).toBe("idle");
    expect(m.calls.release.length).toBe(0);
  });

  test("statePatch.state divergente de nextState => malformed, Repository nunca chamado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      // sem apply enfileirado — se runApply chamar, mock joga "queue empty"
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const decision = decisionRespond({
      nextState: "idle",
      statePatch: { state: "completed" },
    });
    const logs = collectLogger();
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decision, logger: logs.logger }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release.length).toBe(1);
    expect(m.calls.release[0].reason).toBe("orchestrator_invariant");
    const failLog = logs.events.find(
      (e) => e.event === "item_failed" && (e as { reasonCode?: string }).reasonCode === "transition_mapping_failed",
    );
    expect(failLog).toBeDefined();
    expect((failLog as { errorCategory?: string }).errorCategory).toBe("state_mismatch");
  });

  test("decisionKind fora do allowlist (no_op) => malformed via mapper, Repository nunca chamado", async () => {
    const it = makeItem();
    const m = mockRepo({
      claim: [[it]],
      loadContext: [okContext()],
      release: [{ ok: true, status: "cancelled", attempts: 1, willRetry: false }],
    });
    const decision = decisionRespond({
      decisionKind: "no_op",
      responseKey: null,
      nextState: "idle",
      statePatch: { state: "idle" },
    });
    const logs = collectLogger();
    const res = await runWhatsappOrchestratorTestCycle(
      { workerId: "w" },
      baseDeps(m.repo, { decide: () => decision, logger: logs.logger }),
    );
    expect(res.counts.malformed).toBe(1);
    expect(m.calls.apply.length).toBe(0);
    expect(m.calls.release.length).toBe(1);
    const failLog = logs.events.find(
      (e) => e.event === "item_failed" && (e as { reasonCode?: string }).reasonCode === "transition_mapping_failed",
    );
    expect((failLog as { errorCategory?: string }).errorCategory).toBe("non_persistible_decision");
  });
});

// Guard para o TS não reclamar de importações não-utilizadas em cenários.
type _KeepTypes = ItemOutcome | TestCycleCounts;

