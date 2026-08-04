import { describe, expect, test } from "bun:test";
import { decideConversation } from "../core.ts";
import type { ConversationCoreInput, ConversationState, ConversationVehicle } from "../types.ts";

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

function veh(id: string, brand: string, model: string, plate: string): ConversationVehicle {
  return {
    id,
    brand,
    model,
    plate,
    isArchived: false,
    isEligible: true,
    kmAtual: null,
    whatsappAccessMode: "full",
    optionalLabel: null,
  };
}

function inp(overrides: Partial<ConversationCoreInput> = {}): ConversationCoreInput {
  return {
    sourceMessageId: "msg-1",
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

describe("core — validation & replay", () => {
  test("missing sourceMessageId → no_op", () => {
    const d = decideConversation(inp({ sourceMessageId: "" }));
    expect(d.decisionKind).toBe("no_op");
    expect(d.reasonCode).toContain("invalid_input");
  });

  test("isReplay → no_op", () => {
    const d = decideConversation(inp({ isReplay: true, originalText: "oi" }));
    expect(d.decisionKind).toBe("no_op");
    expect(d.eventKind).toBe("replay");
    expect(d.responseKey).toBeNull();
  });
});

describe("core — media", () => {
  test("image defers to legacy without writing lastMessageId", () => {
    const d = decideConversation(
      inp({
        messageType: "image",
        originalText: null,
        vehicles: [veh("v1", "Fiat", "Argo", "ABC1D23")],
      }),
    );
    expect(d.decisionKind).toBe("defer_legacy_media");
    expect(d.deferToLegacyRouter).toBe(true);
    expect(d.responseKey).toBeNull();
    expect(d.statePatch.lastMessageId).toBeUndefined();
  });
});

describe("core — explicit opt-out", () => {
  test("SAIR defers to legacy opt-out", () => {
    const d = decideConversation(inp({ originalText: "SAIR" }));
    expect(d.decisionKind).toBe("defer_legacy_opt_out");
    expect(d.deferToLegacyOptOut).toBe(true);
  });

  test("cancelar isolado NÃO é opt-out (é cancel_task)", () => {
    const d = decideConversation(inp({ originalText: "cancelar" }));
    expect(d.deferToLegacyOptOut).toBe(false);
    expect(d.eventKind).toBe("cancel_task");
  });
});

describe("core — cancel / reset", () => {
  test("cancelar sem pendência → nothing_to_cancel", () => {
    const d = decideConversation(inp({ originalText: "cancela" }));
    expect(d.responseKey).toBe("nothing_to_cancel");
    expect(d.nextState).toBe("idle");
    expect(d.outcome).toBe("none");
  });

  test("cancelar durante awaiting_vehicle → reset_task", () => {
    const d = decideConversation(
      inp({
        originalText: "cancela",
        state: state({ state: "awaiting_vehicle", currentIntent: "select_vehicle" }),
      }),
    );
    expect(d.decisionKind).toBe("reset_task");
    expect(d.outcome).toBe("cancelled");
    expect(d.nextState).toBe("idle");
    expect(d.statePatch.state).toBe("idle");
    expect(d.statePatch.currentIntent).toBeNull();
  });

  test("recomeçar → reset_conversation limpa activeVehicleId", () => {
    const d = decideConversation(
      inp({
        originalText: "recomeçar",
        state: state({ activeVehicleId: "veh-1" }),
      }),
    );
    expect(d.decisionKind).toBe("reset_conversation");
    expect(d.statePatch.activeVehicleId).toBeNull();
  });
});

describe("core — confirm / deny sem pendência", () => {
  test("sim → nothing_to_confirm", () => {
    const d = decideConversation(inp({ originalText: "sim" }));
    expect(d.responseKey).toBe("nothing_to_confirm");
    expect(d.decisionKind).toBe("respond");
  });
  test("não → nothing_to_confirm", () => {
    const d = decideConversation(inp({ originalText: "não" }));
    expect(d.responseKey).toBe("nothing_to_confirm");
    expect(d.eventKind).toBe("deny");
  });
});

describe("core — help / greeting", () => {
  test("ajuda", () => {
    const d = decideConversation(inp({ originalText: "ajuda" }));
    expect(d.responseKey).toBe("help");
  });
  test("? isolado", () => {
    const d = decideConversation(inp({ originalText: "?" }));
    expect(d.eventKind).toBe("help");
  });
  test("oi NÃO pergunta veículo", () => {
    const d = decideConversation(inp({ originalText: "oi" }));
    expect(d.responseKey).toBe("greeting");
    expect(d.nextState).toBe("idle");
    expect(d.statePatch.state).toBeUndefined();
  });
});

describe("core — awaiting_vehicle", () => {
  const veiculos = [
    veh("v1", "Fiat", "Argo", "ABC1D23"),
    veh("v2", "Chevrolet", "Onix", "XYZ4E56"),
  ];

  test("match único", () => {
    const d = decideConversation(
      inp({
        originalText: "onix",
        vehicles: veiculos,
        state: state({ state: "awaiting_vehicle" }),
      }),
    );
    expect(d.decisionKind).toBe("select_vehicle");
    expect(d.outcome).toBe("completed");
    expect(d.nextState).toBe("idle");
    expect(d.statePatch.activeVehicleId).toBe("v2");
    expect(d.responseKey).toBe("vehicle_selected");
  });

  test("ambíguo mantém awaiting_vehicle", () => {
    const d = decideConversation(
      inp({
        originalText: "argo",
        vehicles: [veh("v1", "Fiat", "Argo", "ABC1D23"), veh("v3", "Fiat", "Argo", "QWE1D23")],
        state: state({ state: "awaiting_vehicle" }),
      }),
    );
    expect(d.responseKey).toBe("vehicle_ambiguous");
    expect(d.nextState).toBe("awaiting_vehicle");
    expect(d.statePatch.state).toBeUndefined();
  });

  test("not found mantém awaiting_vehicle", () => {
    const d = decideConversation(
      inp({
        originalText: "corolla",
        vehicles: veiculos,
        state: state({ state: "awaiting_vehicle" }),
      }),
    );
    expect(d.responseKey).toBe("vehicle_not_found");
    expect(d.nextState).toBe("awaiting_vehicle");
  });

  test("sem elegíveis fecha a tarefa", () => {
    const d = decideConversation(
      inp({
        originalText: "argo",
        vehicles: [],
        state: state({ state: "awaiting_vehicle" }),
      }),
    );
    expect(d.responseKey).toBe("no_eligible_vehicle");
    expect(d.nextState).toBe("idle");
  });

  test("cancelamento tem precedência sobre resolver de veículo", () => {
    const d = decideConversation(
      inp({
        originalText: "cancela",
        vehicles: veiculos,
        state: state({ state: "awaiting_vehicle" }),
      }),
    );
    expect(d.decisionKind).toBe("reset_task");
  });
});

describe("core — fallback progressivo", () => {
  test("1ª falha", () => {
    const d = decideConversation(inp({ originalText: "asdfghjk", fallbackCount: 0 }));
    expect(d.responseKey).toBe("fallback_first");
    expect(d.nextFallbackCount).toBe(1);
  });
  test("2ª falha", () => {
    const d = decideConversation(inp({ originalText: "asdfghjk", fallbackCount: 1 }));
    expect(d.responseKey).toBe("fallback_second");
    expect(d.nextFallbackCount).toBe(2);
  });
  test("3ª falha reseta", () => {
    const d = decideConversation(inp({ originalText: "asdfghjk", fallbackCount: 2 }));
    expect(d.responseKey).toBe("fallback_reset");
    expect(d.nextFallbackCount).toBe(0);
    expect(d.nextState).toBe("idle");
    expect(d.outcome).toBe("cancelled");
  });
});

describe("core — expiração", () => {
  const past = "2026-07-11T11:00:00.000Z";
  const now = "2026-07-11T12:00:00.000Z";

  test("expirado + sim → não confirma, apenas informa", () => {
    const d = decideConversation(
      inp({
        originalText: "sim",
        now,
        state: state({
          state: "awaiting_vehicle",
          currentIntent: "select_vehicle",
          expiresAt: past,
          activeVehicleId: "v-keep",
        }),
        vehicles: [veh("v-keep", "Fiat", "Argo", "ABC1D23")],
      }),
    );
    expect(d.responseKey).toBe("nothing_to_confirm");
    expect(d.statePatch.state).toBe("idle");
    expect(d.statePatch.currentIntent).toBeNull();
    // activeVehicleId preservado (não incluído no patch)
    expect(d.statePatch.activeVehicleId).toBeUndefined();
    expect(d.outcome).toBe("expired");
  });

  test("expirado + mídia → defer, mas patch reseta task", () => {
    const d = decideConversation(
      inp({
        messageType: "image",
        originalText: null,
        now,
        state: state({ state: "awaiting_vehicle", expiresAt: past }),
        vehicles: [veh("v1", "Fiat", "Argo", "ABC1D23")],
      }),
    );
    expect(d.decisionKind).toBe("defer_legacy_media");
    expect(d.statePatch.state).toBe("idle");
  });
});

describe("core — lastMessageId idempotência", () => {
  test("respostas gravam lastMessageId", () => {
    const d = decideConversation(inp({ originalText: "oi", sourceMessageId: "MID-42" }));
    expect(d.statePatch.lastMessageId).toBe("MID-42");
  });
  test("defer NÃO grava lastMessageId", () => {
    const d = decideConversation(inp({ originalText: "SAIR", sourceMessageId: "MID-42" }));
    expect(d.statePatch.lastMessageId).toBeUndefined();
  });
});
