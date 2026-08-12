import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  CONVERSATION_HANDOFF_CONTRACT_VERSION,
  type ConversationExecutionResult,
} from "../contract.ts";
import {
  validateConversationHandoffExecutionCommandV1,
  validateConversationHandoffExecutionResultV1,
  type ConversationHandoffExecutionCommandV1,
  type ConversationHandoffPrimaryCommandV1,
  type ConversationHandoffSupplementalCommandV1,
} from "../execution-contract.ts";

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VEHICLE_ID = "99999999-9999-4999-8999-999999999999";
const SOURCE_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_SOURCE_MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_CONTACT_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_USER_ID = "77777777-7777-4777-8777-777777777777";

const PRIMARY_COMMAND: ConversationHandoffPrimaryCommandV1 = {
  version: CONVERSATION_HANDOFF_CONTRACT_VERSION,
  kind: "conversation",
  segment: "primary",
  contactId: CONTACT_ID,
  userId: USER_ID,
  vehicleId: VEHICLE_ID,
  sourceMessageId: SOURCE_MESSAGE_ID,
  originalText: "Qual óleo devo usar?",
};

const SUPPLEMENTAL_COMMAND: ConversationHandoffSupplementalCommandV1 = {
  ...PRIMARY_COMMAND,
  segment: "supplemental",
};

function primaryWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...PRIMARY_COMMAND, ...overrides };
}

function supplementalWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...SUPPLEMENTAL_COMMAND, ...overrides };
}

const AGGREGATE_WITH_SUPPLEMENTAL: ConversationHandoffExecutionCommandV1 = {
  primary: PRIMARY_COMMAND,
  supplemental: SUPPLEMENTAL_COMMAND,
};

const AGGREGATE_WITHOUT_SUPPLEMENTAL: ConversationHandoffExecutionCommandV1 = {
  primary: PRIMARY_COMMAND,
};

const SUCCESS_RESULT: ConversationExecutionResult = {
  status: "success",
  responseText: "Consulte o manual do fabricante.",
};

const OTHER_SUCCESS_RESULT: ConversationExecutionResult = {
  status: "success",
  responseText: "Registro concluído.",
};

const BLOCKED_RESULT: ConversationExecutionResult = {
  status: "blocked",
  reason: "authorization_required",
};

const TRANSIENT_FAILURE_RESULT: ConversationExecutionResult = {
  status: "transient_failure",
  reason: "temporarily_unavailable",
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value as object)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe("Bloco A — comando agregado: aceitação", () => {
  it("1. aceita primary válido sem supplemental", () => {
    expect(validateConversationHandoffExecutionCommandV1({ primary: PRIMARY_COMMAND })).toEqual({
      ok: true,
      value: { primary: PRIMARY_COMMAND },
    });
  });

  it("2. aceita primary e supplemental válidos e correlacionados", () => {
    expect(validateConversationHandoffExecutionCommandV1(AGGREGATE_WITH_SUPPLEMENTAL)).toEqual({
      ok: true,
      value: AGGREGATE_WITH_SUPPLEMENTAL,
    });
  });

  it("3. preserva sourceMessageId idêntico nos dois segmentos", () => {
    const result = validateConversationHandoffExecutionCommandV1(AGGREGATE_WITH_SUPPLEMENTAL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.primary.sourceMessageId).toBe(SOURCE_MESSAGE_ID);
      expect(result.value.supplemental?.sourceMessageId).toBe(SOURCE_MESSAGE_ID);
    }
  });

  it("4. preserva vehicleId (uuid) idêntico nos dois segmentos", () => {
    const result = validateConversationHandoffExecutionCommandV1(AGGREGATE_WITH_SUPPLEMENTAL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.primary.vehicleId).toBe(VEHICLE_ID);
      expect(result.value.supplemental?.vehicleId).toBe(VEHICLE_ID);
    }
  });

  it("5. preserva vehicleId null nos dois segmentos", () => {
    const input = {
      primary: primaryWith({ vehicleId: null }),
      supplemental: supplementalWith({ vehicleId: null }),
    };
    const result = validateConversationHandoffExecutionCommandV1(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.primary.vehicleId).toBeNull();
      expect(result.value.supplemental?.vehicleId).toBeNull();
    }
  });

  it("6. preserva originalText byte a byte, incluindo whitespace e Unicode", () => {
    const text = "  Óleo 5W-30 tá ok? \n\t";
    const input = {
      primary: primaryWith({ originalText: text }),
      supplemental: supplementalWith({ originalText: text }),
    };
    const result = validateConversationHandoffExecutionCommandV1(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.primary.originalText).toBe(text);
      expect(result.value.supplemental?.originalText).toBe(text);
    }
  });

  it("7. aceita input com Object.freeze aplicado antes da validação", () => {
    const input = Object.freeze({
      primary: Object.freeze({ ...PRIMARY_COMMAND }),
      supplemental: Object.freeze({ ...SUPPLEMENTAL_COMMAND }),
    });
    expect(validateConversationHandoffExecutionCommandV1(input)).toEqual({
      ok: true,
      value: { primary: PRIMARY_COMMAND, supplemental: SUPPLEMENTAL_COMMAND },
    });
  });

  it("8. retorna um novo objeto agregado — valores iguais, sem identidade de referência garantida", () => {
    const input = { primary: PRIMARY_COMMAND, supplemental: SUPPLEMENTAL_COMMAND };
    const result = validateConversationHandoffExecutionCommandV1(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(input);
      expect(result.value).not.toBe(input);
    }
  });
});

describe("Bloco B — comando agregado: rejeições estruturais", () => {
  it("9. rejeita input null (not_an_object)", () => {
    expect(validateConversationHandoffExecutionCommandV1(null)).toEqual({
      ok: false,
      code: "not_an_object",
    });
  });

  it("10. rejeita input array (not_an_object)", () => {
    expect(validateConversationHandoffExecutionCommandV1([PRIMARY_COMMAND])).toEqual({
      ok: false,
      code: "not_an_object",
    });
  });

  it("11. rejeita input função (not_an_object)", () => {
    expect(validateConversationHandoffExecutionCommandV1(() => undefined)).toEqual({
      ok: false,
      code: "not_an_object",
    });
  });

  it("12. rejeita objeto vazio {} (missing_field)", () => {
    expect(validateConversationHandoffExecutionCommandV1({})).toEqual({
      ok: false,
      code: "missing_field",
    });
  });

  it("13. rejeita só supplemental sem primary (missing_field)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({ supplemental: SUPPLEMENTAL_COMMAND }),
    ).toEqual({ ok: false, code: "missing_field" });
  });

  it("14. rejeita supplemental colocado no slot primary (invalid_primary_command)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({ primary: SUPPLEMENTAL_COMMAND }),
    ).toEqual({ ok: false, code: "invalid_primary_command" });
  });

  it("15. rejeita primary colocado no slot supplemental (invalid_supplemental_command)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: PRIMARY_COMMAND,
        supplemental: PRIMARY_COMMAND,
      }),
    ).toEqual({ ok: false, code: "invalid_supplemental_command" });
  });

  it("16. rejeita supplemental: null (invalid_supplemental_command)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: PRIMARY_COMMAND,
        supplemental: null,
      }),
    ).toEqual({ ok: false, code: "invalid_supplemental_command" });
  });

  it("17. rejeita supplemental: undefined explícito, propriedade própria (invalid_supplemental_command)", () => {
    const input: Record<string, unknown> = { primary: PRIMARY_COMMAND };
    Object.defineProperty(input, "supplemental", { value: undefined, enumerable: true });
    expect(validateConversationHandoffExecutionCommandV1(input)).toEqual({
      ok: false,
      code: "invalid_supplemental_command",
    });
  });

  it("18. rejeita propriedade extra enumerável na raiz (unexpected_field)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({ primary: PRIMARY_COMMAND, extra: true }),
    ).toEqual({ ok: false, code: "unexpected_field" });
  });

  it("19. rejeita propriedade extra não-enumerável na raiz via defineProperty (unexpected_field)", () => {
    const input: Record<string, unknown> = { primary: PRIMARY_COMMAND };
    Object.defineProperty(input, "rolledBack", { value: true, enumerable: false });
    expect(validateConversationHandoffExecutionCommandV1(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("20. rejeita chave Symbol própria na raiz (unexpected_field)", () => {
    const input: Record<string, unknown> = { primary: PRIMARY_COMMAND };
    Reflect.set(input, Symbol("forbidden"), true);
    expect(validateConversationHandoffExecutionCommandV1(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it('21. rejeita primary com campo extra aninhado tipo "amount" (invalid_primary_command, sem vazar detalhe do C1)', () => {
    expect(
      validateConversationHandoffExecutionCommandV1({ primary: primaryWith({ amount: 250.75 }) }),
    ).toEqual({ ok: false, code: "invalid_primary_command" });
  });

  it('22. rejeita primary com discriminante C1 errado, ex kind:"expense" (invalid_primary_command)', () => {
    expect(
      validateConversationHandoffExecutionCommandV1({ primary: primaryWith({ kind: "expense" }) }),
    ).toEqual({ ok: false, code: "invalid_primary_command" });
  });

  it("23. rejeita primary com UUID inválido (invalid_primary_command)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: primaryWith({ contactId: "not-a-uuid" }),
      }),
    ).toEqual({ ok: false, code: "invalid_primary_command" });
  });

  it("24. rejeita primary com campo obrigatório do C1 ausente, ex sourceMessageId removido (invalid_primary_command)", () => {
    const primary = primaryWith();
    delete primary.sourceMessageId;
    expect(validateConversationHandoffExecutionCommandV1({ primary })).toEqual({
      ok: false,
      code: "invalid_primary_command",
    });
  });

  it("25. rejeita primary com campo undefined explícito próprio (invalid_primary_command)", () => {
    const primary = primaryWith();
    Object.defineProperty(primary, "sourceMessageId", { value: undefined, enumerable: true });
    expect(validateConversationHandoffExecutionCommandV1({ primary })).toEqual({
      ok: false,
      code: "invalid_primary_command",
    });
  });

  it("rejeita não objetos adicionais (not_an_object)", () => {
    for (const input of [undefined, "conversation", 1, true]) {
      expect(validateConversationHandoffExecutionCommandV1(input)).toEqual({
        ok: false,
        code: "not_an_object",
      });
    }
  });
});

describe("Bloco C — correlação entre primary e supplemental", () => {
  it("26. rejeita sourceMessageId divergente entre os dois segmentos (mismatched_source_message_id)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: PRIMARY_COMMAND,
        supplemental: supplementalWith({ sourceMessageId: OTHER_SOURCE_MESSAGE_ID }),
      }),
    ).toEqual({ ok: false, code: "mismatched_source_message_id" });
  });

  it("27. rejeita vehicleId divergente entre dois UUIDs distintos válidos (mismatched_vehicle_id)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: PRIMARY_COMMAND,
        supplemental: supplementalWith({ vehicleId: OTHER_VEHICLE_ID }),
      }),
    ).toEqual({ ok: false, code: "mismatched_vehicle_id" });
  });

  it("28. rejeita vehicleId null no primary vs UUID no supplemental (mismatched_vehicle_id)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: primaryWith({ vehicleId: null }),
        supplemental: supplementalWith({ vehicleId: VEHICLE_ID }),
      }),
    ).toEqual({ ok: false, code: "mismatched_vehicle_id" });
  });

  it("29. rejeita originalText divergente por um caractere (mismatched_original_text)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: primaryWith({ originalText: "Qual óleo uso?" }),
        supplemental: supplementalWith({ originalText: "Qual óleo usu?" }),
      }),
    ).toEqual({ ok: false, code: "mismatched_original_text" });
  });

  it('30. não normaliza espaços — "texto" vs " texto " é divergência (mismatched_original_text)', () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: primaryWith({ originalText: "texto" }),
        supplemental: supplementalWith({ originalText: " texto " }),
      }),
    ).toEqual({ ok: false, code: "mismatched_original_text" });
  });

  it('31. não normaliza caixa — "Óleo" vs "óleo" é divergência (mismatched_original_text)', () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: primaryWith({ originalText: "Óleo" }),
        supplemental: supplementalWith({ originalText: "óleo" }),
      }),
    ).toEqual({ ok: false, code: "mismatched_original_text" });
  });

  it("32. não normaliza forma Unicode — NFC vs NFD é divergência (mismatched_original_text)", () => {
    const nfc = "Óleo".normalize("NFC");
    const nfd = "Óleo".normalize("NFD");
    expect(nfc).not.toBe(nfd);
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: primaryWith({ originalText: nfc }),
        supplemental: supplementalWith({ originalText: nfd }),
      }),
    ).toEqual({ ok: false, code: "mismatched_original_text" });
  });

  it("33. rejeita tentativa de correlação via campo extra na raiz (unexpected_field)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: PRIMARY_COMMAND,
        supplemental: SUPPLEMENTAL_COMMAND,
        sourceMessageId: OTHER_SOURCE_MESSAGE_ID,
      }),
    ).toEqual({ ok: false, code: "unexpected_field" });
  });

  it("cobertura adicional: rejeita contactId divergente (mismatched_contact_id)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: PRIMARY_COMMAND,
        supplemental: supplementalWith({ contactId: OTHER_CONTACT_ID }),
      }),
    ).toEqual({ ok: false, code: "mismatched_contact_id" });
  });

  it("cobertura adicional: rejeita userId divergente (mismatched_user_id)", () => {
    expect(
      validateConversationHandoffExecutionCommandV1({
        primary: PRIMARY_COMMAND,
        supplemental: supplementalWith({ userId: OTHER_USER_ID }),
      }),
    ).toEqual({ ok: false, code: "mismatched_user_id" });
  });
});

describe("Bloco D — resultado agregado: aceitação", () => {
  it("34. aceita variante primary_succeeded", () => {
    const input = {
      status: "primary_succeeded",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
    };
    expect(validateConversationHandoffExecutionResultV1(input)).toEqual({ ok: true, value: input });
  });

  it("35. aceita variante primary_failed", () => {
    const input = {
      status: "primary_failed",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      primaryResult: BLOCKED_RESULT,
    };
    expect(validateConversationHandoffExecutionResultV1(input)).toEqual({ ok: true, value: input });
  });

  it("36. aceita variante completed", () => {
    const input = {
      status: "completed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      supplementalResult: OTHER_SUCCESS_RESULT,
    };
    expect(validateConversationHandoffExecutionResultV1(input)).toEqual({ ok: true, value: input });
  });

  it("37. aceita variante partially_completed", () => {
    const input = {
      status: "partially_completed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      supplementalResult: TRANSIENT_FAILURE_RESULT,
    };
    expect(validateConversationHandoffExecutionResultV1(input)).toEqual({ ok: true, value: input });
  });

  it("38. aceita primary_outcome_uncertain com reason exception_thrown", () => {
    const input = {
      status: "primary_outcome_uncertain",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      reason: "exception_thrown",
    };
    expect(validateConversationHandoffExecutionResultV1(input)).toEqual({ ok: true, value: input });
  });

  it("39. aceita primary_outcome_uncertain com reason invalid_result", () => {
    const input = {
      status: "primary_outcome_uncertain",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      reason: "invalid_result",
    };
    expect(validateConversationHandoffExecutionResultV1(input)).toEqual({ ok: true, value: input });
  });

  it("40. aceita supplemental_outcome_uncertain com reason exception_thrown, preservando primaryResult", () => {
    const input = {
      status: "supplemental_outcome_uncertain",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      reason: "exception_thrown",
    };
    const result = validateConversationHandoffExecutionResultV1(input);
    expect(result).toEqual({ ok: true, value: input });
    if (result.ok && result.value.status === "supplemental_outcome_uncertain") {
      expect(result.value.primaryResult).toEqual(SUCCESS_RESULT);
    }
  });

  it("41. aceita supplemental_outcome_uncertain com reason invalid_result, preservando primaryResult", () => {
    const input = {
      status: "supplemental_outcome_uncertain",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      reason: "invalid_result",
    };
    const result = validateConversationHandoffExecutionResultV1(input);
    expect(result).toEqual({ ok: true, value: input });
    if (result.ok && result.value.status === "supplemental_outcome_uncertain") {
      expect(result.value.primaryResult).toEqual(SUCCESS_RESULT);
    }
  });

  it("42. preserva primaryResult sem alteração em partially_completed", () => {
    const input = {
      status: "partially_completed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      supplementalResult: BLOCKED_RESULT,
    };
    const result = validateConversationHandoffExecutionResultV1(input);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.status === "partially_completed") {
      expect(result.value.primaryResult).toEqual(SUCCESS_RESULT);
    }
  });

  it("43. preserva supplementalResult sem alteração em completed e partially_completed", () => {
    const completedResult = validateConversationHandoffExecutionResultV1({
      status: "completed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      supplementalResult: OTHER_SUCCESS_RESULT,
    });
    const partialResult = validateConversationHandoffExecutionResultV1({
      status: "partially_completed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      supplementalResult: TRANSIENT_FAILURE_RESULT,
    });
    expect(completedResult.ok).toBe(true);
    expect(partialResult.ok).toBe(true);
    if (completedResult.ok && completedResult.value.status === "completed") {
      expect(completedResult.value.supplementalResult).toEqual(OTHER_SUCCESS_RESULT);
    }
    if (partialResult.ok && partialResult.value.status === "partially_completed") {
      expect(partialResult.value.supplementalResult).toEqual(TRANSIENT_FAILURE_RESULT);
    }
  });

  it("44. não exige supplementalResult quando não houve início do supplemental", () => {
    const succeeded = validateConversationHandoffExecutionResultV1({
      status: "primary_succeeded",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
    });
    const uncertain = validateConversationHandoffExecutionResultV1({
      status: "primary_outcome_uncertain",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      reason: "exception_thrown",
    });
    expect(succeeded.ok).toBe(true);
    expect(uncertain.ok).toBe(true);
  });
});

describe("Bloco E — resultado agregado: rejeições", () => {
  it("45. rejeita resultado C1 isolado passado como se fosse agregado (unexpected_field)", () => {
    expect(
      validateConversationHandoffExecutionResultV1({ status: "success", responseText: "ok" }),
    ).toEqual({ ok: false, code: "unexpected_field" });
  });

  it('46. rejeita status desconhecido, ex "unknown" (invalid_status)', () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "unknown",
        command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
        primaryResult: SUCCESS_RESULT,
      }),
    ).toEqual({ ok: false, code: "invalid_status" });
  });

  it("47. rejeita completed sem supplementalResult (missing_field)", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "completed",
        command: AGGREGATE_WITH_SUPPLEMENTAL,
        primaryResult: SUCCESS_RESULT,
      }),
    ).toEqual({ ok: false, code: "missing_field" });
  });

  it("48. rejeita completed cujo command não tem supplemental mas tem dois resultados (invalid_execution_state)", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "completed",
        command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
        primaryResult: SUCCESS_RESULT,
        supplementalResult: OTHER_SUCCESS_RESULT,
      }),
    ).toEqual({ ok: false, code: "invalid_execution_state" });
  });

  it("49. rejeita partially_completed cujo primaryResult não é success (invalid_execution_state)", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "partially_completed",
        command: AGGREGATE_WITH_SUPPLEMENTAL,
        primaryResult: BLOCKED_RESULT,
        supplementalResult: TRANSIENT_FAILURE_RESULT,
      }),
    ).toEqual({ ok: false, code: "invalid_execution_state" });
  });

  it("50. rejeita qualquer variante com campo extra tipo rolledBack:true (unexpected_field)", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "primary_succeeded",
        command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
        primaryResult: SUCCESS_RESULT,
        rolledBack: true,
      }),
    ).toEqual({ ok: false, code: "unexpected_field" });
  });

  it("51. rejeita supplementalResult presente quando primary não teve sucesso (invalid_execution_state)", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "primary_failed",
        command: AGGREGATE_WITH_SUPPLEMENTAL,
        primaryResult: BLOCKED_RESULT,
        supplementalResult: SUCCESS_RESULT,
      }),
    ).toEqual({ ok: false, code: "invalid_execution_state" });
  });

  it("52. rejeita outcome incerto sem reason (missing_field)", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "primary_outcome_uncertain",
        command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      }),
    ).toEqual({ ok: false, code: "missing_field" });
  });

  it('53. rejeita reason fora da união, ex "timeout_detail" (invalid_uncertain_reason)', () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "primary_outcome_uncertain",
        command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
        reason: "timeout_detail",
      }),
    ).toEqual({ ok: false, code: "invalid_uncertain_reason" });
  });

  it("54. rejeita campo tipo stack/sql/token no resultado, sem vazar esse conteúdo (unexpected_field)", () => {
    const result = validateConversationHandoffExecutionResultV1({
      status: "primary_succeeded",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      stack: "Error: segredo interno\n  at file.ts:1:1",
      sql: "SELECT * FROM secrets",
      token: "sk-hostile-token",
    });
    expect(result).toEqual({ ok: false, code: "unexpected_field" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("segredo");
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("sk-hostile-token");
  });

  it("55. rejeita combinação impossível: outcome incerto com primaryResult presente e proibido (invalid_execution_state)", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "primary_outcome_uncertain",
        command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
        reason: "exception_thrown",
        primaryResult: SUCCESS_RESULT,
      }),
    ).toEqual({ ok: false, code: "invalid_execution_state" });
  });

  it("56. rejeita propriedade extra enumerável em qualquer variante (unexpected_field)", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "completed",
        command: AGGREGATE_WITH_SUPPLEMENTAL,
        primaryResult: SUCCESS_RESULT,
        supplementalResult: OTHER_SUCCESS_RESULT,
        extra: "hostil",
      }),
    ).toEqual({ ok: false, code: "unexpected_field" });
  });

  it("57. rejeita propriedade extra não-enumerável via defineProperty (unexpected_field)", () => {
    const input: Record<string, unknown> = {
      status: "primary_succeeded",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
    };
    Object.defineProperty(input, "rolledBack", { value: true, enumerable: false });
    expect(validateConversationHandoffExecutionResultV1(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("58. rejeita chave Symbol em qualquer variante (unexpected_field)", () => {
    const input: Record<string, unknown> = {
      status: "primary_succeeded",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
    };
    Reflect.set(input, Symbol("forbidden"), true);
    expect(validateConversationHandoffExecutionResultV1(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
  });

  it("59. rejeita variante com campo obrigatório ausente, ex command omitido (missing_field)", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "primary_succeeded",
        primaryResult: SUCCESS_RESULT,
      }),
    ).toEqual({ ok: false, code: "missing_field" });
  });

  it("60. rejeita command com valor undefined explícito (invalid_command)", () => {
    const input: Record<string, unknown> = {
      status: "primary_succeeded",
      primaryResult: SUCCESS_RESULT,
    };
    Object.defineProperty(input, "command", { value: undefined, enumerable: true });
    expect(validateConversationHandoffExecutionResultV1(input)).toEqual({
      ok: false,
      code: "invalid_command",
    });
  });

  it("61. rejeita invalid_primary_result quando primaryResult não passa no validator C1", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "primary_succeeded",
        command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
        primaryResult: { status: "success", responseText: "" },
      }),
    ).toEqual({ ok: false, code: "invalid_primary_result" });
  });

  it("62. rejeita invalid_supplemental_result quando supplementalResult não passa no validator C1", () => {
    expect(
      validateConversationHandoffExecutionResultV1({
        status: "completed",
        command: AGGREGATE_WITH_SUPPLEMENTAL,
        primaryResult: SUCCESS_RESULT,
        supplementalResult: { status: "success", responseText: "" },
      }),
    ).toEqual({ ok: false, code: "invalid_supplemental_result" });
  });
});

describe("Bloco F — não-mutação", () => {
  it("63. não muta o comando agregado raiz (descriptors idênticos antes/depois)", () => {
    const input: Record<string, unknown> = {
      primary: PRIMARY_COMMAND,
      supplemental: SUPPLEMENTAL_COMMAND,
      extra: "hostil",
    };
    const keysBefore = Reflect.ownKeys(input);
    const descriptorsBefore = keysBefore.map((key) => Object.getOwnPropertyDescriptor(input, key));
    validateConversationHandoffExecutionCommandV1(input);
    expect(Reflect.ownKeys(input)).toEqual(keysBefore);
    const descriptorsAfter = keysBefore.map((key) => Object.getOwnPropertyDescriptor(input, key));
    expect(descriptorsAfter).toEqual(descriptorsBefore);
  });

  it("64. não muta o comando primary (comparação profunda antes/depois)", () => {
    const primary = primaryWith();
    const before = structuredClone(primary);
    validateConversationHandoffExecutionCommandV1({ primary });
    expect(primary).toEqual(before);
  });

  it("65. não muta o comando supplemental (comparação profunda antes/depois)", () => {
    const supplemental = supplementalWith();
    const before = structuredClone(supplemental);
    validateConversationHandoffExecutionCommandV1({ primary: PRIMARY_COMMAND, supplemental });
    expect(supplemental).toEqual(before);
  });

  it("66. não lança e não muta com fixtures deep-frozen (Object.freeze recursivo)", () => {
    const input = deepFreeze({
      primary: { ...PRIMARY_COMMAND },
      supplemental: { ...SUPPLEMENTAL_COMMAND },
    });
    expect(() => validateConversationHandoffExecutionCommandV1(input)).not.toThrow();
    expect(validateConversationHandoffExecutionCommandV1(input).ok).toBe(true);
  });

  it("67. não muta o resultado agregado de entrada", () => {
    const input = {
      status: "completed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      supplementalResult: OTHER_SUCCESS_RESULT,
    };
    const before = structuredClone(input);
    validateConversationHandoffExecutionResultV1(input);
    expect(input).toEqual(before);
  });

  it("68. não muta os resultados C1 aninhados dentro do agregado", () => {
    const primaryResult = { ...SUCCESS_RESULT };
    const supplementalResult = { ...OTHER_SUCCESS_RESULT };
    const beforePrimary = structuredClone(primaryResult);
    const beforeSupplemental = structuredClone(supplementalResult);
    validateConversationHandoffExecutionResultV1({
      status: "completed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult,
      supplementalResult,
    });
    expect(primaryResult).toEqual(beforePrimary);
    expect(supplementalResult).toEqual(beforeSupplemental);
  });

  it("69. não remove propriedades rejeitadas do objeto original", () => {
    const input: Record<string, unknown> = { primary: PRIMARY_COMMAND, extra: "hostil" };
    validateConversationHandoffExecutionCommandV1(input);
    expect(Reflect.has(input, "extra")).toBe(true);
    expect(input.extra).toBe("hostil");
  });

  it("70. não adiciona propriedades ao input original", () => {
    const input: Record<string, unknown> = { primary: PRIMARY_COMMAND };
    const keysBefore = Reflect.ownKeys(input);
    validateConversationHandoffExecutionCommandV1(input);
    expect(Reflect.ownKeys(input)).toEqual(keysBefore);
  });

  it("71. não altera property descriptors de propriedades não-enumeráveis rejeitadas", () => {
    const input: Record<string, unknown> = { primary: PRIMARY_COMMAND };
    Object.defineProperty(input, "rolledBack", {
      value: true,
      enumerable: false,
      configurable: true,
      writable: false,
    });
    const descriptorBefore = Object.getOwnPropertyDescriptor(input, "rolledBack");
    validateConversationHandoffExecutionCommandV1(input);
    expect(Object.getOwnPropertyDescriptor(input, "rolledBack")).toEqual(descriptorBefore);
  });

  it("72. não invoca getter hostil — contador permanece zero após rejeição segura", () => {
    let calls = 0;
    const input: Record<string, unknown> = { primary: PRIMARY_COMMAND };
    Object.defineProperty(input, "hostile", {
      enumerable: true,
      get() {
        calls += 1;
        return "boom";
      },
    });
    expect(validateConversationHandoffExecutionCommandV1(input)).toEqual({
      ok: false,
      code: "unexpected_field",
    });
    expect(calls).toBe(0);
  });

  it("73. não congela o input", () => {
    const input: Record<string, unknown> = { primary: PRIMARY_COMMAND };
    validateConversationHandoffExecutionCommandV1(input);
    expect(Object.isFrozen(input)).toBe(false);
  });

  it("74. retorna clone defensivo observável, sem prometer identidade de referência com o input", () => {
    const input = { primary: PRIMARY_COMMAND, supplemental: SUPPLEMENTAL_COMMAND };
    const result = validateConversationHandoffExecutionCommandV1(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // O contrato garante apenas igualdade de valor (`toEqual`), nunca
      // identidade de referência (`toBe`) — reaproveitar a referência do
      // chamador não é uma garantia deste validator.
      expect(result.value).toEqual(input);
    }
  });
});

describe("Bloco G — pureza estrutural sob Proxy hostil", () => {
  it("75.1 trap ownKeys lançando erro na raiz → not_an_object, sem vazar texto/stack da trap", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("segredo interno da trap ownKeys");
        },
      },
    );
    const result = validateConversationHandoffExecutionCommandV1(hostile);
    expect(result).toEqual({ ok: false, code: "not_an_object" });
    expect(JSON.stringify(result)).not.toContain("segredo");
  });

  it("75.2 trap getOwnPropertyDescriptor lançando erro → not_an_object", () => {
    const hostile = new Proxy(
      { primary: PRIMARY_COMMAND },
      {
        getOwnPropertyDescriptor() {
          throw new Error("segredo interno da trap getOwnPropertyDescriptor");
        },
      },
    );
    const result = validateConversationHandoffExecutionCommandV1(hostile);
    expect(result).toEqual({ ok: false, code: "not_an_object" });
    expect(JSON.stringify(result)).not.toContain("segredo");
  });

  it("75.3 trap getPrototypeOf lançando erro durante checagem de plain-object → not_an_object", () => {
    const hostile = new Proxy(
      { primary: PRIMARY_COMMAND },
      {
        getPrototypeOf() {
          throw new Error("segredo interno da trap getPrototypeOf");
        },
      },
    );
    const result = validateConversationHandoffExecutionCommandV1(hostile);
    expect(result).toEqual({ ok: false, code: "not_an_object" });
    expect(JSON.stringify(result)).not.toContain("segredo");
  });

  it("75.4 trap get com contador — permanece zero (nunca invocado antes da introspecção falhar)", () => {
    let getCalls = 0;
    const hostile = new Proxy(
      {},
      {
        get(target, key, receiver) {
          getCalls += 1;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const result = validateConversationHandoffExecutionCommandV1(hostile);
    expect(result).toEqual({ ok: false, code: "missing_field" });
    expect(getCalls).toBe(0);
  });

  it("75.5 Proxy hostil no slot primary → invalid_primary_command, sem vazar detalhe", () => {
    const hostilePrimary = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("segredo interno do slot primary");
        },
      },
    );
    const result = validateConversationHandoffExecutionCommandV1({ primary: hostilePrimary });
    expect(result).toEqual({ ok: false, code: "invalid_primary_command" });
    expect(JSON.stringify(result)).not.toContain("segredo");
  });

  it("75.6 Proxy hostil no slot supplemental → invalid_supplemental_command, sem vazar detalhe", () => {
    const hostileSupplemental = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("segredo interno do slot supplemental");
        },
      },
    );
    const result = validateConversationHandoffExecutionCommandV1({
      primary: PRIMARY_COMMAND,
      supplemental: hostileSupplemental,
    });
    expect(result).toEqual({ ok: false, code: "invalid_supplemental_command" });
    expect(JSON.stringify(result)).not.toContain("segredo");
  });

  it("75.7 nenhuma chamada aos validators do C1 acontece depois que a allowlist falha (contador zero)", () => {
    let getCalls = 0;
    const hostileSupplemental = new Proxy(
      { ...SUPPLEMENTAL_COMMAND },
      {
        get(target, key, receiver) {
          getCalls += 1;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    // primary está ausente: a validação deve falhar em "missing_field" antes
    // de jamais tocar em "supplemental" — logo o Proxy hostil nunca é lido.
    const result = validateConversationHandoffExecutionCommandV1({
      supplemental: hostileSupplemental,
    });
    expect(result).toEqual({ ok: false, code: "missing_field" });
    expect(getCalls).toBe(0);
  });

  it("75.8 nenhuma execução acontece em nenhum cenário do bloco G — este build não define executor", () => {
    const source = readFileSync(
      new URL("../execution-contract.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(source).not.toMatch(
      /Executor|executeConversationHandoff|primaryExecutor|supplementalExecutor/,
    );
  });

  it("75.9 mensagem de erro nunca contém texto da trap, stack ou payload hostil", () => {
    const scenarios: unknown[] = [
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("payload-hostil-A");
          },
        },
      ),
      new Proxy(
        { primary: PRIMARY_COMMAND },
        {
          getOwnPropertyDescriptor() {
            throw new Error("payload-hostil-B");
          },
        },
      ),
      new Proxy(
        { primary: PRIMARY_COMMAND },
        {
          getPrototypeOf() {
            throw new Error("payload-hostil-C");
          },
        },
      ),
      {
        primary: new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error("payload-hostil-D");
            },
          },
        ),
      },
    ];
    for (const scenario of scenarios) {
      const result = validateConversationHandoffExecutionCommandV1(scenario);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("payload-hostil");
      expect(serialized).not.toContain("Error");
    }
  });

  it("75.10 resultado final em todos os casos do bloco G contém apenas {ok:false, code}", () => {
    const scenarios: unknown[] = [
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("x");
          },
        },
      ),
      new Proxy(
        { primary: PRIMARY_COMMAND },
        {
          getOwnPropertyDescriptor() {
            throw new Error("x");
          },
        },
      ),
      new Proxy(
        { primary: PRIMARY_COMMAND },
        {
          getPrototypeOf() {
            throw new Error("x");
          },
        },
      ),
      {},
      {
        primary: new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error("x");
            },
          },
        ),
      },
      {
        primary: PRIMARY_COMMAND,
        supplemental: new Proxy(
          {},
          {
            ownKeys() {
              throw new Error("x");
            },
          },
        ),
      },
    ];
    for (const scenario of scenarios) {
      const result = validateConversationHandoffExecutionCommandV1(scenario);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(Object.keys(result).sort()).toEqual(["code", "ok"]);
        expect(typeof result.code).toBe("string");
      }
    }
  });
});

describe("Bloco H — ausência de dependências operacionais", () => {
  const productionSource = readFileSync(
    new URL("../execution-contract.ts", import.meta.url).pathname,
    "utf8",
  );

  it("76. zero import de supabase-js/createClient em execution-contract.ts", () => {
    expect(productionSource).not.toMatch(/supabase-js|createClient/);
  });

  it("77. zero uso de fetch( em execution-contract.ts", () => {
    expect(productionSource).not.toMatch(/fetch\(/);
  });

  it("78. zero uso de Deno.env/Bun.env/process.env em execution-contract.ts", () => {
    expect(productionSource).not.toMatch(/Deno\.env|Bun\.env|process\.env/);
  });

  it("79. zero SQL ou .rpc( em execution-contract.ts", () => {
    expect(productionSource).not.toMatch(/\.rpc\(|SELECT |INSERT INTO|UPDATE .* SET/i);
  });

  it("80. zero import de provider/adapter/sender/outbound em execution-contract.ts", () => {
    expect(productionSource).not.toMatch(
      /from ["'][^"']*(provider|adapter|sender|outbound)[^"']*["']/i,
    );
  });

  it("81. zero referência a OpenAI/Anthropic/gateway de IA em execution-contract.ts", () => {
    expect(productionSource).not.toMatch(/openai|anthropic/i);
  });

  it("82. zero uso de Date.now()/new Date() em execution-contract.ts", () => {
    expect(productionSource).not.toMatch(/Date\.now\(\)|new Date\(/);
  });

  it("83. zero uso de randomUUID em execution-contract.ts", () => {
    expect(productionSource).not.toMatch(/randomUUID/);
  });

  it("84. zero import de fs/Deno file APIs em execution-contract.ts", () => {
    expect(productionSource).not.toMatch(
      /node:fs|from ["']fs["']|Deno\.readTextFile|Deno\.readFile|Deno\.writeFile/,
    );
  });

  it("85. determinismo — mesma entrada validada duas vezes produz resultado deep-equal", () => {
    const commandInput = { primary: PRIMARY_COMMAND, supplemental: SUPPLEMENTAL_COMMAND };
    expect(validateConversationHandoffExecutionCommandV1(commandInput)).toEqual(
      validateConversationHandoffExecutionCommandV1(commandInput),
    );

    const resultInput = {
      status: "completed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      supplementalResult: OTHER_SUCCESS_RESULT,
    };
    expect(validateConversationHandoffExecutionResultV1(resultInput)).toEqual(
      validateConversationHandoffExecutionResultV1(resultInput),
    );
  });

  it("86. nenhum consumidor externo referencia os símbolos novos deste build fora dos 3 arquivos", () => {
    const allowedRelativePaths = new Set([
      "supabase/functions/_shared/whatsapp/conversation-handoff/execution-contract.ts",
      "supabase/functions/_shared/whatsapp/conversation-handoff/__tests__/execution-contract.test.ts",
      "supabase/functions/_shared/whatsapp/conversation-handoff/__tests__/execution-contract.type-test.ts",
    ]);
    const proc = spawnSync(
      "rg",
      [
        "-l",
        "ConversationHandoffExecutionCommandV1|ConversationHandoffExecutionResultV1|execution-contract",
        ".",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const matched = (proc.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^\.\//, ""));
    expect(matched.length).toBeGreaterThan(0);
    const unexpected = matched.filter((file) => !allowedRelativePaths.has(file));
    expect(unexpected).toEqual([]);
  });
});
