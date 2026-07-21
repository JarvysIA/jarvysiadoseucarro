import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import { isVehicleAccessAllowed, isWhatsappVehicleAccessMode } from "../vehicle-access-policy.ts";
import { resolveVehicle } from "../vehicles.ts";
import type {
  ConversationCoreInput,
  ConversationState,
  ConversationVehicle,
  WhatsappVehicleAccessMode,
} from "../types.ts";

const MSG_A = "11111111-1111-4111-8111-111111111111";
const MSG_B = "22222222-2222-4222-8222-222222222222";
const FULL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const PASSIVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const DENIED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";

function state(over: Partial<ConversationState> = {}): ConversationState {
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
    ...over,
  };
}

function vehicle(id: string, mode: WhatsappVehicleAccessMode, model = "Argo"): ConversationVehicle {
  return {
    id,
    brand: "Fiat",
    model,
    plate: id === FULL_ID ? "FUL1A23" : id === PASSIVE_ID ? "PAS1B23" : "DEN1C23",
    isArchived: false,
    isEligible: true,
    kmAtual: 10000,
    whatsappAccessMode: mode,
    optionalLabel: null,
  };
}

function runtimeModeVehicle(mode: unknown): ConversationVehicle {
  const base = vehicle(PASSIVE_ID, "passive_with_km", "Polo") as unknown as Record<string, unknown>;
  if (mode === undefined) delete base.whatsappAccessMode;
  else base.whatsappAccessMode = mode;
  return base as unknown as ConversationVehicle;
}

function input(over: Partial<ConversationCoreInput> = {}): ConversationCoreInput {
  return {
    sourceMessageId: MSG_A,
    messageType: "text",
    originalText: "",
    now: "2026-07-20T12:00:00.000Z",
    state: state(),
    vehicles: [],
    fallbackCount: 0,
    isReplay: false,
    ...over,
  };
}

function kmConfirmationState(vehicleId: string): ConversationState {
  return state({
    state: "awaiting_km_confirmation",
    currentIntent: "km_update",
    awaitingField: "confirmation",
    draftType: "km_update",
    draftId: MSG_A,
    draftVersion: 1,
    activeVehicleId: vehicleId,
    draftPayload: {
      phase: "awaiting_confirmation",
      vehicleId,
      expectedPreviousKm: 10000,
      newKm: 12000,
      requestMessageId: MSG_A,
      isCorrection: false,
    },
  });
}

function expenseConfirmationState(vehicleId: string): ConversationState {
  return state({
    state: "awaiting_expense_confirmation",
    currentIntent: "expense",
    awaitingField: "confirmation",
    draftType: "expense",
    draftId: MSG_A,
    draftVersion: 1,
    activeVehicleId: vehicleId,
    draftPayload: {
      phase: "awaiting_confirmation",
      categoria: "Combustível",
      valor: 80,
      vehicleId,
      requestMessageId: MSG_A,
    },
  });
}

function expectRestricted(decision: ReturnType<typeof decideConversation>) {
  expect(decision.decisionKind).toBe("respond");
  expect(decision.responseKey).toBe("vehicle_access_restricted");
  expect(decision.reasonCode).toBe("vehicle_access_restricted");
  expect(decision.deferToLegacyRouter).toBe(false);
  expect(decision.nextFallbackCount).toBe(0);
}

function expectDraftInvalidated(decision: ReturnType<typeof decideConversation>) {
  expectRestricted(decision);
  expect(decision.nextState).toBe("idle");
  expect(decision.outcome).toBe("cancelled");
  expect(decision.statePatch).toMatchObject({
    state: "idle",
    currentIntent: null,
    awaitingField: null,
    requestSource: null,
    draftType: null,
    draftId: null,
    draftVersion: null,
    draftPayload: null,
    confirmedAt: null,
    executedAt: null,
    expiresAt: null,
    activeVehicleId: null,
  });
  expect(typeof decision.statePatch.lastMessageId).toBe("string");
}

function applyDecisionState(
  current: ConversationState,
  decision: ReturnType<typeof decideConversation>,
): ConversationState {
  return { ...current, ...decision.statePatch, state: decision.nextState };
}

describe("vehicle access policy", () => {
  test("full permite ação full; passive, denied, ausente e inválido bloqueiam", () => {
    expect(isVehicleAccessAllowed("full", "full_action")).toBe(true);
    expect(isVehicleAccessAllowed("passive_with_km", "full_action")).toBe(false);
    expect(isVehicleAccessAllowed("denied", "full_action")).toBe(false);
    expect(isVehicleAccessAllowed(undefined, "full_action")).toBe(false);
    expect(isVehicleAccessAllowed("unexpected", "full_action")).toBe(false);
    expect(isWhatsappVehicleAccessMode("unexpected")).toBe(false);
  });

  test.each(["full", "passive_with_km", "denied", undefined, "unexpected"])(
    "cancel/reset são seguros independentemente do modo (%s)",
    (mode) => {
      expect(isVehicleAccessAllowed(mode, "cancel")).toBe(true);
      expect(isVehicleAccessAllowed(mode, "reset")).toBe(true);
    },
  );
});

describe("seleção e veículo focal", () => {
  const full = vehicle(FULL_ID, "full", "Argo");
  const passive = vehicle(PASSIVE_ID, "passive_with_km", "Polo");
  const denied = vehicle(DENIED_ID, "denied", "Onix");

  test("full é resolvido e passive textual é reconhecido como restrito", () => {
    expect(
      resolveVehicle({ text: "Argo", vehicles: [full, passive], activeVehicleId: null }),
    ).toMatchObject({
      kind: "matched",
      vehicle: { id: FULL_ID },
    });
    expect(
      resolveVehicle({ text: "Polo", vehicles: [full, passive], activeVehicleId: null }),
    ).toMatchObject({
      kind: "restricted",
      vehicle: { id: PASSIVE_ID },
    });
  });

  test("denied não aparece como opção autorizável e full único permanece resolvível", () => {
    const resolved = resolveVehicle({
      text: null,
      vehicles: [full, denied],
      activeVehicleId: null,
    });
    expect(resolved).toMatchObject({ kind: "matched", vehicle: { id: FULL_ID } });
    const ambiguous = resolveVehicle({
      text: "Argo",
      vehicles: [full, { ...denied, model: "Argo" }],
      activeVehicleId: null,
    });
    expect(ambiguous).toMatchObject({ kind: "matched", vehicle: { id: FULL_ID } });
  });

  test("passive + denied não autoriza veículo para ação full", () => {
    expect(
      resolveVehicle({ text: null, vehicles: [passive, denied], activeVehicleId: null }).kind,
    ).toBe("restricted");
  });

  test("activeVehicleId passive não é reutilizado para KM ou despesa", () => {
    for (const text of ["km 12000", "gasolina R$ 80"]) {
      expectRestricted(
        decideConversation(
          input({
            originalText: text,
            state: state({ activeVehicleId: PASSIVE_ID }),
            vehicles: [full, passive],
          }),
        ),
      );
    }
  });

  test("resposta textual com veículo restrito não o ativa", () => {
    const pending = state({
      state: "awaiting_vehicle",
      currentIntent: "km_update",
      awaitingField: "vehicle",
      draftType: "km_update",
      draftId: MSG_A,
      draftVersion: 0,
      draftPayload: { phase: "awaiting_vehicle", newKm: 12000, requestMessageId: MSG_A },
    });
    const decision = decideConversation(
      input({
        sourceMessageId: MSG_B,
        originalText: "Polo",
        state: pending,
        vehicles: [full, passive],
      }),
    );
    expectRestricted(decision);
    expect(decision.statePatch.activeVehicleId).toBeUndefined();
  });

  test("resposta textual full substitui activeVehicleId passive durante seleção", () => {
    const pending = state({
      state: "awaiting_vehicle",
      currentIntent: "km_update",
      awaitingField: "vehicle",
      draftType: "km_update",
      draftId: MSG_A,
      draftVersion: 0,
      activeVehicleId: PASSIVE_ID,
      draftPayload: { phase: "awaiting_vehicle", newKm: 12000, requestMessageId: MSG_A },
    });
    const decision = decideConversation(
      input({
        sourceMessageId: MSG_B,
        originalText: "Argo",
        state: pending,
        vehicles: [full, passive],
      }),
    );
    expect(decision.nextState).toBe("awaiting_km_confirmation");
    expect(decision.responseKey).toBe("km_update_confirmation");
    expect(decision.statePatch.activeVehicleId).toBe(FULL_ID);
  });
});

describe("enforcement no core", () => {
  test("full preserva KM espontâneo, despesa e manutenção", () => {
    const full = vehicle(FULL_ID, "full");
    const km = decideConversation(input({ originalText: "km 12000", vehicles: [full] }));
    expect(km.nextState).toBe("awaiting_km_confirmation");
    expect(km.responseKey).toBe("km_update_confirmation");

    for (const text of ["gasolina R$ 80", "revisão R$ 300"]) {
      const expense = decideConversation(input({ originalText: text, vehicles: [full] }));
      expect(expense.nextState).toBe("awaiting_expense_confirmation");
      expect(expense.responseKey).toBe("expense_create_confirmation");
    }
  });

  test.each(["passive_with_km", "denied"] as const)(
    "%s bloqueia KM, despesa e manutenção",
    (mode) => {
      const restricted = vehicle(PASSIVE_ID, mode);
      for (const text of ["km 12000", "gasolina R$ 80", "revisão R$ 300"]) {
        expectRestricted(decideConversation(input({ originalText: text, vehicles: [restricted] })));
      }
    },
  );

  test("modo ausente ou inválido bloqueia fail-closed", () => {
    for (const mode of [undefined, "unexpected"]) {
      expectRestricted(
        decideConversation(
          input({
            originalText: "km 12000",
            vehicles: [runtimeModeVehicle(mode)],
          }),
        ),
      );
    }
  });

  test("vehicleId do draft ausente do contexto bloqueia handoff", () => {
    expectDraftInvalidated(
      decideConversation(
        input({
          sourceMessageId: MSG_B,
          originalText: "sim",
          state: kmConfirmationState(PASSIVE_ID),
          vehicles: [vehicle(FULL_ID, "full")],
        }),
      ),
    );
  });

  test("passive bloqueia awaiting_requested_km mesmo com flags system/requested_km", () => {
    const passive = vehicle(PASSIVE_ID, "passive_with_km");
    const requested = state({
      state: "awaiting_requested_km",
      currentIntent: "km_update",
      awaitingField: "requested_km",
      requestSource: "system",
      draftId: "33333333-3333-4333-8333-333333333333",
      activeVehicleId: PASSIVE_ID,
    });
    expectDraftInvalidated(
      decideConversation(
        input({
          sourceMessageId: MSG_B,
          originalText: "12000",
          state: requested,
          vehicles: [passive],
        }),
      ),
    );
  });

  test.each(["passive_with_km", "denied"] as const)(
    "draft de KM antigo não confirma/corrige após downgrade para %s",
    (mode) => {
      const restricted = vehicle(PASSIVE_ID, mode);
      for (const pendingState of [
        kmConfirmationState(PASSIVE_ID),
        { ...kmConfirmationState(PASSIVE_ID), state: "awaiting_km_correction" as const },
      ]) {
        expectDraftInvalidated(
          decideConversation(
            input({
              sourceMessageId: MSG_B,
              originalText: "sim",
              state: pendingState,
              vehicles: [restricted],
            }),
          ),
        );
      }
    },
  );

  test.each(["passive_with_km", "denied"] as const)(
    "draft de despesa/manutenção antigo e correção de categoria bloqueiam após downgrade para %s",
    (mode) => {
      const restricted = vehicle(PASSIVE_ID, mode);
      const pending = expenseConfirmationState(PASSIVE_ID);
      expectDraftInvalidated(
        decideConversation(
          input({
            sourceMessageId: MSG_B,
            originalText: "sim",
            state: pending,
            vehicles: [restricted],
          }),
        ),
      );
      const correction = decideConversation(
        input({
          sourceMessageId: MSG_B,
          originalText: "lavagem",
          state: pending,
          vehicles: [restricted],
        }),
      );
      expectDraftInvalidated(correction);
      expect(correction.decisionKind).not.toBe("confirm_expense_create");
    },
  );

  test("draft invalidado não volta a confirmar se o veículo retornar a full", () => {
    const pending = kmConfirmationState(PASSIVE_ID);
    const blocked = decideConversation(
      input({
        sourceMessageId: MSG_B,
        originalText: "sim",
        state: pending,
        vehicles: [vehicle(PASSIVE_ID, "passive_with_km")],
      }),
    );
    expectDraftInvalidated(blocked);
    const afterBlock = applyDecisionState(pending, blocked);
    const next = decideConversation(
      input({
        sourceMessageId: "33333333-3333-4333-8333-333333333333",
        originalText: "sim",
        state: afterBlock,
        vehicles: [vehicle(PASSIVE_ID, "full")],
      }),
    );
    expect(next.decisionKind).not.toBe("confirm_km_update");
    expect(next.responseKey).toBe("nothing_to_confirm");
  });

  test.each(["full", "passive_with_km", "denied"] as const)(
    "cancel e reset permanecem permitidos em %s",
    (mode) => {
      const current = vehicle(PASSIVE_ID, mode);
      const pending = state({ currentIntent: "km_update", activeVehicleId: PASSIVE_ID });
      expect(
        decideConversation(input({ originalText: "cancelar", state: pending, vehicles: [current] }))
          .responseKey,
      ).toBe("task_cancelled");
      expect(
        decideConversation(
          input({ originalText: "reiniciar conversa", state: pending, vehicles: [current] }),
        ).responseKey,
      ).toBe("conversation_reset");
    },
  );

  test.each([undefined, "unexpected"])("cancel/reset ignoram modo malformado (%s)", (mode) => {
    const current = runtimeModeVehicle(mode);
    const pending = state({ currentIntent: "km_update", activeVehicleId: current.id });
    expect(
      decideConversation(input({ originalText: "cancelar", state: pending, vehicles: [current] }))
        .responseKey,
    ).toBe("task_cancelled");
    expect(
      decideConversation(
        input({ originalText: "reiniciar conversa", state: pending, vehicles: [current] }),
      ).responseKey,
    ).toBe("conversation_reset");
  });

  test.each(["passive_with_km", "denied"] as const)(
    "greeting/help/fallback são limitados sem iniciar ação ou loop em %s",
    (mode) => {
      const restricted = vehicle(PASSIVE_ID, mode);
      for (const text of ["oi", "ajuda", "texto não reconhecido"]) {
        const decision = decideConversation(
          input({ originalText: text, vehicles: [restricted], fallbackCount: 2 }),
        );
        expectRestricted(decision);
        expect(decision.statePatch.draftPayload).toBeUndefined();
      }
    },
  );

  test.each(["passive_with_km", "denied"] as const)(
    "mídia não delega processamento premium em %s",
    (mode) => {
      const decision = decideConversation(
        input({
          messageType: "image",
          originalText: null,
          vehicles: [vehicle(PASSIVE_ID, mode)],
        }),
      );
      expectRestricted(decision);
      expect(decision.deferToLegacyRouter).toBe(false);
    },
  );

  describe("mídia com veículo focal ou frota ambígua", () => {
    const full = vehicle(FULL_ID, "full", "Argo");
    const passive = vehicle(PASSIVE_ID, "passive_with_km", "Polo");
    const denied = vehicle(DENIED_ID, "denied", "Onix");
    const media = (vehicles: ConversationVehicle[], currentState = state()) =>
      decideConversation(
        input({
          messageType: "image",
          originalText: null,
          state: currentState,
          vehicles,
        }),
      );

    test("full + passive sem focal bloqueia", () => {
      expectRestricted(media([full, passive]));
    });

    test("full + denied sem focal bloqueia", () => {
      expectRestricted(media([full, denied]));
    });

    test("dois full sem focal bloqueiam por ambiguidade", () => {
      expectRestricted(media([full, { ...full, id: PASSIVE_ID, model: "Polo" }]));
    });

    test("nenhum veículo elegível sem focal bloqueia", () => {
      expectRestricted(media([]));
    });

    test("único full preserva defer legado", () => {
      const decision = media([full]);
      expect(decision.decisionKind).toBe("defer_legacy_media");
      expect(decision.deferToLegacyRouter).toBe(true);
    });

    test("active full em frota mista preserva defer legado", () => {
      const decision = media([full, passive], state({ activeVehicleId: FULL_ID }));
      expect(decision.decisionKind).toBe("defer_legacy_media");
      expect(decision.deferToLegacyRouter).toBe(true);
    });

    test("active restrito em frota mista bloqueia", () => {
      expectRestricted(media([full, passive], state({ activeVehicleId: PASSIVE_ID })));
    });

    test("draft full em frota mista preserva nudge de confirmação", () => {
      const decision = media([full, passive], kmConfirmationState(FULL_ID));
      expect(decision.responseKey).toBe("media_unclear_during_confirmation");
      expect(decision.reasonCode).toBe("media_during_confirmation_nudge");
    });

    test("draft restrito em frota mista bloqueia e invalida draft", () => {
      expectDraftInvalidated(media([full, passive], kmConfirmationState(PASSIVE_ID)));
    });
  });
});
