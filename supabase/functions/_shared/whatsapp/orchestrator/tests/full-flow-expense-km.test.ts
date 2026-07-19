// Build 8/9 do item 6 — teste de ponta a ponta (mockado só na borda do
// banco) do fluxo completo: despesa confirmada -> pergunta de km -> km
// informada -> km confirmada -> RPC certa chamada com o despesaId certo.
// Cenário irmão: km avulsa (sem despesa), para provar que o caminho normal
// continua intocado. Só a chamada real ao Supabase (.rpc) é mockada — todo
// o resto (core.ts, test-service.ts, actions/service.ts,
// actions/repository.ts) é código de produção de verdade.
import { describe, expect, test } from "bun:test";
import { runWhatsappOrchestratorTestCycle } from "../test-service.ts";
import { WhatsappKmActionRepository } from "../../actions/repository.ts";
import type {
  ClaimedItem,
  LoadContextResult,
  ReleaseResult,
  TransitionInput,
  TransitionResult,
} from "../types.ts";
import type {
  ConversationState,
  ConversationStatePatch,
  ConversationVehicle,
} from "../../conversation/types.ts";
import type {
  ExpenseCreateExecutorPort,
  ExpenseCreateExecutorResult,
} from "../../actions/expense-types.ts";

function uuid(seed: number): string {
  const hex = seed.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-000000000000`;
}

const VEHICLE_ID = uuid(1);
const USER_ID = uuid(2);
const CONTACT_ID = uuid(3);
const CONVERSATION_STATE_ID = uuid(4);

const vehicle: ConversationVehicle = {
  id: VEHICLE_ID,
  brand: "Fiat",
  model: "Argo",
  plate: "ABC1D23",
  isArchived: false,
  isEligible: true,
  kmAtual: 40000,
  whatsappAccessMode: "full",
};

function applyPatch(current: ConversationState, patch: ConversationStatePatch): ConversationState {
  const next: ConversationState = { ...current };
  for (const key of Object.keys(patch) as (keyof ConversationStatePatch)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    (next as Record<string, unknown>)[key] = value as unknown;
  }
  return next;
}

class FakeRepository {
  state: ConversationState;
  stateVersion = 1;
  pendingItem: ClaimedItem | null = null;

  constructor(initialState: ConversationState) {
    this.state = initialState;
  }

  queueNext(messageId: string) {
    this.pendingItem = {
      queueId: uuid(100 + this.stateVersion),
      messageId,
      contactId: CONTACT_ID,
      userId: USER_ID,
      instancePk: uuid(200),
      provider: "zapi",
      instanceId: "inst-1",
      queueType: "inbound",
      messageType: "text",
      attempts: 0,
      maxAttempts: 5,
      leaseToken: `lease-${this.stateVersion}`,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      wasRecovered: false,
      orchestratorMode: "test",
    };
  }

  async claimItems(): Promise<ClaimedItem[]> {
    return this.pendingItem ? [this.pendingItem] : [];
  }

  async loadContext(): Promise<LoadContextResult> {
    return {
      kind: "ok",
      context: {
        state: this.state,
        fallbackCount: 0,
        stateVersion: this.stateVersion,
        vehicles: [vehicle],
        conversationStateId: CONVERSATION_STATE_ID,
      },
      activeVehicleIssue: null,
    };
  }

  async applyTransition(input: TransitionInput): Promise<TransitionResult> {
    this.state = applyPatch(this.state, input.patch);
    this.stateVersion += 1;
    return {
      ok: true,
      wasReplay: false,
      orchestratorResult: {
        decisionKind: input.resultSummary.decisionKind,
        eventKind: input.resultSummary.eventKind,
        outcome: input.resultSummary.outcome,
        responseKey: input.response?.responseKey ?? null,
        nextState: this.state.state,
        stateVersion: this.stateVersion,
        outboundQueueId: uuid(300),
      },
    };
  }

  async releaseItem(): Promise<ReleaseResult> {
    return { ok: true, wasReplay: false, status: "cancelled", attempts: 0, willRetry: false };
  }
}

const expenseExecutor: ExpenseCreateExecutorPort = {
  async executeExpenseCreate(): Promise<ExpenseCreateExecutorResult> {
    return {
      kind: "applied",
      actionExecutionId: uuid(400),
      despesaId: uuid(6),
      valor: 250,
      categoria: "Revisão",
    };
  },
};

describe("Fluxo completo — despesa confirmada → km solicitada → km confirmada", () => {
  test("chama a RPC nova com o despesaId vinculado", async () => {
    const DESPESA_ID = uuid(6);
    const EXPENSE_REQUEST_MSG = uuid(5);
    const MSG_CONFIRM_EXPENSE = uuid(8);
    const MSG_KM_REPORT = uuid(7);
    const MSG_CONFIRM_KM = uuid(9);

    const rpcCalls: { fn: string; params: Record<string, unknown> }[] = [];
    const fakeSupabaseClient = {
      async rpc(fn: string, params: Record<string, unknown>) {
        rpcCalls.push({ fn, params });
        return {
          data: { kind: "applied", actionExecutionId: uuid(500), previousKm: 40000, newKm: 45000 },
          error: null,
        };
      },
    };

    const initialState: ConversationState = {
      state: "awaiting_expense_confirmation",
      currentIntent: "expense",
      awaitingField: "confirmation",
      requestSource: "user_initiated",
      draftType: "expense",
      draftId: EXPENSE_REQUEST_MSG,
      draftVersion: 0,
      draftPayload: {
        phase: "awaiting_confirmation",
        categoria: "Revisão",
        valor: 250,
        vehicleId: VEHICLE_ID,
        requestMessageId: EXPENSE_REQUEST_MSG,
      },
      activeVehicleId: VEHICLE_ID,
      confirmedAt: null,
      executedAt: null,
      expiresAt: null,
      lastMessageId: null,
    };

    const repo = new FakeRepository(initialState);
    const deps = {
      repository: repo,
      loadMessageText: async (messageId: string) => {
        if (messageId === MSG_CONFIRM_EXPENSE) return "sim";
        if (messageId === MSG_KM_REPORT) return "45000";
        if (messageId === MSG_CONFIRM_KM) return "sim";
        return null;
      },
      clock: () => new Date().toISOString(),
      orchestratorVersion: "test-v1",
      kmActionDeps: { executor: new WhatsappKmActionRepository(fakeSupabaseClient) },
      expenseActionDeps: { executor: expenseExecutor },
    };

    // Ciclo 1 — usuário confirma a despesa.
    repo.queueNext(MSG_CONFIRM_EXPENSE);
    const r1 = await runWhatsappOrchestratorTestCycle({ workerId: "sim" }, deps);
    expect(r1.counts.completed).toBe(1);
    expect(repo.state.state).toBe("awaiting_requested_km");
    expect(repo.state.draftId).toBe(DESPESA_ID);

    // Ciclo 2 — usuário informa a km.
    repo.queueNext(MSG_KM_REPORT);
    const r2 = await runWhatsappOrchestratorTestCycle({ workerId: "sim" }, deps);
    expect(r2.counts.completed).toBe(1);
    expect(repo.state.state).toBe("awaiting_km_confirmation");
    const draftPayload = repo.state.draftPayload as Record<string, unknown> | null;
    expect(draftPayload?.linkedExpenseId).toBe(DESPESA_ID);

    // Ciclo 3 — usuário confirma a km.
    repo.queueNext(MSG_CONFIRM_KM);
    const r3 = await runWhatsappOrchestratorTestCycle({ workerId: "sim" }, deps);
    expect(r3.counts.completed).toBe(1);
    expect(repo.state.state).toBe("idle");

    // A prova final: qual RPC foi chamada de verdade, e com quê.
    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0].fn).toBe("execute_whatsapp_km_update_with_expense_link");
    expect(rpcCalls[0].params.p_linked_despesa_id).toBe(DESPESA_ID);
    expect(rpcCalls[0].params.p_new_km).toBe(45000);
    expect(rpcCalls[0].params.p_vehicle_id).toBe(VEHICLE_ID);
  });
});

describe("Fluxo completo — km avulsa (sem despesa)", () => {
  test("continua chamando a RPC original, sem despesa vinculada", async () => {
    const MSG_KM_REPORT = uuid(20);
    const MSG_CONFIRM_KM = uuid(21);

    const rpcCalls: { fn: string; params: Record<string, unknown> }[] = [];
    const fakeSupabaseClient = {
      async rpc(fn: string, params: Record<string, unknown>) {
        rpcCalls.push({ fn, params });
        return {
          data: { kind: "applied", actionExecutionId: uuid(600), previousKm: 40000, newKm: 45000 },
          error: null,
        };
      },
    };

    const idleState: ConversationState = {
      state: "idle",
      currentIntent: null,
      awaitingField: null,
      requestSource: null,
      draftType: null,
      draftId: null,
      draftVersion: null,
      draftPayload: null,
      activeVehicleId: VEHICLE_ID,
      confirmedAt: null,
      executedAt: null,
      expiresAt: null,
      lastMessageId: null,
    };

    const repo = new FakeRepository(idleState);
    const deps = {
      repository: repo,
      loadMessageText: async (messageId: string) => {
        if (messageId === MSG_KM_REPORT) return "quilometragem atual: 45000";
        if (messageId === MSG_CONFIRM_KM) return "sim";
        return null;
      },
      clock: () => new Date().toISOString(),
      orchestratorVersion: "test-v1",
      kmActionDeps: { executor: new WhatsappKmActionRepository(fakeSupabaseClient) },
      expenseActionDeps: { executor: expenseExecutor },
    };

    repo.queueNext(MSG_KM_REPORT);
    const s1 = await runWhatsappOrchestratorTestCycle({ workerId: "sim2" }, deps);
    expect(s1.counts.completed).toBe(1);
    expect(repo.state.state).toBe("awaiting_km_confirmation");

    repo.queueNext(MSG_CONFIRM_KM);
    const s2 = await runWhatsappOrchestratorTestCycle({ workerId: "sim2" }, deps);
    expect(s2.counts.completed).toBe(1);
    expect(repo.state.state).toBe("idle");

    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0].fn).toBe("execute_whatsapp_km_update");
    expect(Object.prototype.hasOwnProperty.call(rpcCalls[0].params, "p_linked_despesa_id")).toBe(false);
  });
});
