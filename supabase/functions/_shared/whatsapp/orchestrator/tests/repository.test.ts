// Build 5.7F2E1A.5-HARD-TEST — Cobertura de serializePatch/mapStateRow.
// Runner: bun test. Sem rede, sem banco.

import { describe, expect, test } from "bun:test";
import { mapStateRow, serializePatch } from "../repository.ts";
import { MalformedResponseError, RepositoryError } from "../errors.ts";
import type {
  ConversationStateName,
  ConversationStatePatch,
} from "../../conversation/types.ts";

// ============================================================
// serializePatch — lastMessageId
// ============================================================

describe("serializePatch — lastMessageId", () => {
  test("1. state + lastMessageId → não lança e não emite last_message_id", () => {
    const out = serializePatch({
      state: "idle",
      lastMessageId: "11111111-1111-1111-1111-111111111111",
    });
    expect(out.next_state).toBe("idle");
    expect(Object.prototype.hasOwnProperty.call(out, "last_message_id")).toBe(
      false,
    );
    expect("last_message_id" in out).toBe(false);
  });

  test("2. state sem lastMessageId → regressão { next_state: 'idle' }", () => {
    const out = serializePatch({ state: "idle" });
    expect(out).toEqual({ next_state: "idle" });
  });

  test("3. state + draftId + draftType → mapeados corretamente", () => {
    const out = serializePatch({
      state: "awaiting_km_confirmation",
      draftId: "22222222-2222-2222-2222-222222222222",
      draftType: "km_update",
    });
    expect(out.next_state).toBe("awaiting_km_confirmation");
    expect(out.draft_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(out.draft_type).toBe("km_update");
  });

  test("4. draftPayload: null → mantém null explícito (limpa campo)", () => {
    const out = serializePatch({ state: "idle", draftPayload: null });
    expect(Object.prototype.hasOwnProperty.call(out, "draft_payload")).toBe(
      true,
    );
    expect(out.draft_payload).toBeNull();
  });
});

// ============================================================
// serializePatch — validações que continuam lançando
// ============================================================

describe("serializePatch — validações defensivas", () => {
  test("5. sem chave state → RepositoryError", () => {
    expect(() =>
      serializePatch({} as unknown as ConversationStatePatch),
    ).toThrow(RepositoryError);
  });

  test("6. state: null → RepositoryError", () => {
    expect(() =>
      serializePatch({
        state: null,
      } as unknown as ConversationStatePatch),
    ).toThrow(RepositoryError);
  });

  test("7. chave desconhecida (não lastMessageId) → RepositoryError", () => {
    expect(() =>
      serializePatch({
        state: "idle",
        chaveInexistente: "x",
      } as unknown as ConversationStatePatch),
    ).toThrow(RepositoryError);
  });
});

// ============================================================
// mapStateRow — VALID_STATE_NAMES
// ============================================================

function baseRow(state: string): Record<string, unknown> {
  return {
    state,
    current_intent: null,
    awaiting_field: null,
    request_source: null,
    draft_type: null,
    draft_id: null,
    draft_version: null,
    draft_payload: null,
    active_vehicle_id: null,
    confirmed_at: null,
    executed_at: null,
    expires_at: null,
    last_message_id: null,
  };
}

const ALL_STATES: readonly ConversationStateName[] = [
  "idle",
  "awaiting_vehicle",
  "awaiting_km_confirmation",
  "awaiting_km_correction",
  "awaiting_requested_km",
  "awaiting_expense_category",
  "awaiting_expense_confirmation",
  "awaiting_expense_correction",
  "completed",
  "cancelled",
  "expired",
  "failed",
];

describe("mapStateRow — VALID_STATE_NAMES", () => {
  for (const s of ALL_STATES) {
    test(`8. state=${s} → não lança e preserva valor`, () => {
      const out = mapStateRow(baseRow(s));
      expect(out.state).toBe(s);
    });
  }

  test("9. state desconhecido → MalformedResponseError", () => {
    expect(() => mapStateRow(baseRow("nao_existe_esse_estado"))).toThrow(
      MalformedResponseError,
    );
  });

  test("10. row populada → mapeamento camelCase + Number(draftVersion) preservado", () => {
    const row: Record<string, unknown> = {
      state: "awaiting_km_confirmation",
      current_intent: "km_update",
      awaiting_field: "km",
      request_source: "whatsapp",
      draft_type: "km_update",
      draft_id: "33333333-3333-3333-3333-333333333333",
      draft_version: "2",
      draft_payload: { newKm: 12345 },
      active_vehicle_id: "44444444-4444-4444-4444-444444444444",
      confirmed_at: "2026-07-17T00:00:00Z",
      executed_at: null,
      expires_at: "2026-07-17T01:00:00Z",
      last_message_id: "55555555-5555-5555-5555-555555555555",
    };
    const out = mapStateRow(row);
    expect(out.state).toBe("awaiting_km_confirmation");
    expect(out.currentIntent).toBe("km_update");
    expect(out.awaitingField).toBe("km");
    expect(out.requestSource).toBe("whatsapp");
    expect(out.draftType).toBe("km_update");
    expect(out.draftId).toBe("33333333-3333-3333-3333-333333333333");
    expect(out.draftVersion).toBe(2);
    expect(out.draftPayload).toEqual({ newKm: 12345 });
    expect(out.activeVehicleId).toBe("44444444-4444-4444-4444-444444444444");
    expect(out.confirmedAt).toBe("2026-07-17T00:00:00Z");
    expect(out.executedAt).toBeNull();
    expect(out.expiresAt).toBe("2026-07-17T01:00:00Z");
    expect(out.lastMessageId).toBe("55555555-5555-5555-5555-555555555555");
  });
});
