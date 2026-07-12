// Build 5.7F2E1A.5-MH.1 — Testes diretos do mapper produtivo
// mapConversationDecisionToTransitionInput.
//
// Puros: sem Repository, sem RPC, sem I/O. Exercitam o contrato
// documentado no módulo transition-mapper.ts.
//
// O mapper NÃO fabrica textBody. Toda response é fornecida explicitamente
// pelo chamador (fixture aqui) e apenas transportada.

import { describe, expect, test } from "bun:test";
import {
  mapConversationDecisionToTransitionInput,
  RepositoryError,
} from "../index.ts";
import type {
  ConversationCoreDecision,
  ConversationDecisionKind,
  ConversationStatePatch,
} from "../../conversation/types.ts";
import type { OutboundResponsePayload } from "../types.ts";
import {
  KM_UPDATE_INITIAL_DRAFT_VERSION,
  KM_UPDATE_PROMOTED_DRAFT_VERSION,
} from "../../conversation/km-update-draft.ts";

// ---------------------------------------------------------------------------
// Fixtures determinísticas
// ---------------------------------------------------------------------------

const QUEUE_ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const LEASE_TOKEN = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const MSG_T1 = "11111111-1111-4111-8111-111111111111";
const MSG_SELECTION = "22222222-2222-4222-8222-222222222222";
const VEH_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const ORCH_VERSION = "5.7f2e1a.5-mh1";

// Texto de fixture explícito de teste. Nunca aparece no código produtivo.
const FIXTURE_TEXT_BODY = "synthetic-body";

const INFRA = {
  queueItemId: QUEUE_ITEM_ID,
  leaseToken: LEASE_TOKEN,
  expectedStateVersion: 3,
  orchestratorVersion: ORCH_VERSION,
} as const;

function decision(
  overrides: Partial<ConversationCoreDecision> = {},
): ConversationCoreDecision {
  return {
    eventKind: "greeting",
    decisionKind: "transition",
    previousState: "idle",
    nextState: "idle",
    outcome: "none",
    statePatch: { state: "idle" },
    responseKey: null,
    responseParams: {},
    nextFallbackCount: 0,
    deferToLegacyRouter: false,
    deferToLegacyOptOut: false,
    reasonCode: "test.decision",
    ...overrides,
  };
}

/**
 * Constrói uma response de fixture coerente com a decisão fornecida.
 * Se `decision.responseKey` for null, retorna null. Caso contrário,
 * usa o próprio responseKey da decisão e um textBody de teste.
 */
function fixtureResponseFor(
  d: ConversationCoreDecision,
  textBody: string = FIXTURE_TEXT_BODY,
): OutboundResponsePayload | null {
  if (d.responseKey === null) return null;
  return { responseKey: d.responseKey, textBody };
}

/**
 * Wrapper de testes: chama o mapper produtivo injetando automaticamente uma
 * response de fixture coerente com a decisão, salvo quando o teste fornece
 * `response` explicitamente (inclusive `null`).
 */
function callMapper(
  args: {
    decision: ConversationCoreDecision;
    queueItemId: string;
    leaseToken: string;
    expectedStateVersion: number;
    orchestratorVersion: string;
    response?: OutboundResponsePayload | null;
  },
) {
  const response = "response" in args
    ? (args.response as OutboundResponsePayload | null)
    : fixtureResponseFor(args.decision);
  return mapConversationDecisionToTransitionInput({
    decision: args.decision,
    queueItemId: args.queueItemId,
    leaseToken: args.leaseToken,
    expectedStateVersion: args.expectedStateVersion,
    orchestratorVersion: args.orchestratorVersion,
    response,
  });
}

// ===========================================================================
// 1. Mapeamento simples
// ===========================================================================

describe("1. mapeamento base", () => {
  test("transição legada simples produz TransitionInput coerente", () => {
    const d = decision({
      eventKind: "greeting",
      decisionKind: "transition",
      nextState: "idle",
      statePatch: { state: "idle" },
      responseKey: "greeting",
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect(out.queueItemId).toBe(QUEUE_ITEM_ID);
    expect(out.leaseToken).toBe(LEASE_TOKEN);
    expect(out.expectedStateVersion).toBe(3);
    expect(out.orchestratorVersion).toBe(ORCH_VERSION);
    expect(out.patch.state).toBe("idle");
    expect(out.resultSummary).toEqual({
      decisionKind: "transition",
      eventKind: "greeting",
      outcome: "none",
    });
    expect(out.response).toEqual({ responseKey: "greeting", textBody: "synthetic-body" });
  });
});

// ===========================================================================
// 2/3/4. state ↔ nextState
// ===========================================================================

describe("2. state ↔ nextState", () => {
  test("injeta state a partir de nextState quando patch.state omitido", () => {
    const d = decision({
      nextState: "awaiting_vehicle",
      statePatch: { currentIntent: "km_update" },
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect(out.patch.state).toBe("awaiting_vehicle");
  });

  test("preserva patch.state explícito quando igual a nextState", () => {
    const d = decision({
      nextState: "awaiting_km_confirmation",
      statePatch: { state: "awaiting_km_confirmation" },
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect(out.patch.state).toBe("awaiting_km_confirmation");
  });

  test("rejeita divergência entre patch.state e nextState", () => {
    const d = decision({
      nextState: "idle",
      statePatch: { state: "awaiting_vehicle" },
    });
    expect(() =>
      callMapper({ ...INFRA, decision: d })
    ).toThrow(RepositoryError);
  });
});

// ===========================================================================
// 5/6/7. lastMessageId e imutabilidade
// ===========================================================================

describe("3. lastMessageId e imutabilidade", () => {
  test("strip lastMessageId do patch enviado", () => {
    const d = decision({
      statePatch: { state: "idle", lastMessageId: MSG_T1 },
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect("lastMessageId" in out.patch).toBe(false);
  });

  test("não modifica a decisão original nem o statePatch original", () => {
    const originalPatch: ConversationStatePatch = {
      state: "awaiting_vehicle",
      lastMessageId: MSG_T1,
      draftId: MSG_T1,
    };
    const d = decision({ nextState: "awaiting_vehicle", statePatch: originalPatch });
    const snapshotPatch = { ...originalPatch };
    const snapshotDecision = { ...d };
    callMapper({ ...INFRA, decision: d });
    expect(originalPatch).toEqual(snapshotPatch);
    expect(d).toEqual(snapshotDecision);
    expect("lastMessageId" in originalPatch).toBe(true);
  });

  test("mensagem atual permanece exclusivamente representada fora do patch (RPC injeta v_msg.id)", () => {
    // O mapper não move lastMessageId para nenhum campo alternativo.
    const d = decision({
      statePatch: { state: "idle", lastMessageId: MSG_T1 },
    });
    const out = callMapper({ ...INFRA, decision: d });
    const serialized = JSON.stringify(out);
    expect(serialized.includes(MSG_T1)).toBe(false);
  });
});

// ===========================================================================
// 8/9/10/11. infra
// ===========================================================================

describe("4. campos de infraestrutura", () => {
  test("preserva queueItemId, leaseToken, orchestratorVersion", () => {
    const out = mapConversationDecisionToTransitionInput({
      ...INFRA,
      decision: decision(),
    });
    expect(out.queueItemId).toBe(QUEUE_ITEM_ID);
    expect(out.leaseToken).toBe(LEASE_TOKEN);
    expect(out.orchestratorVersion).toBe(ORCH_VERSION);
  });

  test("preserva expectedStateVersion incluindo 0", () => {
    const out = mapConversationDecisionToTransitionInput({
      ...INFRA,
      expectedStateVersion: 0,
      decision: decision(),
    });
    expect(out.expectedStateVersion).toBe(0);
  });
});

// ===========================================================================
// 12/13. resultSummary e response
// ===========================================================================

describe("5. resultSummary e response", () => {
  test("resultSummary camelCase estrito", () => {
    const d = decision({
      eventKind: "vehicle_reply",
      decisionKind: "select_vehicle",
      outcome: "none",
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect(Object.keys(out.resultSummary).sort()).toEqual(
      ["decisionKind", "eventKind", "outcome"].sort(),
    );
  });

  test("response = null quando responseKey ausente", () => {
    const d = decision({ responseKey: null });
    const out = callMapper({ ...INFRA, decision: d });
    expect(out.response).toBeNull();
  });

  test("response construído a partir de responseKey", () => {
    const d = decision({ responseKey: "help" });
    const out = callMapper({ ...INFRA, decision: d });
    expect(out.response).toEqual({ responseKey: "help", textBody: "synthetic-body" });
  });
});

// ===========================================================================
// 14/15/16/17. null vs ausência
// ===========================================================================

describe("6. null explícito vs ausência", () => {
  test("null explícito é preservado", () => {
    const d = decision({
      statePatch: {
        state: "idle",
        activeVehicleId: null,
        draftId: null,
        draftVersion: null,
        draftType: null,
        draftPayload: null,
      },
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect(out.patch.activeVehicleId).toBeNull();
    expect(out.patch.draftId).toBeNull();
    expect(out.patch.draftVersion).toBeNull();
    expect(out.patch.draftType).toBeNull();
    expect(out.patch.draftPayload).toBeNull();
  });

  test("propriedade ausente permanece ausente (não materializa como null)", () => {
    const d = decision({
      nextState: "awaiting_vehicle",
      statePatch: { currentIntent: "km_update" },
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect("draftId" in out.patch).toBe(false);
    expect("draftVersion" in out.patch).toBe(false);
    expect("draftType" in out.patch).toBe(false);
    expect("draftPayload" in out.patch).toBe(false);
    expect("activeVehicleId" in out.patch).toBe(false);
  });

  test("undefined explícito não vira null", () => {
    const d = decision({
      nextState: "idle",
      statePatch: {
        state: "idle",
        draftId: undefined,
        draftVersion: undefined,
      },
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect("draftId" in out.patch).toBe(false);
    expect("draftVersion" in out.patch).toBe(false);
  });
});

// ===========================================================================
// 18-25. Cenários KM (parcial v0, completo v0, promoção v1, seleção)
// ===========================================================================

describe("7. cenários KM preservados pelo mapper", () => {
  test("draft parcial novo v0 com km_reported", () => {
    const d = decision({
      eventKind: "km_reported",
      decisionKind: "transition",
      nextState: "awaiting_vehicle",
      statePatch: {
        state: "awaiting_vehicle",
        currentIntent: "km_update",
        awaitingField: "vehicle",
        draftType: "km_update",
        draftId: MSG_T1,
        draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
        draftPayload: { phase: "awaiting_vehicle", newKm: 12345, requestMessageId: MSG_T1 },
      },
      responseKey: "vehicle_ambiguous",
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect(out.patch.draftVersion).toBe(0);
    expect(out.patch.draftId).toBe(MSG_T1);
    expect(out.resultSummary.eventKind).toBe("km_reported");
  });

  test("draft completo direto novo v0", () => {
    const d = decision({
      eventKind: "km_reported",
      decisionKind: "transition",
      nextState: "awaiting_km_confirmation",
      statePatch: {
        state: "awaiting_km_confirmation",
        currentIntent: "km_update",
        awaitingField: "confirmation",
        activeVehicleId: VEH_1,
        draftType: "km_update",
        draftId: MSG_T1,
        draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
        draftPayload: {
          phase: "awaiting_confirmation",
          vehicleId: VEH_1,
          newKm: 12345,
          expectedPreviousKm: 10000,
          isCorrection: false,
          requestMessageId: MSG_T1,
        },
        lastMessageId: MSG_T1,
      },
      responseKey: "km_update_confirmation",
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect(out.patch.draftVersion).toBe(0);
    expect(out.patch.draftId).toBe(MSG_T1);
    expect("lastMessageId" in out.patch).toBe(false);
  });

  test("promoção v0→v1 preserva draftId original", () => {
    const d = decision({
      eventKind: "vehicle_reply",
      decisionKind: "transition",
      nextState: "awaiting_km_confirmation",
      statePatch: {
        state: "awaiting_km_confirmation",
        activeVehicleId: VEH_1,
        draftType: "km_update",
        draftId: MSG_T1,
        draftVersion: KM_UPDATE_PROMOTED_DRAFT_VERSION,
        draftPayload: {
          phase: "awaiting_confirmation",
          vehicleId: VEH_1,
          newKm: 12345,
          expectedPreviousKm: 10000,
          isCorrection: false,
          requestMessageId: MSG_T1,
        },
        lastMessageId: MSG_SELECTION,
      },
      responseKey: "km_update_confirmation",
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect(out.patch.draftId).toBe(MSG_T1);
    expect(out.patch.draftVersion).toBe(1);
    expect(out.resultSummary.eventKind).toBe("vehicle_reply");
    expect("lastMessageId" in out.patch).toBe(false);
  });

  test("seleção inválida omite campos de draft", () => {
    const d = decision({
      eventKind: "vehicle_reply",
      decisionKind: "select_vehicle",
      nextState: "awaiting_vehicle",
      statePatch: { state: "awaiting_vehicle" },
      responseKey: "vehicle_not_found",
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect("draftId" in out.patch).toBe(false);
    expect("draftVersion" in out.patch).toBe(false);
    expect("draftType" in out.patch).toBe(false);
    expect("draftPayload" in out.patch).toBe(false);
  });

  test("seleção ambígua omite campos de draft", () => {
    const d = decision({
      eventKind: "vehicle_reply",
      decisionKind: "select_vehicle",
      nextState: "awaiting_vehicle",
      statePatch: { state: "awaiting_vehicle" },
      responseKey: "vehicle_ambiguous",
    });
    const out = callMapper({ ...INFRA, decision: d });
    expect("draftId" in out.patch).toBe(false);
    expect("draftPayload" in out.patch).toBe(false);
  });
});

// ===========================================================================
// 26/27/28. anti-T2 / anti-E1A
// ===========================================================================

describe("8. anti-T2 / anti-E1A", () => {
  test("não produz confirm_km_update em nenhum campo", () => {
    const d = decision({ responseKey: "km_update_confirmation" });
    const out = callMapper({ ...INFRA, decision: d });
    expect(JSON.stringify(out).includes("confirm_km_update")).toBe(false);
  });

  test("não produz campos de action execution (E1A)", () => {
    const d = decision({
      statePatch: {
        state: "awaiting_km_confirmation",
        draftPayload: { vehicleId: VEH_1, newKm: 12345 },
      },
    });
    const out = mapConversationDecisionToTransitionInput({
      ...INFRA,
      decision: { ...d, nextState: "awaiting_km_confirmation" },
    });
    const serialized = JSON.stringify(out);
    for (const forbidden of [
      "executeConfirmedKmUpdate",
      "apply_whatsapp_confirmed_km_update",
      "action_execution",
    ]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});

// ===========================================================================
// 29. Decisões não persistíveis
// ===========================================================================

describe("9. rejeição de decisões não persistíveis", () => {
  const REJECTED: ConversationDecisionKind[] = [
    "defer_legacy_media",
    "defer_legacy_opt_out",
    "no_op",
  ];
  for (const kind of REJECTED) {
    test(`rejeita decisionKind = ${kind}`, () => {
      const d = decision({ decisionKind: kind });
      expect(() =>
        callMapper({ ...INFRA, decision: d })
      ).toThrow(RepositoryError);
    });
  }
});

// ===========================================================================
// 30. Determinismo e ausência de referência mutável
// ===========================================================================

describe("10. determinismo e imutabilidade estrutural", () => {
  test("duas chamadas iguais retornam objetos estruturalmente iguais", () => {
    const d = decision({
      nextState: "awaiting_vehicle",
      statePatch: {
        state: "awaiting_vehicle",
        draftId: MSG_T1,
        draftVersion: 0,
        draftPayload: { newKm: 12345 },
      },
      responseKey: "vehicle_ambiguous",
    });
    const a = callMapper({ ...INFRA, decision: d });
    const b = callMapper({ ...INFRA, decision: d });
    expect(a).toEqual(b);
  });

  test("mutação no patch retornado não afeta statePatch original", () => {
    const originalPayload = { newKm: 12345 };
    const originalPatch: ConversationStatePatch = {
      state: "awaiting_vehicle",
      draftPayload: originalPayload,
    };
    const d = decision({ nextState: "awaiting_vehicle", statePatch: originalPatch });
    const out = callMapper({ ...INFRA, decision: d });
    // Substituir a chave no patch retornado não deve criar/remover chaves no original.
    (out.patch as Record<string, unknown>).draftPayload = { newKm: 999 };
    expect(originalPatch.draftPayload).toBe(originalPayload);
    expect((originalPatch.draftPayload as Record<string, unknown>).newKm).toBe(12345);
  });
});
