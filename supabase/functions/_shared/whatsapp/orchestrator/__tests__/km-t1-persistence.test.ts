// Build 5.7F2E1A.5-MG — Testes mockados da persistência T1 via
// Repository.applyTransition. Test-only: não altera código produtivo, não
// conecta worker/webhook/test-service, não inicia T2, não executa E1A.
//
// Objetivo único: provar que decisões T1 produzidas por decideConversation
// atravessam corretamente Repository.applyTransition e o contrato mockado
// fiel de public.apply_whatsapp_orchestrator_transition.

import { describe, expect, test } from "bun:test";
import {
  mapConversationDecisionToTransitionInput,
  WhatsappOrchestratorRepository,
  serializePatch,
  type RpcInvoker,
  type RpcResponse,
  type SupabaseLike,
  type TransitionInput,
} from "../index.ts";
import { decideConversation } from "../../conversation/core.ts";
import type {
  ConversationCoreDecision,
  ConversationCoreInput,
  ConversationState,
  ConversationStatePatch,
  ConversationVehicle,
} from "../../conversation/types.ts";
import {
  KM_UPDATE_INITIAL_DRAFT_VERSION,
  KM_UPDATE_PROMOTED_DRAFT_VERSION,
} from "../../conversation/km-update-draft.ts";
import {
  CONFIRM_KM_UPDATE_HANDOFF_KIND,
  KM_REPORTED_EVENT_KIND,
} from "../../conversation/km-update-protocol.ts";

// ---------------------------------------------------------------------------
// UUIDs sintéticos determinísticos (RFC 4122 v4). Nunca gerados em runtime.
// ---------------------------------------------------------------------------

const QUEUE_ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const LEASE_TOKEN   = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const MSG_T1        = "11111111-1111-4111-8111-111111111111"; // mensagem T1
const MSG_SELECTION = "22222222-2222-4222-8222-222222222222"; // resposta de veículo
const VEH_1         = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const VEH_2         = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const VEH_3         = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";

const ORCH_VERSION = "5.7f2e1a.5-mg";

// ---------------------------------------------------------------------------
// Helpers de contexto/input para o core
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
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
    lastMessageId: null,
    ...overrides,
  };
}

function veh(
  id: string,
  brand: string,
  model: string,
  plate: string,
  kmAtual: number | null = null,
): ConversationVehicle {
  return {
    id,
    brand,
    model,
    plate,
    isArchived: false,
    isEligible: true,
    kmAtual,
    optionalLabel: null,
  };
}

function makeInput(overrides: Partial<ConversationCoreInput> = {}): ConversationCoreInput {
  return {
    sourceMessageId: MSG_T1,
    messageType: "text",
    originalText: "",
    now: "2026-07-11T12:00:00.000Z",
    state: makeState(),
    vehicles: [],
    fallbackCount: 0,
    isReplay: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mapper test-only: ConversationCoreDecision → TransitionInput
//
// Semântica:
//  - strip lastMessageId (não aceito por serializePatch);
//  - preserva todos os demais campos do patch por identidade;
//  - garante state (obrigatório em serializePatch): usa d.nextState quando o
//    core omite state no patch (caminhos que preservam snapshot);
//  - resultSummary é 1:1 com d;
//  - response opcional derivado de responseKey (textBody sintético).
// ---------------------------------------------------------------------------

function decisionToTransition(
  d: ConversationCoreDecision,
  expectedStateVersion: number,
): TransitionInput {
  const patch: ConversationStatePatch = { ...d.statePatch };
  delete patch.lastMessageId;
  if (patch.state === undefined) patch.state = d.nextState;
  return {
    queueItemId: QUEUE_ITEM_ID,
    leaseToken: LEASE_TOKEN,
    expectedStateVersion,
    patch,
    orchestratorVersion: ORCH_VERSION,
    resultSummary: {
      decisionKind: d.decisionKind,
      eventKind: d.eventKind,
      outcome: d.outcome,
    },
    response: d.responseKey
      ? { responseKey: d.responseKey, textBody: "synthetic-body" }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Mock fiel da RPC apply_whatsapp_orchestrator_transition
//
// Regras que replicam o contrato instalado:
//   1. expected_state_version incorreto → state_version_conflict;
//   2. draft novo (draft_id ausente no snapshot OU diferente do snapshot)
//      exige draft_version === 0;
//   3. mesmo draftId aceita draft_version igual ao snapshot ou snapshot+1;
//   4. eventKind em allowlist mínima; confirm_km_update é rejeitado;
//   5. campos ausentes NÃO alteram snapshot (preservam);
//   6. sucesso avança state_version.
//
// O mock não expõe qualquer outra RPC/tabela: chamadas fora do allowlist
// falham imediatamente com "unexpected".
// ---------------------------------------------------------------------------

const ALLOWED_EVENT_KINDS = new Set<string>([
  "km_reported",
  "vehicle_reply",
  "greeting",
  "help",
  "confirm",
  "deny",
  "cancel_task",
  "reset_conversation",
  "explicit_opt_out",
  "media",
  "unknown",
  "replay",
  "expired_state",
]);

type MockSnapshot = {
  stateVersion: number;
  draftId: string | null;
  draftVersion: number | null;
  draftPayload: Record<string, unknown> | null;
};

type CapturedCall = { fn: string; params: Record<string, unknown> };

type MockScenario =
  | { kind: "ok"; snapshot: MockSnapshot }
  | { kind: "reason"; reason: string; currentStateVersion?: number }
  | { kind: "rpc_error"; message: string; code?: string }
  | { kind: "throw"; message: string };

type MockHarness = {
  client: SupabaseLike;
  calls: CapturedCall[];
  scenario: { current: MockScenario };
};

function makeFaithfulMock(initial: MockScenario): MockHarness {
  const calls: CapturedCall[] = [];
  const scenario = { current: initial };

  const invoker: RpcInvoker = async <T = unknown>(
    fn: string,
    params: Record<string, unknown>,
  ): Promise<RpcResponse<T>> => {
    calls.push({ fn, params });

    if (fn !== "apply_whatsapp_orchestrator_transition") {
      throw new Error(`unexpected_rpc:${fn}`);
    }

    const s = scenario.current;
    if (s.kind === "throw") throw new Error(s.message);
    if (s.kind === "rpc_error") {
      return {
        data: null,
        error: { message: s.message, code: s.code ?? null },
      } as RpcResponse<T>;
    }
    if (s.kind === "reason") {
      const payload: Record<string, unknown> = { ok: false, reason: s.reason };
      if (typeof s.currentStateVersion === "number") {
        payload.currentStateVersion = s.currentStateVersion;
      }
      return { data: payload as unknown as T, error: null };
    }

    // kind === "ok" — valida contra o snapshot e produz sucesso.
    const snap = s.snapshot;
    const patch = params.p_patch as Record<string, unknown>;
    const rs = params.p_result_summary as {
      decisionKind: string;
      eventKind: string;
      outcome: string;
    };

    if (params.p_expected_state_version !== snap.stateVersion) {
      return {
        data: {
          ok: false,
          reason: "state_version_conflict",
          currentStateVersion: snap.stateVersion,
        } as unknown as T,
        error: null,
      };
    }

    if (!ALLOWED_EVENT_KINDS.has(rs.eventKind)) {
      return {
        data: { ok: false, reason: "result_summary_invalid" } as unknown as T,
        error: null,
      };
    }

    // Contrato de draft
    const draftKeysPresent =
      "draft_id" in patch ||
      "draft_version" in patch ||
      "draft_payload" in patch ||
      "draft_type" in patch;

    if (draftKeysPresent) {
      const newDraftId = (patch.draft_id ?? null) as string | null;
      const newDraftVersion = patch.draft_version as number | null;
      const sameDraft =
        snap.draftId !== null && newDraftId === snap.draftId;
      if (!sameDraft) {
        // draft novo — versão obrigatoriamente 0
        if (newDraftVersion !== KM_UPDATE_INITIAL_DRAFT_VERSION) {
          return {
            data: { ok: false, reason: "draft_transition_invalid" } as unknown as T,
            error: null,
          };
        }
      } else {
        const current = snap.draftVersion ?? 0;
        if (newDraftVersion !== current && newDraftVersion !== current + 1) {
          return {
            data: { ok: false, reason: "draft_transition_invalid" } as unknown as T,
            error: null,
          };
        }
      }
    }

    const orchestratorResult = {
      decisionKind: rs.decisionKind,
      eventKind: rs.eventKind,
      outcome: rs.outcome,
      responseKey:
        (params.p_response as { response_key?: unknown } | null)?.response_key ??
        null,
      nextState: patch.next_state,
      stateVersion: snap.stateVersion + 1,
      outboundQueueId: null,
    };

    return {
      data: {
        ok: true,
        wasReplay: false,
        orchestratorResult,
      } as unknown as T,
      error: null,
    };
  };

  return {
    client: { rpc: invoker },
    calls,
    scenario,
  };
}

// ---------------------------------------------------------------------------
// Guarda anti-T2 aplicada aos parâmetros capturados.
// ---------------------------------------------------------------------------

function assertNoT2Contamination(calls: CapturedCall[]) {
  const T2_FORBIDDEN = [
    CONFIRM_KM_UPDATE_HANDOFF_KIND,
    "executeConfirmedKmUpdate",
    "apply_whatsapp_confirmed_km_update",
    "km_updated",
    "update_km",
    "apply_km_update",
    "action_execution",
  ];
  for (const c of calls) {
    const serialized = JSON.stringify(c);
    for (const forbidden of T2_FORBIDDEN) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  }
}

// ===========================================================================
// Cenário A — DRAFT PARCIAL NOVO v0
// ===========================================================================

describe("A. draft parcial novo v0 persistido via applyTransition", () => {
  test("múltiplos veículos + relato explícito → decisão awaiting_vehicle e persistência com km_reported v0", async () => {
    const v1 = veh(VEH_1, "Fiat", "Argo", "ABC1D23", 10000);
    const v2 = veh(VEH_2, "VW", "Gol", "XYZ9K88", 5000);
    const d = decideConversation(
      makeInput({
        originalText: "km 12345",
        vehicles: [v1, v2],
        sourceMessageId: MSG_T1,
      }),
    );

    // Sanidade da decisão do core
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("transition");
    expect(d.nextState).toBe("awaiting_vehicle");
    expect(d.responseKey).toBe("vehicle_ambiguous");
    expect(d.statePatch.draftType).toBe("km_update");
    expect(d.statePatch.draftId).toBe(MSG_T1);
    expect(d.statePatch.draftVersion).toBe(KM_UPDATE_INITIAL_DRAFT_VERSION);
    const draftPayload = d.statePatch.draftPayload as Record<string, unknown>;
    expect(draftPayload.phase).toBe("awaiting_vehicle");
    expect(draftPayload.newKm).toBe(12345);
    expect(draftPayload.requestMessageId).toBe(MSG_T1);

    // Persistência via Repository
    const mock = makeFaithfulMock({
      kind: "ok",
      snapshot: {
        stateVersion: 3,
        draftId: null,
        draftVersion: null,
        draftPayload: null,
      },
    });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const result = await repo.applyTransition(decisionToTransition(d, 3));

    expect(result.ok).toBe(true);
    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0];
    expect(call.fn).toBe("apply_whatsapp_orchestrator_transition");
    expect(call.params.p_queue_item_id).toBe(QUEUE_ITEM_ID);
    expect(call.params.p_lease_token).toBe(LEASE_TOKEN);
    expect(call.params.p_expected_state_version).toBe(3);
    expect(call.params.p_orchestrator_version).toBe(ORCH_VERSION);

    const patch = call.params.p_patch as Record<string, unknown>;
    expect(patch.next_state).toBe("awaiting_vehicle");
    expect(patch.current_intent).toBe("km_update");
    expect(patch.awaiting_field).toBe("vehicle");
    expect(patch.draft_type).toBe("km_update");
    expect(patch.draft_id).toBe(MSG_T1);
    expect(patch.draft_version).toBe(0);
    expect(patch.draft_payload).toEqual(draftPayload);
    // lastMessageId NUNCA vai para a RPC (serializePatch rejeita)
    expect("last_message_id" in patch).toBe(false);

    const rs = call.params.p_result_summary as Record<string, unknown>;
    expect(rs.eventKind).toBe(KM_REPORTED_EVENT_KIND);
    expect(rs.decisionKind).toBe("transition");
    expect(rs.outcome).toBe("none");

    const response = call.params.p_response as Record<string, unknown>;
    expect(response.response_key).toBe("vehicle_ambiguous");

    assertNoT2Contamination(mock.calls);
  });
});

// ===========================================================================
// Cenário B — DRAFT COMPLETO DIRETO NOVO v0
// ===========================================================================

describe("B. draft completo direto novo v0", () => {
  function runComplete(kmAtual: number | null, newKm: number) {
    const v = veh(VEH_1, "Fiat", "Argo", "ABC1D23", kmAtual);
    return decideConversation(
      makeInput({
        originalText: `km ${newKm}`,
        vehicles: [v],
        sourceMessageId: MSG_T1,
      }),
    );
  }

  async function persist(d: ConversationCoreDecision) {
    const mock = makeFaithfulMock({
      kind: "ok",
      snapshot: {
        stateVersion: 7,
        draftId: null,
        draftVersion: null,
        draftPayload: null,
      },
    });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const r = await repo.applyTransition(decisionToTransition(d, 7));
    return { r, mock };
  }

  test("aumento normal → v0 awaiting_km_confirmation, isCorrection=false", async () => {
    const d = runComplete(10000, 12345);
    expect(d.nextState).toBe("awaiting_km_confirmation");
    expect(d.statePatch.draftVersion).toBe(0);
    expect(d.statePatch.draftId).toBe(MSG_T1);
    const pl = d.statePatch.draftPayload as Record<string, unknown>;
    expect(pl.phase).toBe("awaiting_confirmation");
    expect(pl.isCorrection).toBe(false);
    expect(pl.expectedPreviousKm).toBe(10000);
    expect(pl.newKm).toBe(12345);
    expect(pl.vehicleId).toBe(VEH_1);
    expect(pl.requestMessageId).toBe(MSG_T1);

    const { r, mock } = await persist(d);
    expect(r.ok).toBe(true);
    expect(mock.calls).toHaveLength(1);
    const patch = mock.calls[0].params.p_patch as Record<string, unknown>;
    expect(patch.draft_version).toBe(0);
    expect(patch.draft_id).toBe(MSG_T1);
    expect(patch.active_vehicle_id).toBe(VEH_1);
    expect(patch.next_state).toBe("awaiting_km_confirmation");
    assertNoT2Contamination(mock.calls);
  });

  test("redução/correção → v0 awaiting_km_correction_confirmation, isCorrection=true", async () => {
    const d = runComplete(20000, 12000);
    expect(d.nextState).toBe("awaiting_km_correction_confirmation");
    const pl = d.statePatch.draftPayload as Record<string, unknown>;
    expect(pl.isCorrection).toBe(true);
    expect(d.statePatch.draftVersion).toBe(0);

    const { r, mock } = await persist(d);
    expect(r.ok).toBe(true);
    const patch = mock.calls[0].params.p_patch as Record<string, unknown>;
    expect(patch.next_state).toBe("awaiting_km_correction_confirmation");
    expect(patch.draft_version).toBe(0);
  });

  test("kmAtual = null → v0 confirmação normal, isCorrection=false, expectedPreviousKm=null", async () => {
    const d = runComplete(null, 5000);
    expect(d.nextState).toBe("awaiting_km_confirmation");
    const pl = d.statePatch.draftPayload as Record<string, unknown>;
    expect(pl.isCorrection).toBe(false);
    expect(pl.expectedPreviousKm).toBeNull();
    const { r, mock } = await persist(d);
    expect(r.ok).toBe(true);
    const patch = mock.calls[0].params.p_patch as Record<string, unknown>;
    expect(patch.draft_version).toBe(0);
  });

  test("kmAtual = 0 e newKm > 0 → v0 confirmação normal", async () => {
    const d = runComplete(0, 100);
    expect(d.nextState).toBe("awaiting_km_confirmation");
    const pl = d.statePatch.draftPayload as Record<string, unknown>;
    expect(pl.isCorrection).toBe(false);
    expect(pl.expectedPreviousKm).toBe(0);
    const { r, mock } = await persist(d);
    expect(r.ok).toBe(true);
    const patch = mock.calls[0].params.p_patch as Record<string, unknown>;
    expect(patch.draft_version).toBe(0);
  });
});

// ===========================================================================
// Cenário C — PROMOÇÃO v0 → v1
// ===========================================================================

describe("C. promoção v0 → v1 via vehicle_reply", () => {
  test("seleção válida promove o MESMO draftId de v0 para v1", async () => {
    // Snapshot: draft parcial persistido v0 pertencente à mensagem T1.
    const partialPayload = {
      phase: "awaiting_vehicle" as const,
      newKm: 12345,
      requestMessageId: MSG_T1,
    };
    const initialState = makeState({
      state: "awaiting_vehicle",
      currentIntent: "km_update",
      awaitingField: "vehicle",
      draftType: "km_update",
      draftId: MSG_T1,
      draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
      draftPayload: partialPayload as unknown as Record<string, unknown>,
    });
    const v1 = veh(VEH_1, "Fiat", "Argo", "ABC1D23", 10000);
    const v2 = veh(VEH_2, "VW", "Gol", "XYZ9K88", 5000);

    // Usuário responde com placa selecionando v1, numa NOVA mensagem.
    const d = decideConversation(
      makeInput({
        originalText: "ABC1D23",
        vehicles: [v1, v2],
        state: initialState,
        sourceMessageId: MSG_SELECTION,
      }),
    );

    expect(d.eventKind).toBe("vehicle_reply");
    expect(d.decisionKind).toBe("transition");
    expect(d.nextState).toBe("awaiting_km_confirmation");
    // Identidade preservada: draftId continua sendo a mensagem T1, não a de seleção.
    expect(d.statePatch.draftId).toBe(MSG_T1);
    expect(d.statePatch.draftId).not.toBe(MSG_SELECTION);
    expect(d.statePatch.draftVersion).toBe(KM_UPDATE_PROMOTED_DRAFT_VERSION);
    const pl = d.statePatch.draftPayload as Record<string, unknown>;
    expect(pl.phase).toBe("awaiting_confirmation");
    expect(pl.vehicleId).toBe(VEH_1);
    expect(pl.expectedPreviousKm).toBe(10000);
    expect(pl.newKm).toBe(12345);
    expect(pl.requestMessageId).toBe(MSG_T1);
    expect(pl.isCorrection).toBe(false);
    // lastMessageId aponta para a mensagem de seleção, mas NÃO substitui draftId.
    expect(d.statePatch.lastMessageId).toBe(MSG_SELECTION);
    expect(d.statePatch.activeVehicleId).toBe(VEH_1);

    // Snapshot fiel: mesmo draftId em v0.
    const mock = makeFaithfulMock({
      kind: "ok",
      snapshot: {
        stateVersion: 5,
        draftId: MSG_T1,
        draftVersion: 0,
        draftPayload: partialPayload as unknown as Record<string, unknown>,
      },
    });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const r = await repo.applyTransition(decisionToTransition(d, 5));

    expect(r.ok).toBe(true);
    expect(mock.calls).toHaveLength(1);
    const patch = mock.calls[0].params.p_patch as Record<string, unknown>;
    expect(patch.draft_id).toBe(MSG_T1);
    expect(patch.draft_version).toBe(1);
    expect(patch.next_state).toBe("awaiting_km_confirmation");
    expect(patch.active_vehicle_id).toBe(VEH_1);
    expect("last_message_id" in patch).toBe(false);
    const rs = mock.calls[0].params.p_result_summary as Record<string, unknown>;
    expect(rs.eventKind).toBe("vehicle_reply");
    assertNoT2Contamination(mock.calls);
  });

  test("promoção rejeitada se o mock enviar versão ≠ current e ≠ current+1", async () => {
    // Prova defensiva do contrato: o mock rejeita qualquer versão inválida.
    const mock = makeFaithfulMock({
      kind: "ok",
      snapshot: {
        stateVersion: 5,
        draftId: MSG_T1,
        draftVersion: 0,
        draftPayload: null,
      },
    });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const bad: TransitionInput = {
      queueItemId: QUEUE_ITEM_ID,
      leaseToken: LEASE_TOKEN,
      expectedStateVersion: 5,
      patch: {
        state: "awaiting_km_confirmation",
        draftType: "km_update",
        draftId: MSG_T1,
        draftVersion: 5, // inválido
        draftPayload: { phase: "awaiting_confirmation" },
      },
      orchestratorVersion: ORCH_VERSION,
      resultSummary: {
        decisionKind: "transition",
        eventKind: "vehicle_reply",
        outcome: "none",
      },
    };
    const r = await repo.applyTransition(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("draft_transition_invalid");
  });
});

// ===========================================================================
// Cenário D — SELEÇÃO INVÁLIDA OU AMBÍGUA
// ===========================================================================

describe("D. seleção inválida/ambígua omite campos de draft", () => {
  const partialPayload = {
    phase: "awaiting_vehicle" as const,
    newKm: 12345,
    requestMessageId: MSG_T1,
  };
  const baseState = makeState({
    state: "awaiting_vehicle",
    currentIntent: "km_update",
    awaitingField: "vehicle",
    draftType: "km_update",
    draftId: MSG_T1,
    draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
    draftPayload: partialPayload as unknown as Record<string, unknown>,
  });

  test("seleção não encontrada preserva por omissão (draft_* ausentes)", async () => {
    const d = decideConversation(
      makeInput({
        originalText: "ZZZ0000",
        vehicles: [veh(VEH_1, "Fiat", "Argo", "ABC1D23"), veh(VEH_2, "VW", "Gol", "XYZ9K88")],
        state: baseState,
        sourceMessageId: MSG_SELECTION,
      }),
    );
    expect(d.eventKind).toBe("vehicle_reply");
    expect(d.nextState).toBe("awaiting_vehicle");
    expect(d.responseKey).toBe("vehicle_not_found");
    expect(d.statePatch.draftType).toBeUndefined();
    expect(d.statePatch.draftId).toBeUndefined();
    expect(d.statePatch.draftVersion).toBeUndefined();
    expect(d.statePatch.draftPayload).toBeUndefined();

    const mock = makeFaithfulMock({
      kind: "ok",
      snapshot: {
        stateVersion: 2,
        draftId: MSG_T1,
        draftVersion: 0,
        draftPayload: partialPayload as unknown as Record<string, unknown>,
      },
    });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const r = await repo.applyTransition(decisionToTransition(d, 2));
    expect(r.ok).toBe(true);
    expect(mock.calls).toHaveLength(1);
    const patch = mock.calls[0].params.p_patch as Record<string, unknown>;
    // draft_* AUSENTES → snapshot preservado
    expect("draft_type" in patch).toBe(false);
    expect("draft_id" in patch).toBe(false);
    expect("draft_version" in patch).toBe(false);
    expect("draft_payload" in patch).toBe(false);
    // não substitui por null
    expect(patch.draft_id).toBeUndefined();
    assertNoT2Contamination(mock.calls);
  });

  test("seleção ambígua preserva por omissão (draft_* ausentes)", async () => {
    // Duas ARGOs com placas diferentes → ambiguidade textual sobre "argo".
    const d = decideConversation(
      makeInput({
        originalText: "argo",
        vehicles: [
          veh(VEH_1, "Fiat", "Argo", "ABC1D23"),
          veh(VEH_2, "Fiat", "Argo", "XYZ9K88"),
          veh(VEH_3, "VW", "Gol", "QRS4L55"),
        ],
        state: baseState,
        sourceMessageId: MSG_SELECTION,
      }),
    );
    expect(d.eventKind).toBe("vehicle_reply");
    expect(d.nextState).toBe("awaiting_vehicle");
    expect(d.responseKey).toBe("vehicle_ambiguous");
    expect(d.statePatch.draftType).toBeUndefined();
    expect(d.statePatch.draftId).toBeUndefined();
    expect(d.statePatch.draftVersion).toBeUndefined();
    expect(d.statePatch.draftPayload).toBeUndefined();

    const mock = makeFaithfulMock({
      kind: "ok",
      snapshot: {
        stateVersion: 8,
        draftId: MSG_T1,
        draftVersion: 0,
        draftPayload: partialPayload as unknown as Record<string, unknown>,
      },
    });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const r = await repo.applyTransition(decisionToTransition(d, 8));
    expect(r.ok).toBe(true);
    const patch = mock.calls[0].params.p_patch as Record<string, unknown>;
    expect("draft_id" in patch).toBe(false);
    expect("draft_version" in patch).toBe(false);
    expect("draft_payload" in patch).toBe(false);
    assertNoT2Contamination(mock.calls);
  });
});

// ===========================================================================
// Cenário E — DRAFT MALFORMADO no state (não promove)
// ===========================================================================

describe("E. draft malformado no state não é promovido", () => {
  const v1 = veh(VEH_1, "Fiat", "Argo", "ABC1D23", 10000);

  function selectionOn(stateOverrides: Partial<ConversationState>) {
    return decideConversation(
      makeInput({
        originalText: "ABC1D23",
        vehicles: [v1],
        state: makeState({
          state: "awaiting_vehicle",
          currentIntent: "km_update",
          awaitingField: "vehicle",
          draftType: "km_update",
          draftId: MSG_T1,
          draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
          draftPayload: {
            phase: "awaiting_vehicle",
            newKm: 12345,
            requestMessageId: MSG_T1,
          },
          ...stateOverrides,
        }),
        sourceMessageId: MSG_SELECTION,
      }),
    );
  }

  test("payload inválido → seleção legada (select_vehicle) sem promoção", () => {
    const d = selectionOn({
      draftPayload: { phase: "awaiting_vehicle", newKm: -1, requestMessageId: MSG_T1 },
    });
    // Cai no fallback legado de vehicle_reply → select_vehicle
    expect(d.decisionKind).toBe("select_vehicle");
    // draft NÃO promovido: campos ficam nulos (limpeza do task pack) — nunca v1.
    expect(d.statePatch.draftVersion).toBeNull();
    expect(d.statePatch.draftId).toBeNull();
    expect(d.statePatch.draftType).toBeNull();
  });

  test("draftVersion incompatível (≠ 0) → sem promoção", () => {
    const d = selectionOn({
      draftVersion: 5,
    });
    expect(d.decisionKind).toBe("select_vehicle");
    expect(d.statePatch.draftVersion).toBeNull();
  });

  test("draftId ausente → sem promoção", () => {
    const d = selectionOn({ draftId: null });
    expect(d.decisionKind).toBe("select_vehicle");
    expect(d.statePatch.draftVersion).toBeNull();
  });

  test("draftId divergente do requestMessageId no payload → sem promoção", () => {
    const d = selectionOn({
      draftId: MSG_SELECTION, // diverge do payload.requestMessageId = MSG_T1
      draftPayload: {
        phase: "awaiting_vehicle",
        newKm: 12345,
        requestMessageId: MSG_T1,
      },
    });
    expect(d.decisionKind).toBe("select_vehicle");
    expect(d.statePatch.draftVersion).toBeNull();
  });
});

// ===========================================================================
// Cenário F — RESULTADOS DA RPC
// ===========================================================================

describe("F. mapeamento de retornos da RPC", () => {
  function buildParcialDecision(): ConversationCoreDecision {
    return decideConversation(
      makeInput({
        originalText: "km 12345",
        vehicles: [veh(VEH_1, "Fiat", "Argo", "ABC1D23"), veh(VEH_2, "VW", "Gol", "XYZ9K88")],
        sourceMessageId: MSG_T1,
      }),
    );
  }

  test("sucesso mapeado; exatamente 1 chamada", async () => {
    const d = buildParcialDecision();
    const mock = makeFaithfulMock({
      kind: "ok",
      snapshot: { stateVersion: 1, draftId: null, draftVersion: null, draftPayload: null },
    });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const r = await repo.applyTransition(decisionToTransition(d, 1));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.wasReplay).toBe(false);
      expect(r.orchestratorResult.eventKind).toBe(KM_REPORTED_EVENT_KIND);
      expect(r.orchestratorResult.stateVersion).toBe(2);
    }
    expect(mock.calls).toHaveLength(1);
  });

  test("state_version_conflict → falha, expõe currentStateVersion", async () => {
    const d = buildParcialDecision();
    const mock = makeFaithfulMock({
      kind: "reason",
      reason: "state_version_conflict",
      currentStateVersion: 99,
    });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const r = await repo.applyTransition(decisionToTransition(d, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("state_version_conflict");
      expect(r.currentStateVersion).toBe(99);
    }
    expect(mock.calls).toHaveLength(1);
  });

  test("draft_transition_invalid → falha mapeada", async () => {
    const d = buildParcialDecision();
    const mock = makeFaithfulMock({ kind: "reason", reason: "draft_transition_invalid" });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const r = await repo.applyTransition(decisionToTransition(d, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("draft_transition_invalid");
    expect(mock.calls).toHaveLength(1);
  });

  test("queue_item_not_found → falha mapeada", async () => {
    const d = buildParcialDecision();
    const mock = makeFaithfulMock({ kind: "reason", reason: "queue_item_not_found" });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const r = await repo.applyTransition(decisionToTransition(d, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("queue_item_not_found");
    expect(mock.calls).toHaveLength(1);
  });

  test("lease_lost → falha mapeada", async () => {
    const d = buildParcialDecision();
    const mock = makeFaithfulMock({ kind: "reason", reason: "lease_lost" });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    const r = await repo.applyTransition(decisionToTransition(d, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("lease_lost");
    expect(mock.calls).toHaveLength(1);
  });

  test("erro transitório (RPC error) → RepositoryError (TransportError)", async () => {
    const d = buildParcialDecision();
    const mock = makeFaithfulMock({
      kind: "rpc_error",
      message: "connection reset",
      code: "08006",
    });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    await expect(repo.applyTransition(decisionToTransition(d, 1))).rejects.toBeInstanceOf(Error);
    expect(mock.calls).toHaveLength(1);
  });

  test("exception do client (throw) → RepositoryError, 1 chamada", async () => {
    const d = buildParcialDecision();
    const mock = makeFaithfulMock({ kind: "throw", message: "boom" });
    const repo = new WhatsappOrchestratorRepository(mock.client);
    await expect(repo.applyTransition(decisionToTransition(d, 1))).rejects.toBeInstanceOf(Error);
    expect(mock.calls).toHaveLength(1);
  });
});

// ===========================================================================
// Guarda estrutural global — nenhuma chamada além de apply_whatsapp_orchestrator_transition
// ===========================================================================

describe("G. guardas anti-escrita paralela", () => {
  test("serializePatch rejeita last_message_id (contrato preservado)", () => {
    expect(() =>
      serializePatch({ state: "idle", lastMessageId: MSG_T1 } as unknown as ConversationStatePatch),
    ).toThrow(/not accepted/);
  });

  test("mock recusa RPCs fora do allowlist (nenhuma escrita paralela)", async () => {
    const mock = makeFaithfulMock({
      kind: "ok",
      snapshot: { stateVersion: 0, draftId: null, draftVersion: null, draftPayload: null },
    });
    await expect(
      mock.client.rpc("apply_whatsapp_confirmed_km_update", {}),
    ).rejects.toThrow(/unexpected_rpc/);
  });
});
