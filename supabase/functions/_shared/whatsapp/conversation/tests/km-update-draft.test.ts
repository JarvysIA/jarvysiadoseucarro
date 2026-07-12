// Build 5.7F2E1A.5-MB — Testes puros dos contratos e validators de drafts de KM.
import { describe, expect, it } from "bun:test";
import {
  KM_UPDATE_COMPLETE_DRAFT_VERSION,
  KM_UPDATE_PARTIAL_DRAFT_VERSION,
  validateAwaitingConfirmationKmUpdateDraft,
  validateAwaitingVehicleKmUpdateDraft,
  validateKmUpdateDraft,
} from "../km-update-draft.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_V1 = "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa";

function freeze<T>(o: T): T {
  return Object.freeze(o) as T;
}

describe("constantes de versão", () => {
  it("expõe versões corretas e não conflitantes", () => {
    expect(KM_UPDATE_PARTIAL_DRAFT_VERSION).toBe(0);
    expect(KM_UPDATE_COMPLETE_DRAFT_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Draft parcial
// ---------------------------------------------------------------------------

describe("validateAwaitingVehicleKmUpdateDraft", () => {
  it("aceita objeto válido com newKm 0", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: 0,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.phase).toBe("awaiting_vehicle");
      expect(r.value.newKm).toBe(0);
      expect(r.value.requestMessageId).toBe(UUID_A);
    }
  });

  it("aceita KM positivo", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: 12345,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
  });

  it("aceita 2147483647 (limite)", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: 2147483647,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
  });

  it("preserva UUID como recebido", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: 1,
      requestMessageId: UUID_V1,
    });
    expect(r.ok && r.value.requestMessageId).toBe(UUID_V1);
  });

  it.each([[null], [[]], ["x"], [1], [true], [new Date()]])(
    "rejeita não-objeto: %p",
    (v) => {
      const r = validateAwaitingVehicleKmUpdateDraft(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("not_an_object");
    },
  );

  it("rejeita phase ausente", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      newKm: 1,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });

  it("rejeita phase inválido", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "other",
      newKm: 1,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_phase");
  });

  it("rejeita newKm ausente", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });

  it.each([
    ["undefined", undefined, "missing_field"],
    ["string", "1", "invalid_new_km"],
    ["decimal", 1.5, "invalid_new_km"],
    ["negative", -1, "invalid_new_km"],
    ["overflow", 2147483648, "invalid_new_km"],
    ["NaN", Number.NaN, "invalid_new_km"],
    ["Infinity", Infinity, "invalid_new_km"],
    ["-Infinity", -Infinity, "invalid_new_km"],
    ["boolean", true, "invalid_new_km"],
  ])("rejeita newKm %s", (_label, val, code) => {
    const input: Record<string, unknown> = {
      phase: "awaiting_vehicle",
      requestMessageId: UUID_A,
    };
    if (val !== undefined) input.newKm = val;
    else input.newKm = undefined;
    // simular undefined vs ausente
    if (val === undefined) delete input.newKm;
    const r = validateAwaitingVehicleKmUpdateDraft(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code as string);
  });

  it("rejeita newKm undefined explícito como missing_field (ausência de propriedade própria não aplicável)", () => {
    // property present but undefined => still triggers invalid_new_km via type check
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: undefined,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_new_km");
  });

  it("rejeita requestMessageId ausente", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });

  it("rejeita requestMessageId undefined explícito", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: 1,
      requestMessageId: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_request_message_id");
  });

  it("rejeita requestMessageId inválido", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: 1,
      requestMessageId: "not-a-uuid",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_request_message_id");
  });

  it("rejeita requestMessageId com espaços", () => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: 1,
      requestMessageId: ` ${UUID_A} `,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_request_message_id");
  });

  it.each([
    ["vehicleId", { vehicleId: UUID_B }],
    ["expectedPreviousKm", { expectedPreviousKm: 5 }],
    ["isCorrection", { isCorrection: false }],
    ["arbitrary", { foo: "bar" }],
  ])("rejeita campo extra %s", (_label, extra) => {
    const r = validateAwaitingVehicleKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: 1,
      requestMessageId: UUID_A,
      ...(extra as object),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unexpected_field");
  });

  it("não modifica o input", () => {
    const input = freeze({
      phase: "awaiting_vehicle" as const,
      newKm: 42,
      requestMessageId: UUID_A,
    });
    const snap = JSON.stringify(input);
    validateAwaitingVehicleKmUpdateDraft(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// Draft completo
// ---------------------------------------------------------------------------

function completeBase() {
  return {
    phase: "awaiting_confirmation" as const,
    vehicleId: UUID_B,
    expectedPreviousKm: null as number | null,
    newKm: 0,
    requestMessageId: UUID_A,
    isCorrection: false,
  };
}

describe("validateAwaitingConfirmationKmUpdateDraft", () => {
  it("aceita expectedPreviousKm null com newKm 0 e isCorrection false", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft(completeBase());
    expect(r.ok).toBe(true);
  });

  it("aceita aumento (isCorrection false)", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      expectedPreviousKm: 100,
      newKm: 200,
    });
    expect(r.ok).toBe(true);
  });

  it("aceita igualdade (isCorrection false)", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      expectedPreviousKm: 100,
      newKm: 100,
    });
    expect(r.ok).toBe(true);
  });

  it("aceita redução com isCorrection true", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      expectedPreviousKm: 500,
      newKm: 300,
      isCorrection: true,
    });
    expect(r.ok).toBe(true);
  });

  it("aceita limite 2147483647", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      expectedPreviousKm: 2147483646,
      newKm: 2147483647,
    });
    expect(r.ok).toBe(true);
  });

  it("preserva UUIDs recebidos", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft(completeBase());
    if (r.ok) {
      expect(r.value.vehicleId).toBe(UUID_B);
      expect(r.value.requestMessageId).toBe(UUID_A);
    }
  });

  const REQUIRED = [
    "phase",
    "vehicleId",
    "expectedPreviousKm",
    "newKm",
    "requestMessageId",
    "isCorrection",
  ] as const;

  it.each(REQUIRED)("rejeita campo obrigatório ausente: %s", (field) => {
    const input = { ...completeBase() } as Record<string, unknown>;
    delete input[field];
    const r = validateAwaitingConfirmationKmUpdateDraft(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });

  it.each(REQUIRED)("rejeita campo obrigatório undefined: %s", (field) => {
    const input = { ...completeBase() } as Record<string, unknown>;
    input[field] = undefined;
    const r = validateAwaitingConfirmationKmUpdateDraft(input);
    expect(r.ok).toBe(false);
    // undefined é presente => cai em validação de tipo do campo, não missing_field
    if (!r.ok) {
      expect(r.code).not.toBe("missing_field");
    }
  });

  it("rejeita vehicleId inválido", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      vehicleId: "bad",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_vehicle_id");
  });

  it("rejeita requestMessageId inválido", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      requestMessageId: "bad",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_request_message_id");
  });

  it.each([
    ["string", "1"],
    ["decimal", 1.5],
    ["negative", -1],
    ["overflow", 2147483648],
  ])("rejeita expectedPreviousKm %s", (_l, v) => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      expectedPreviousKm: v as number,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_expected_previous_km");
  });

  it("rejeita newKm inválido", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      newKm: -1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_new_km");
  });

  it("rejeita isCorrection não boolean", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      isCorrection: "false" as unknown as boolean,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_is_correction");
  });

  it("rejeita null com isCorrection true", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      expectedPreviousKm: null,
      isCorrection: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("inconsistent_is_correction");
  });

  it("rejeita aumento com isCorrection true", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      expectedPreviousKm: 100,
      newKm: 200,
      isCorrection: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("inconsistent_is_correction");
  });

  it("rejeita igualdade com isCorrection true", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      expectedPreviousKm: 100,
      newKm: 100,
      isCorrection: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("inconsistent_is_correction");
  });

  it("rejeita redução com isCorrection false", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      expectedPreviousKm: 500,
      newKm: 100,
      isCorrection: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("inconsistent_is_correction");
  });

  it("rejeita campo extra", () => {
    const r = validateAwaitingConfirmationKmUpdateDraft({
      ...completeBase(),
      extra: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unexpected_field");
  });

  it("rejeita objeto híbrido (mistura de campos das duas phases)", () => {
    const hybrid = {
      phase: "awaiting_vehicle",
      vehicleId: UUID_B,
      expectedPreviousKm: null,
      newKm: 1,
      requestMessageId: UUID_A,
      isCorrection: false,
    };
    const rp = validateAwaitingVehicleKmUpdateDraft(hybrid);
    expect(rp.ok).toBe(false);
    if (!rp.ok) expect(rp.code).toBe("unexpected_field");

    const hybrid2 = {
      phase: "awaiting_confirmation",
      newKm: 1,
      requestMessageId: UUID_A,
    };
    const rc = validateAwaitingConfirmationKmUpdateDraft(hybrid2);
    expect(rc.ok).toBe(false);
    if (!rc.ok) expect(rc.code).toBe("missing_field");
  });

  it("não modifica o input", () => {
    const input = { ...completeBase() };
    const snap = JSON.stringify(input);
    validateAwaitingConfirmationKmUpdateDraft(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// União
// ---------------------------------------------------------------------------

describe("validateKmUpdateDraft (união)", () => {
  it("encaminha awaiting_vehicle", () => {
    const r = validateKmUpdateDraft({
      phase: "awaiting_vehicle",
      newKm: 1,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.phase).toBe("awaiting_vehicle");
  });

  it("encaminha awaiting_confirmation", () => {
    const r = validateKmUpdateDraft(completeBase());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.phase).toBe("awaiting_confirmation");
  });

  it("rejeita phase desconhecido", () => {
    const r = validateKmUpdateDraft({ phase: "other" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_phase");
  });

  it("rejeita phase undefined", () => {
    const r = validateKmUpdateDraft({ phase: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_phase");
  });

  it("rejeita objeto sem phase", () => {
    const r = validateKmUpdateDraft({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_phase");
  });

  it("resultado ok preserva o discriminado", () => {
    const r = validateKmUpdateDraft(completeBase());
    if (r.ok && r.value.phase === "awaiting_confirmation") {
      // acesso type-safe ao vehicleId
      expect(typeof r.value.vehicleId).toBe("string");
    } else {
      throw new Error("expected awaiting_confirmation");
    }
  });

  it("erro contém apenas code fechado, sem valor recebido", () => {
    const r = validateKmUpdateDraft({ phase: "bogus", secret: "leak" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r).sort()).toEqual(["code", "ok"]);
    }
  });

  it("não lança para input arbitrário", () => {
    const inputs: unknown[] = [
      null,
      undefined,
      0,
      "",
      [],
      new Date(),
      () => 0,
      Symbol("x"),
    ];
    for (const i of inputs) {
      expect(() => validateKmUpdateDraft(i)).not.toThrow();
    }
  });

  it("determinístico: mesmo input → mesmo resultado", () => {
    const input = completeBase();
    const r1 = validateKmUpdateDraft(input);
    const r2 = validateKmUpdateDraft(input);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
