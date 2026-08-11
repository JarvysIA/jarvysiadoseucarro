import { describe, expect, it } from "bun:test";
import {
  CONVERSATION_HANDOFF_CONTRACT_VERSION,
  validateConversationExecutionResult,
  validateConversationHandoffCommandV1,
  type ConversationExecutionResult,
  type ConversationHandoffCommandV1,
} from "../contract.ts";

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

const PRIMARY_COMMAND: ConversationHandoffCommandV1 = {
  version: CONVERSATION_HANDOFF_CONTRACT_VERSION,
  kind: "conversation",
  segment: "primary",
  contactId: CONTACT_ID,
  userId: USER_ID,
  vehicleId: VEHICLE_ID,
  sourceMessageId: SOURCE_MESSAGE_ID,
  originalText: "  Qual óleo devo usar?  ",
};

function commandWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...PRIMARY_COMMAND, ...overrides };
}

describe("ConversationHandoffCommandV1 — comando válido", () => {
  it("aceita segmentos primary e supplemental", () => {
    expect(validateConversationHandoffCommandV1(PRIMARY_COMMAND)).toEqual({
      ok: true,
      value: PRIMARY_COMMAND,
    });
    const supplemental = commandWith({ segment: "supplemental" });
    expect(validateConversationHandoffCommandV1(supplemental)).toEqual({
      ok: true,
      value: supplemental,
    });
  });

  it("preserva exatamente o texto original e aceita ausência explícita de veículo", () => {
    const input = commandWith({ vehicleId: null, originalText: "\n  Posso usar aditivada? \t" });
    const result = validateConversationHandoffCommandV1(input);
    expect(result).toEqual({ ok: true, value: input });
    if (result.ok) {
      expect(result.value.originalText).toBe("\n  Posso usar aditivada? \t");
      expect(result.value.vehicleId).toBeNull();
    }
  });

  it("é determinístico e não muta o objeto de entrada", () => {
    const input = commandWith();
    const before = structuredClone(input);
    expect(validateConversationHandoffCommandV1(input)).toEqual(
      validateConversationHandoffCommandV1(input),
    );
    expect(input).toEqual(before);
  });
});

describe("ConversationHandoffCommandV1 — discriminantes e campos", () => {
  it.each([
    ["versão undefined", { version: undefined }, "invalid_version"],
    ["versão incorreta", { version: "conversation.v2" }, "invalid_version"],
    ["kind incorreto", { kind: "expense" }, "invalid_kind"],
    ["kind quote", { kind: "quote" }, "invalid_kind"],
    ["kind undefined", { kind: undefined }, "invalid_kind"],
    ["kind com tipo incorreto", { kind: 1 }, "invalid_kind"],
    ["segmento incorreto", { segment: "secondary" }, "invalid_segment"],
    ["segmento ausente", { segment: undefined }, "invalid_segment"],
    ["texto com tipo incorreto", { originalText: 123 }, "invalid_original_text"],
    ["texto vazio", { originalText: "" }, "invalid_original_text"],
    ["texto whitespace", { originalText: " \n\t " }, "invalid_original_text"],
    ["contactId undefined", { contactId: undefined }, "invalid_contact_id"],
    ["contactId não UUID", { contactId: "contact-123" }, "invalid_contact_id"],
    ["userId undefined", { userId: undefined }, "invalid_user_id"],
    ["userId não UUID", { userId: "user-123" }, "invalid_user_id"],
    ["userId com tipo incorreto", { userId: 123 }, "invalid_user_id"],
    ["vehicleId undefined", { vehicleId: undefined }, "invalid_vehicle_id"],
    ["vehicleId vazio", { vehicleId: "" }, "invalid_vehicle_id"],
    ["vehicleId com tipo incorreto", { vehicleId: 123 }, "invalid_vehicle_id"],
    ["sourceMessageId inválido", { sourceMessageId: "message-1" }, "invalid_source_message_id"],
  ])("rejeita %s", (_label, override, code) => {
    expect(validateConversationHandoffCommandV1(commandWith(override))).toEqual({
      ok: false,
      code,
    });
  });

  it("rejeita campo obrigatório realmente removido", () => {
    for (const field of [
      "version",
      "kind",
      "segment",
      "contactId",
      "userId",
      "vehicleId",
      "sourceMessageId",
      "originalText",
    ] as const) {
      const input = commandWith();
      delete input[field];
      expect(validateConversationHandoffCommandV1(input)).toEqual({
        ok: false,
        code: "missing_field",
      });
    }
  });

  it("rejeita não objetos", () => {
    for (const input of [null, undefined, "conversation", [], 1]) {
      expect(validateConversationHandoffCommandV1(input)).toEqual({
        ok: false,
        code: "not_an_object",
      });
    }
  });
});

describe("ConversationHandoffCommandV1 — allowlist estrita", () => {
  it.each([
    "category",
    "amount",
    "draftId",
    "kmRequest",
    "confirmation",
    "maintenanceTags",
    "persistable",
    "serviceCompleted",
    "accessModeSnapshot",
    "accessMode",
    "queueItemId",
    "expectedStateVersion",
    "leaseToken",
    "idempotencyKey",
  ])("rejeita a propriedade proibida %s", (field) => {
    expect(validateConversationHandoffCommandV1(commandWith({ [field]: "forbidden" }))).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("rejeita qualquer outra propriedade desconhecida", () => {
    expect(validateConversationHandoffCommandV1(commandWith({ locale: "pt-BR" }))).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("rejeita amount próprio não enumerável", () => {
    const input = commandWith();
    Object.defineProperty(input, "amount", {
      value: 250.75,
      enumerable: false,
    });

    expect(validateConversationHandoffCommandV1(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("rejeita accessMode próprio não enumerável", () => {
    const input = commandWith();
    Object.defineProperty(input, "accessMode", {
      value: "write",
      enumerable: false,
    });

    expect(validateConversationHandoffCommandV1(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("rejeita chave Symbol própria", () => {
    const input = commandWith();
    Reflect.set(input, Symbol("forbidden"), true);

    expect(validateConversationHandoffCommandV1(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("não muta own keys, propriedades não enumeráveis, Symbols nem descriptors", () => {
    const input = commandWith();
    const forbidden = Symbol("forbidden");
    Object.defineProperty(input, "amount", {
      value: 250.75,
      enumerable: false,
      configurable: true,
      writable: false,
    });
    Reflect.set(input, forbidden, true);
    const ownKeysBefore = Reflect.ownKeys(input);
    const amountDescriptorBefore = Object.getOwnPropertyDescriptor(input, "amount");
    const symbolDescriptorBefore = Object.getOwnPropertyDescriptor(input, forbidden);

    expect(validateConversationHandoffCommandV1(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
    expect(Reflect.ownKeys(input)).toEqual(ownKeysBefore);
    expect(Object.getOwnPropertyDescriptor(input, "amount")).toEqual(amountDescriptorBefore);
    expect(Object.getOwnPropertyDescriptor(input, forbidden)).toEqual(symbolDescriptorBefore);
    expect(Reflect.has(input, "amount")).toBe(true);
    expect(Reflect.has(input, forbidden)).toBe(true);
  });
});

describe("ConversationExecutionResult — união fechada", () => {
  const validResults: readonly ConversationExecutionResult[] = [
    { status: "success", responseText: "Consulte a especificação no manual." },
    { status: "blocked", reason: "authorization_required" },
    { status: "blocked", reason: "vehicle_required" },
    { status: "transient_failure", reason: "temporarily_unavailable" },
    { status: "permanent_failure", reason: "invalid_request" },
    { status: "permanent_failure", reason: "unsupported_request" },
  ];

  it("aceita sucesso, bloqueio e falhas transitória e permanente", () => {
    for (const result of validResults) {
      expect(validateConversationExecutionResult(result)).toEqual({ ok: true, value: result });
    }
  });

  it.each([
    [{ status: "success", responseText: "  " }, "invalid_response_text"],
    [{ status: "unknown", reason: "temporarily_unavailable" }, "invalid_status"],
    [{ status: "blocked", reason: "temporarily_unavailable" }, "invalid_reason"],
    [{ status: "transient_failure", reason: "invalid_request" }, "invalid_reason"],
    [{ status: "permanent_failure", reason: "temporarily_unavailable" }, "invalid_reason"],
    [
      { status: "blocked", reason: "vehicle_required", responseText: "não permitido" },
      "unexpected_field",
    ],
    [{ status: "success", responseText: "ok", reason: "vehicle_required" }, "unexpected_field"],
  ])("rejeita combinação inválida %#", (input, code) => {
    expect(validateConversationExecutionResult(input)).toEqual({ ok: false, code });
  });

  it("rejeita resultado incompleto", () => {
    expect(validateConversationExecutionResult({ status: "blocked" })).toEqual({
      ok: false,
      code: "missing_field",
    });
  });

  it.each([
    { status: "success", responseText: "Tudo certo.", amount: 250.75 },
    { status: "blocked", reason: "vehicle_required", accessMode: "write" },
  ])("rejeita propriedade financeira ou operacional enumerável %#", (input) => {
    expect(validateConversationExecutionResult(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("rejeita amount próprio não enumerável em success", () => {
    const input = { status: "success", responseText: "Tudo certo." };
    Object.defineProperty(input, "amount", {
      value: 250.75,
      enumerable: false,
    });

    expect(validateConversationExecutionResult(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("rejeita accessMode próprio não enumerável em resultado blocked", () => {
    const input = { status: "blocked", reason: "vehicle_required" };
    Object.defineProperty(input, "accessMode", {
      value: "write",
      enumerable: false,
    });

    expect(validateConversationExecutionResult(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("rejeita chave Symbol própria em resultado", () => {
    const input = { status: "success", responseText: "Tudo certo." };
    Reflect.set(input, Symbol("forbidden"), true);

    expect(validateConversationExecutionResult(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });
});
