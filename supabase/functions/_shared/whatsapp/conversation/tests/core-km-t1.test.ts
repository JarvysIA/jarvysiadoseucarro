// Build 5.7F2E1A.5-MF — Cobertura T1 de KM no core (test-only).
// Alvo: decideConversation. Verifica drafts determinísticos parciais/completos,
// preservação segura durante seleção de veículo, invariantes de identidade
// (draftId === requestMessageId === sourceMessageId UUID), ausência de T2
// (confirm_km_update jamais é produzido; nenhuma decisão applied/no_op/replayed
// de sucesso; nenhum caminho de execução acionado) e regressão do fluxo legado
// awaiting_vehicle (não-km_update).

import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type {
  ConversationCoreDecision,
  ConversationCoreInput,
  ConversationState,
  ConversationVehicle,
} from "../types.ts";
import {
  KM_UPDATE_INITIAL_DRAFT_VERSION,
  KM_UPDATE_PROMOTED_DRAFT_VERSION,
  validateAwaitingConfirmationKmUpdateDraft,
  validateAwaitingVehicleKmUpdateDraft,
} from "../km-update-draft.ts";
import {
  CONFIRM_KM_UPDATE_HANDOFF_KIND,
  KM_REPORTED_EVENT_KIND,
} from "../km-update-protocol.ts";

// UUIDs determinísticos (RFC 4122 v4) — congelam identidade em todos os testes.
const MSG_UUID_A = "11111111-1111-4111-8111-111111111111";
const MSG_UUID_B = "22222222-2222-4222-8222-222222222222";
const VEH_UUID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const VEH_UUID_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const VEH_UUID_3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";

function state(overrides: Partial<ConversationState> = {}): ConversationState {
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

function inp(overrides: Partial<ConversationCoreInput> = {}): ConversationCoreInput {
  return {
    sourceMessageId: MSG_UUID_A,
    messageType: "text",
    originalText: "",
    now: "2026-07-11T12:00:00.000Z",
    state: state(),
    vehicles: [],
    fallbackCount: 0,
    isReplay: false,
    ...overrides,
  };
}

/**
 * Guardas anti-T2: nenhuma decisão do T1 pode produzir handoff de execução,
 * marcar tarefa como completa/aplicada, nem sinalizar sucesso de KM.
 */
function assertNoT2Leakage(d: ConversationCoreDecision) {
  // Nenhuma referência ao literal T2 em nenhum campo textual da decisão.
  const serialized = JSON.stringify(d);
  expect(serialized.includes(CONFIRM_KM_UPDATE_HANDOFF_KIND)).toBe(false);
  // eventKind pertence ao contrato conhecido — jamais confirm_km_update
  expect(d.eventKind).not.toBe(
    CONFIRM_KM_UPDATE_HANDOFF_KIND as unknown as ConversationCoreDecision["eventKind"],
  );
  // T1 nunca conclui a execução de KM: outcome "completed" só é aceitável
  // em caminhos de select_vehicle (legacy) — não no fluxo KM.
  if (d.eventKind === KM_REPORTED_EVENT_KIND) {
    expect(d.outcome).not.toBe("completed");
    expect(d.statePatch.executedAt ?? null).toBeNull();
    expect(d.statePatch.executedAt ?? null).toBeNull();
    expect(d.statePatch.confirmedAt ?? null).toBeNull();
  }
}

// ---------------------------------------------------------------------------
// A. Detecção em idle — draft direto (veículo resolvível)
// ---------------------------------------------------------------------------

describe("core T1 — draft completo direto em idle", () => {
  test("veículo único elegível + relato explícito de KM → draft novo persistido v0 (INITIAL) awaiting_km_confirmation", () => {
    const v = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 10000);
    const d = decideConversation(
      inp({
        originalText: "km 12345",
        vehicles: [v],
        sourceMessageId: MSG_UUID_A,
      }),
    );

    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("transition");
    expect(d.nextState).toBe("awaiting_km_confirmation");
    expect(d.responseKey).toBe("km_update_confirmation");
    expect(d.outcome).toBe("none");

    expect(d.statePatch.state).toBe("awaiting_km_confirmation");
    expect(d.statePatch.currentIntent).toBe("km_update");
    expect(d.statePatch.awaitingField).toBe("confirmation");
    expect(d.statePatch.draftType).toBe("km_update");
    expect(d.statePatch.draftId).toBe(MSG_UUID_A);
    expect(d.statePatch.draftVersion).toBe(KM_UPDATE_INITIAL_DRAFT_VERSION);
    expect(d.statePatch.activeVehicleId).toBe(VEH_UUID_1);
    expect(d.statePatch.lastMessageId).toBe(MSG_UUID_A);

    // Payload validado por MB e congelado por igualdade estrutural.
    expect(d.statePatch.draftPayload).toEqual({
      phase: "awaiting_confirmation",
      vehicleId: VEH_UUID_1,
      expectedPreviousKm: 10000,
      newKm: 12345,
      requestMessageId: MSG_UUID_A,
      isCorrection: false,
    });
    const val = validateAwaitingConfirmationKmUpdateDraft(d.statePatch.draftPayload);
    expect(val.ok).toBe(true);

    // Invariante de identidade: draftId === requestMessageId === sourceMessageId.
    const payload = d.statePatch.draftPayload as { requestMessageId: string };
    expect(payload.requestMessageId).toBe(MSG_UUID_A);
    expect(d.statePatch.draftId).toBe(payload.requestMessageId);

    assertNoT2Leakage(d);
  });

  test("kmAtual 0 + aumento → isCorrection=false", () => {
    const v = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 0);
    const d = decideConversation(
      inp({ originalText: "odometro 100 km", vehicles: [v] }),
    );
    expect(d.nextState).toBe("awaiting_km_confirmation");
    expect((d.statePatch.draftPayload as { isCorrection: boolean }).isCorrection).toBe(false);
    expect((d.statePatch.draftPayload as { expectedPreviousKm: number | null }).expectedPreviousKm).toBe(0);
  });

  test("igualdade newKm === kmAtual → isCorrection=false (comparação estrita <)", () => {
    const v = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 500);
    const d = decideConversation(
      inp({ originalText: "km 500", vehicles: [v] }),
    );
    expect(d.nextState).toBe("awaiting_km_confirmation");
    expect(d.responseKey).toBe("km_update_confirmation");
    expect((d.statePatch.draftPayload as { isCorrection: boolean }).isCorrection).toBe(false);
  });

  test("redução newKm < kmAtual → isCorrection=true + state de correção", () => {
    const v = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 20000);
    const d = decideConversation(
      inp({ originalText: "km 15000", vehicles: [v] }),
    );
    expect(d.nextState).toBe("awaiting_km_correction_confirmation");
    expect(d.responseKey).toBe("km_update_correction_confirmation");
    expect((d.statePatch.draftPayload as { isCorrection: boolean }).isCorrection).toBe(true);
  });

  test("kmAtual null → draft completo com expectedPreviousKm=null e isCorrection=false", () => {
    const v = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", null);
    const d = decideConversation(
      inp({ originalText: "km 50000", vehicles: [v] }),
    );
    expect(d.nextState).toBe("awaiting_km_confirmation");
    const payload = d.statePatch.draftPayload as {
      expectedPreviousKm: number | null;
      isCorrection: boolean;
    };
    expect(payload.expectedPreviousKm).toBeNull();
    expect(payload.isCorrection).toBe(false);
  });

  test("limite máximo (INT_MAX) aceito", () => {
    const v = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 0);
    const d = decideConversation(
      inp({ originalText: "km 2147483647", vehicles: [v] }),
    );
    expect(d.decisionKind).toBe("transition");
    expect((d.statePatch.draftPayload as { newKm: number }).newKm).toBe(2147483647);
  });

  test("múltiplos veículos + activeVehicleId válido → resolve direto (draft novo persistido v0)", () => {
    const v1 = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 1000);
    const v2 = veh(VEH_UUID_2, "Chevrolet", "Onix", "XYZ4E56", 2000);
    const d = decideConversation(
      inp({
        originalText: "km 3000",
        vehicles: [v1, v2],
        state: state({ activeVehicleId: VEH_UUID_2 }),
      }),
    );
    expect(d.nextState).toBe("awaiting_km_confirmation");
    expect(d.statePatch.activeVehicleId).toBe(VEH_UUID_2);
    expect(d.statePatch.draftVersion).toBe(KM_UPDATE_INITIAL_DRAFT_VERSION);
    expect((d.statePatch.draftPayload as { vehicleId: string }).vehicleId).toBe(VEH_UUID_2);
    // Não é reaproveitamento de eventKind vehicle_reply — vem de km_reported.
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
  });
});

// ---------------------------------------------------------------------------
// B. Detecção em idle — draft parcial (nenhum veículo resolvível)
// ---------------------------------------------------------------------------

describe("core T1 — draft parcial em idle (sem resolução direta)", () => {
  const v1 = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 1000);
  const v2 = veh(VEH_UUID_2, "Chevrolet", "Onix", "XYZ4E56", 2000);

  test("múltiplos veículos sem activeVehicleId → draft parcial v0 awaiting_vehicle", () => {
    const d = decideConversation(
      inp({ originalText: "km 5000", vehicles: [v1, v2] }),
    );
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("transition");
    expect(d.nextState).toBe("awaiting_vehicle");
    // Congela responseKey observada canônica (solicitação de escolha).
    expect(d.responseKey).toBe("vehicle_ambiguous");

    expect(d.statePatch.state).toBe("awaiting_vehicle");
    expect(d.statePatch.draftType).toBe("km_update");
    expect(d.statePatch.draftId).toBe(MSG_UUID_A);
    expect(d.statePatch.draftVersion).toBe(KM_UPDATE_INITIAL_DRAFT_VERSION);
    expect(d.statePatch.draftPayload).toEqual({
      phase: "awaiting_vehicle",
      newKm: 5000,
      requestMessageId: MSG_UUID_A,
    });
    // Nenhum veículo escolhido arbitrariamente.
    expect(d.statePatch.activeVehicleId).toBeUndefined();

    const val = validateAwaitingVehicleKmUpdateDraft(d.statePatch.draftPayload);
    expect(val.ok).toBe(true);

    assertNoT2Leakage(d);
  });

  test("zero veículos elegíveis → responde no_eligible_vehicle, não cria draft", () => {
    const d = decideConversation(
      inp({ originalText: "km 100", vehicles: [] }),
    );
    expect(d.eventKind).toBe(KM_REPORTED_EVENT_KIND);
    expect(d.decisionKind).toBe("respond");
    expect(d.responseKey).toBe("no_eligible_vehicle");
    expect(d.statePatch.draftType).toBeUndefined();
    expect(d.statePatch.draftId).toBeUndefined();
    expect(d.statePatch.draftPayload).toBeUndefined();
    expect(d.statePatch.activeVehicleId).toBeUndefined();
    assertNoT2Leakage(d);
  });
});

// ---------------------------------------------------------------------------
// C. Não-detecção em idle
// ---------------------------------------------------------------------------

describe("core T1 — casos que NÃO iniciam KM", () => {
  const v1 = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 1000);

  test("número isolado sem rótulo/unidade não inicia KM (fallback)", () => {
    const d = decideConversation(
      inp({ originalText: "12345", vehicles: [v1] }),
    );
    expect(d.eventKind).toBe("unknown");
    expect(d.decisionKind).toBe("fallback");
    expect(d.statePatch.draftType).toBeUndefined();
  });

  test("entrada ambígua ('100 km e 200 km') não cria draft", () => {
    const d = decideConversation(
      inp({ originalText: "100 km e 200 km", vehicles: [v1] }),
    );
    expect(d.decisionKind).toBe("fallback");
    expect(d.statePatch.draftType).toBeUndefined();
  });

  test("formato inválido (sem dígitos após rótulo) não cria draft", () => {
    const d = decideConversation(
      inp({ originalText: "km abc", vehicles: [v1] }),
    );
    expect(d.decisionKind).toBe("fallback");
    expect(d.statePatch.draftType).toBeUndefined();
  });

  test("fora do range (> INT_MAX) não cria draft", () => {
    const d = decideConversation(
      inp({ originalText: "km 9999999999", vehicles: [v1] }),
    );
    expect(d.decisionKind).toBe("fallback");
    expect(d.statePatch.draftType).toBeUndefined();
  });

  test("comando global 'ajuda' tem prioridade mesmo com contexto de veículo", () => {
    const d = decideConversation(
      inp({ originalText: "ajuda", vehicles: [v1] }),
    );
    expect(d.eventKind).toBe("help");
    expect(d.responseKey).toBe("help");
    expect(d.statePatch.draftType).toBeUndefined();
  });

  test("comando global 'cancela' tem prioridade sobre parser KM", () => {
    // Sem pendência: apenas informa nothing_to_cancel.
    const d = decideConversation(
      inp({ originalText: "cancela", vehicles: [v1] }),
    );
    expect(d.eventKind).toBe("cancel_task");
    expect(d.statePatch.draftType).toBeUndefined();
  });

  test("saudação isolada não dispara KM", () => {
    const d = decideConversation(
      inp({ originalText: "oi", vehicles: [v1] }),
    );
    expect(d.eventKind).toBe("greeting");
    expect(d.statePatch.draftType).toBeUndefined();
  });

  test("sourceMessageId não-UUID não inicia KM em idle (invariante de identidade)", () => {
    const d = decideConversation(
      inp({ originalText: "km 500", vehicles: [v1], sourceMessageId: "msg-1" }),
    );
    // Sem UUID válido, o gate de identidade impede criação de draft.
    expect(d.eventKind).not.toBe(KM_REPORTED_EVENT_KIND);
    expect(d.statePatch.draftType).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D. Parser não atua em states de outro domínio / próprios estados KM
// ---------------------------------------------------------------------------

describe("core T1 — parser inerte em states não-idle", () => {
  const v1 = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 1000);

  test("state awaiting_km_confirmation + 'km 999' → não reprocessa como novo km_reported", () => {
    const d = decideConversation(
      inp({
        originalText: "km 999",
        vehicles: [v1],
        state: state({
          state: "awaiting_km_confirmation",
          draftType: "km_update",
          draftId: MSG_UUID_B,
          draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
        }),
      }),
    );
    expect(d.eventKind).not.toBe(KM_REPORTED_EVENT_KIND);
    expect(d.decisionKind).not.toBe("transition");
    assertNoT2Leakage(d);
  });

  test("state awaiting_km_correction_confirmation → mesma inércia", () => {
    const d = decideConversation(
      inp({
        originalText: "km 42",
        vehicles: [v1],
        state: state({
          state: "awaiting_km_correction_confirmation",
          draftType: "km_update",
          draftId: MSG_UUID_B,
          draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
        }),
      }),
    );
    expect(d.eventKind).not.toBe(KM_REPORTED_EVENT_KIND);
    assertNoT2Leakage(d);
  });
});

// ---------------------------------------------------------------------------
// E. Complemento em awaiting_vehicle a partir de draft parcial KM
// ---------------------------------------------------------------------------

describe("core T1 — completar draft parcial via seleção de veículo", () => {
  const v1 = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 10000);
  const v2 = veh(VEH_UUID_2, "Chevrolet", "Onix", "XYZ4E56", 20000);
  const partialPayload = {
    phase: "awaiting_vehicle" as const,
    newKm: 15000,
    requestMessageId: MSG_UUID_A,
  };
  const partialState = state({
    state: "awaiting_vehicle",
    currentIntent: "km_update",
    awaitingField: "vehicle",
    draftType: "km_update",
    draftId: MSG_UUID_A,
    draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
    draftPayload: partialPayload,
  });

  test("seleção válida completa o mesmo draft: v0→v1, eventKind vehicle_reply, draftId preservado", () => {
    const d = decideConversation(
      inp({
        originalText: "onix",
        vehicles: [v1, v2],
        state: partialState,
        sourceMessageId: MSG_UUID_B, // mensagem de resposta é outra
      }),
    );
    expect(d.eventKind).toBe("vehicle_reply");
    expect(d.decisionKind).toBe("transition");
    // Onix kmAtual=20000, newKm=15000 → redução → correção.
    expect(d.nextState).toBe("awaiting_km_correction_confirmation");
    expect(d.responseKey).toBe("km_update_correction_confirmation");

    expect(d.statePatch.draftType).toBe("km_update");
    // draftId é preservado do parcial (não muda para o sourceMessageId da resposta).
    expect(d.statePatch.draftId).toBe(MSG_UUID_A);
    // Promoção do MESMO draft parcial: version persistida avança 0 → 1.
    expect(d.statePatch.draftVersion).toBe(KM_UPDATE_PROMOTED_DRAFT_VERSION);
    expect(d.statePatch.activeVehicleId).toBe(VEH_UUID_2);
    // lastMessageId acompanha a mensagem atual (a de seleção).
    expect(d.statePatch.lastMessageId).toBe(MSG_UUID_B);

    expect(d.statePatch.draftPayload).toEqual({
      phase: "awaiting_confirmation",
      vehicleId: VEH_UUID_2,
      expectedPreviousKm: 20000,
      newKm: 15000,
      requestMessageId: MSG_UUID_A, // requestMessageId original preservado
      isCorrection: true,
    });

    assertNoT2Leakage(d);
  });

  test("seleção válida com kmAtual maior → state normal (sem correção)", () => {
    const vSmall = veh(VEH_UUID_3, "VW", "Gol", "GGG1H23", 10000);
    const partial = state({
      ...partialState,
      draftPayload: { ...partialPayload, newKm: 12000 },
    });
    const d = decideConversation(
      inp({
        originalText: "gol",
        vehicles: [vSmall, v2],
        state: partial,
        sourceMessageId: MSG_UUID_B,
      }),
    );
    expect(d.nextState).toBe("awaiting_km_confirmation");
    expect(d.responseKey).toBe("km_update_confirmation");
    expect((d.statePatch.draftPayload as { isCorrection: boolean }).isCorrection).toBe(false);
  });

  test("seleção inválida (placa inexistente) preserva integralmente o draft parcial v0", () => {
    const stateBefore: ConversationState = {
      ...partialState,
      activeVehicleId: null,
    };
    const d = decideConversation(
      inp({
        originalText: "corolla",
        vehicles: [v1, v2],
        state: stateBefore,
        sourceMessageId: MSG_UUID_B,
      }),
    );
    expect(d.eventKind).toBe("vehicle_reply");
    expect(d.responseKey).toBe("vehicle_not_found");
    expect(d.nextState).toBe("awaiting_vehicle");

    // Nenhuma chave do draft aparece no patch — state original preservado.
    expect(d.statePatch.state).toBeUndefined();
    expect(d.statePatch.draftType).toBeUndefined();
    expect(d.statePatch.draftId).toBeUndefined();
    expect(d.statePatch.draftVersion).toBeUndefined();
    expect(d.statePatch.draftPayload).toBeUndefined();
    expect(d.statePatch.activeVehicleId).toBeUndefined();

    // Simulação: aplicar o patch ao state anterior mantém o draft idêntico.
    const merged: ConversationState = { ...stateBefore, ...d.statePatch };
    expect(merged.draftType).toBe("km_update");
    expect(merged.draftId).toBe(MSG_UUID_A);
    expect(merged.draftVersion).toBe(KM_UPDATE_INITIAL_DRAFT_VERSION);
    expect(merged.draftPayload).toEqual(partialPayload);
    expect(merged.state).toBe("awaiting_vehicle");
    expect(merged.activeVehicleId).toBeNull();

    assertNoT2Leakage(d);
  });

  test("seleção ambígua preserva integralmente o draft parcial v0", () => {
    const argo2 = veh(VEH_UUID_3, "Fiat", "Argo", "QWE1D23", 5000);
    const d = decideConversation(
      inp({
        originalText: "argo",
        vehicles: [v1, argo2],
        state: partialState,
        sourceMessageId: MSG_UUID_B,
      }),
    );
    expect(d.responseKey).toBe("vehicle_ambiguous");
    expect(d.nextState).toBe("awaiting_vehicle");
    expect(d.statePatch.draftType).toBeUndefined();
    expect(d.statePatch.draftPayload).toBeUndefined();
    const merged: ConversationState = { ...partialState, ...d.statePatch };
    expect(merged.draftPayload).toEqual(partialPayload);
    expect(merged.draftVersion).toBe(KM_UPDATE_INITIAL_DRAFT_VERSION);
  });

  test("draft malformado (payload corrompido) NÃO é completado como km", () => {
    const bad = state({
      state: "awaiting_vehicle",
      draftType: "km_update",
      draftId: MSG_UUID_A,
      draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
      draftPayload: { phase: "awaiting_vehicle", newKm: -1, requestMessageId: MSG_UUID_A },
    });
    const d = decideConversation(
      inp({
        originalText: "onix",
        vehicles: [v1, v2],
        state: bad,
        sourceMessageId: MSG_UUID_B,
      }),
    );
    // Cai no caminho legacy select_vehicle — não emite km_update_confirmation.
    expect(d.responseKey).not.toBe("km_update_confirmation");
    expect(d.responseKey).not.toBe("km_update_correction_confirmation");
    expect(d.nextState).not.toBe("awaiting_km_confirmation");
    expect(d.nextState).not.toBe("awaiting_km_correction_confirmation");
    assertNoT2Leakage(d);
  });

  test("draft parcial com versão != 0 NÃO é completado", () => {
    const wrongVersion = state({
      ...partialState,
      draftVersion: 99,
    });
    const d = decideConversation(
      inp({
        originalText: "onix",
        vehicles: [v1, v2],
        state: wrongVersion,
        sourceMessageId: MSG_UUID_B,
      }),
    );
    expect(d.responseKey).not.toBe("km_update_confirmation");
    expect(d.responseKey).not.toBe("km_update_correction_confirmation");
    // Cai no fluxo legado select_vehicle.
    expect(d.decisionKind).toBe("select_vehicle");
  });

  test("draft parcial sem draftId (null) NÃO é completado", () => {
    const noId = state({
      ...partialState,
      draftId: null,
    });
    const d = decideConversation(
      inp({
        originalText: "onix",
        vehicles: [v1, v2],
        state: noId,
        sourceMessageId: MSG_UUID_B,
      }),
    );
    expect(d.decisionKind).toBe("select_vehicle");
    expect(d.responseKey).not.toBe("km_update_confirmation");
  });

  test("draft parcial com draftId != requestMessageId NÃO é completado", () => {
    const mismatch = state({
      ...partialState,
      draftId: MSG_UUID_B, // diferente do requestMessageId do payload (MSG_UUID_A)
    });
    const d = decideConversation(
      inp({
        originalText: "onix",
        vehicles: [v1, v2],
        state: mismatch,
        sourceMessageId: MSG_UUID_B,
      }),
    );
    expect(d.decisionKind).toBe("select_vehicle");
    expect(d.responseKey).not.toBe("km_update_confirmation");
  });

  test("phase != awaiting_vehicle NÃO é completado", () => {
    const wrongPhase = state({
      ...partialState,
      draftPayload: {
        phase: "awaiting_confirmation",
        newKm: 15000,
        requestMessageId: MSG_UUID_A,
      },
    });
    const d = decideConversation(
      inp({
        originalText: "onix",
        vehicles: [v1, v2],
        state: wrongPhase,
        sourceMessageId: MSG_UUID_B,
      }),
    );
    expect(d.decisionKind).toBe("select_vehicle");
    expect(d.responseKey).not.toBe("km_update_confirmation");
  });
});

// ---------------------------------------------------------------------------
// F. Confirmações em estados KM não acionam T2
// ---------------------------------------------------------------------------

describe("core T1 — confirmações em states KM não emitem T2", () => {
  const kmState = state({
    state: "awaiting_km_confirmation",
    currentIntent: "km_update",
    awaitingField: "confirmation",
    draftType: "km_update",
    draftId: MSG_UUID_A,
    draftVersion: KM_UPDATE_INITIAL_DRAFT_VERSION,
    draftPayload: {
      phase: "awaiting_confirmation",
      vehicleId: VEH_UUID_1,
      expectedPreviousKm: 1000,
      newKm: 2000,
      requestMessageId: MSG_UUID_A,
      isCorrection: false,
    },
    activeVehicleId: VEH_UUID_1,
  });

  test("'sim' em awaiting_km_confirmation não produz sucesso/handoff/execução", () => {
    const d = decideConversation(
      inp({ originalText: "sim", state: kmState, sourceMessageId: MSG_UUID_B }),
    );
    expect(d.decisionKind).toBe("respond");
    expect(d.decisionKind).not.toBe("no_op");
    expect(d.responseKey).toBe("nothing_to_confirm");
    expect(d.outcome).not.toBe("completed");
    // Draft não é limpo pelo T1.
    expect(d.statePatch.draftType).toBeUndefined();
    expect(d.statePatch.draftId).toBeUndefined();
    expect(d.statePatch.draftPayload).toBeUndefined();
    assertNoT2Leakage(d);
  });

  test("'sim' em awaiting_km_correction_confirmation: mesmas garantias", () => {
    const corr = { ...kmState, state: "awaiting_km_correction_confirmation" as const };
    const d = decideConversation(
      inp({ originalText: "sim", state: corr, sourceMessageId: MSG_UUID_B }),
    );
    expect(d.responseKey).toBe("nothing_to_confirm");
    expect(d.outcome).not.toBe("completed");
    expect(d.statePatch.draftType).toBeUndefined();
    assertNoT2Leakage(d);
  });
});

// ---------------------------------------------------------------------------
// G. Regressão: fluxo awaiting_vehicle legado não-KM permanece igual ao baseline
// ---------------------------------------------------------------------------

describe("core T1 — regressão awaiting_vehicle legado (não-km_update)", () => {
  test("state awaiting_vehicle sem draftType KM + match único → select_vehicle inalterado", () => {
    const v1 = veh(VEH_UUID_1, "Fiat", "Argo", "ABC1D23", 1000);
    const v2 = veh(VEH_UUID_2, "Chevrolet", "Onix", "XYZ4E56", 2000);
    const d = decideConversation(
      inp({
        originalText: "onix",
        vehicles: [v1, v2],
        state: state({ state: "awaiting_vehicle", currentIntent: "select_vehicle" }),
        sourceMessageId: MSG_UUID_B,
      }),
    );
    expect(d.decisionKind).toBe("select_vehicle");
    expect(d.eventKind).toBe("vehicle_reply");
    expect(d.outcome).toBe("completed");
    expect(d.nextState).toBe("idle");
    expect(d.statePatch.state).toBe("idle");
    expect(d.statePatch.activeVehicleId).toBe(VEH_UUID_2);
    expect(d.responseKey).toBe("vehicle_selected");
    // Nenhum campo KM aparece.
    expect(d.statePatch.draftType).toBeNull();
    assertNoT2Leakage(d);
  });
});
