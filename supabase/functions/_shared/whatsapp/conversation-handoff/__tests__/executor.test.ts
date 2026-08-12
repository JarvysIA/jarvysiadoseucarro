import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_HANDOFF_CONTRACT_VERSION,
  type ConversationExecutionResult,
} from "../contract.ts";
import {
  validateConversationHandoffExecutionResultV1,
  type ConversationHandoffExecutionCommandV1,
  type ConversationHandoffExecutionResultV1,
  type ConversationHandoffPrimaryCommandV1,
  type ConversationHandoffSupplementalCommandV1,
} from "../execution-contract.ts";
import { executeConversationHandoffV1, type ConversationHandoffInvokerV1 } from "../executor.ts";

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

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

const AGGREGATE_WITHOUT_SUPPLEMENTAL: ConversationHandoffExecutionCommandV1 = {
  primary: PRIMARY_COMMAND,
};

const AGGREGATE_WITH_SUPPLEMENTAL: ConversationHandoffExecutionCommandV1 = {
  primary: PRIMARY_COMMAND,
  supplemental: SUPPLEMENTAL_COMMAND,
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

type SegmentBehavior =
  | Readonly<{ kind: "resolve"; value: unknown }>
  | Readonly<{ kind: "reject"; error: Error }>;

function createInvoker(
  behaviors: Readonly<{ primary?: SegmentBehavior; supplemental?: SegmentBehavior }>,
  calls: string[],
): ConversationHandoffInvokerV1 {
  return async (command) => {
    calls.push(command.segment);
    const behavior = behaviors[command.segment];
    if (behavior === undefined) {
      throw new Error(`teste não configurou comportamento para o segmento ${command.segment}`);
    }
    if (behavior.kind === "reject") {
      throw behavior.error;
    }
    return behavior.value;
  };
}

describe("Bloco A — sequência básica", () => {
  it("1. primary sucesso sem supplemental → primary_succeeded; invoke chamado 1x", async () => {
    const calls: string[] = [];
    const invoke = createInvoker({ primary: { kind: "resolve", value: SUCCESS_RESULT } }, calls);
    const result = await executeConversationHandoffV1(AGGREGATE_WITHOUT_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "primary_succeeded",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
    });
    expect(calls).toEqual(["primary"]);
  });

  it("2. primary falha válida sem supplemental → primary_failed; invoke chamado 1x", async () => {
    const calls: string[] = [];
    const invoke = createInvoker({ primary: { kind: "resolve", value: BLOCKED_RESULT } }, calls);
    const result = await executeConversationHandoffV1(AGGREGATE_WITHOUT_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "primary_failed",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      primaryResult: BLOCKED_RESULT,
    });
    expect(calls).toEqual(["primary"]);
  });

  it("3. primary lança exceção → primary_outcome_uncertain(exception_thrown); invoke chamado 1x", async () => {
    const calls: string[] = [];
    const invoke = createInvoker(
      { primary: { kind: "reject", error: new Error("falha interna simulada") } },
      calls,
    );
    const result = await executeConversationHandoffV1(AGGREGATE_WITHOUT_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "primary_outcome_uncertain",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      reason: "exception_thrown",
    });
    expect(calls).toEqual(["primary"]);
  });

  it("4. primary retorna valor inválido (objeto vazio) → primary_outcome_uncertain(invalid_result)", async () => {
    const calls: string[] = [];
    const invoke = createInvoker({ primary: { kind: "resolve", value: {} } }, calls);
    const result = await executeConversationHandoffV1(AGGREGATE_WITHOUT_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "primary_outcome_uncertain",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      reason: "invalid_result",
    });
    expect(calls).toEqual(["primary"]);
  });

  it("5. primary sucesso + supplemental sucesso → completed; invoke 2x, ordem primary→supplemental", async () => {
    const calls: string[] = [];
    const invoke = createInvoker(
      {
        primary: { kind: "resolve", value: SUCCESS_RESULT },
        supplemental: { kind: "resolve", value: OTHER_SUCCESS_RESULT },
      },
      calls,
    );
    const result = await executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "completed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      supplementalResult: OTHER_SUCCESS_RESULT,
    });
    expect(calls).toEqual(["primary", "supplemental"]);
  });

  it("6. primary sucesso + supplemental falha válida → partially_completed", async () => {
    const calls: string[] = [];
    const invoke = createInvoker(
      {
        primary: { kind: "resolve", value: SUCCESS_RESULT },
        supplemental: { kind: "resolve", value: TRANSIENT_FAILURE_RESULT },
      },
      calls,
    );
    const result = await executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "partially_completed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      supplementalResult: TRANSIENT_FAILURE_RESULT,
    });
    expect(calls).toEqual(["primary", "supplemental"]);
  });

  it("7. primary sucesso + supplemental lança exceção → supplemental_outcome_uncertain(exception_thrown), primaryResult preservado", async () => {
    const calls: string[] = [];
    const invoke = createInvoker(
      {
        primary: { kind: "resolve", value: SUCCESS_RESULT },
        supplemental: { kind: "reject", error: new Error("boom supplemental") },
      },
      calls,
    );
    const result = await executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "supplemental_outcome_uncertain",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      reason: "exception_thrown",
    });
    expect(calls).toEqual(["primary", "supplemental"]);
  });

  it("8. primary sucesso + supplemental retorna inválido → supplemental_outcome_uncertain(invalid_result), primaryResult preservado", async () => {
    const calls: string[] = [];
    const invoke = createInvoker(
      {
        primary: { kind: "resolve", value: SUCCESS_RESULT },
        supplemental: { kind: "resolve", value: { status: "success", responseText: "" } },
      },
      calls,
    );
    const result = await executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "supplemental_outcome_uncertain",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: SUCCESS_RESULT,
      reason: "invalid_result",
    });
    expect(calls).toEqual(["primary", "supplemental"]);
  });
});

describe("Bloco B — curto-circuito", () => {
  it("9. primary falha válida com supplemental presente → supplemental nunca invocado, resultado primary_failed", async () => {
    const calls: string[] = [];
    const invoke = createInvoker({ primary: { kind: "resolve", value: BLOCKED_RESULT } }, calls);
    const result = await executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "primary_failed",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      primaryResult: BLOCKED_RESULT,
    });
    expect(calls.filter((segment) => segment === "supplemental")).toHaveLength(0);
  });

  it("10. primary lança exceção com supplemental presente → supplemental nunca invocado", async () => {
    const calls: string[] = [];
    const invoke = createInvoker(
      { primary: { kind: "reject", error: new Error("boom primary") } },
      calls,
    );
    const result = await executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "primary_outcome_uncertain",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      reason: "exception_thrown",
    });
    expect(calls.filter((segment) => segment === "supplemental")).toHaveLength(0);
  });

  it("11. primary retorna inválido com supplemental presente → supplemental nunca invocado", async () => {
    const calls: string[] = [];
    const invoke = createInvoker({ primary: { kind: "resolve", value: {} } }, calls);
    const result = await executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);
    expect(result).toEqual({
      status: "primary_outcome_uncertain",
      command: AGGREGATE_WITH_SUPPLEMENTAL,
      reason: "invalid_result",
    });
    expect(calls.filter((segment) => segment === "supplemental")).toHaveLength(0);
  });

  it("12. comando sem supplemental → invoke chamado exatamente 1x em todos os subcenários, nunca 2x", async () => {
    const scenarios: readonly SegmentBehavior[] = [
      { kind: "resolve", value: SUCCESS_RESULT },
      { kind: "resolve", value: BLOCKED_RESULT },
      { kind: "reject", error: new Error("x") },
      { kind: "resolve", value: {} },
    ];
    for (const primaryBehavior of scenarios) {
      const calls: string[] = [];
      const invoke = createInvoker({ primary: primaryBehavior }, calls);
      await executeConversationHandoffV1(AGGREGATE_WITHOUT_SUPPLEMENTAL, invoke);
      expect(calls).toEqual(["primary"]);
    }
  });
});

describe("Bloco C — preservação e integridade", () => {
  it("13. primaryResult preservado exatamente (deep-equal) em partially_completed", async () => {
    const calls: string[] = [];
    const invoke = createInvoker(
      {
        primary: { kind: "resolve", value: SUCCESS_RESULT },
        supplemental: { kind: "resolve", value: TRANSIENT_FAILURE_RESULT },
      },
      calls,
    );
    const result = await executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);
    expect(result.status).toBe("partially_completed");
    if (result.status === "partially_completed") {
      expect(result.primaryResult).toEqual(SUCCESS_RESULT);
    }
  });

  it("14. primaryResult preservado exatamente em supplemental_outcome_uncertain", async () => {
    const calls: string[] = [];
    const invoke = createInvoker(
      {
        primary: { kind: "resolve", value: SUCCESS_RESULT },
        supplemental: { kind: "reject", error: new Error("x") },
      },
      calls,
    );
    const result = await executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);
    expect(result.status).toBe("supplemental_outcome_uncertain");
    if (result.status === "supplemental_outcome_uncertain") {
      expect(result.primaryResult).toEqual(SUCCESS_RESULT);
    }
  });

  it("15. command no resultado final corresponde ao comando recebido (mesma referência)", async () => {
    const calls: string[] = [];
    const invoke = createInvoker({ primary: { kind: "resolve", value: SUCCESS_RESULT } }, calls);
    const result = await executeConversationHandoffV1(AGGREGATE_WITHOUT_SUPPLEMENTAL, invoke);
    expect(result.command).toBe(AGGREGATE_WITHOUT_SUPPLEMENTAL);
  });

  it("16. reason nunca contém texto de exceção real, mesmo com mensagem sensível", async () => {
    const calls: string[] = [];
    const invoke = createInvoker(
      { primary: { kind: "reject", error: new Error("SENHA_SECRETA=abc123 vazou aqui") } },
      calls,
    );
    const result = await executeConversationHandoffV1(AGGREGATE_WITHOUT_SUPPLEMENTAL, invoke);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SENHA_SECRETA");
    expect(serialized).not.toContain("abc123");
    expect(result).toEqual({
      status: "primary_outcome_uncertain",
      command: AGGREGATE_WITHOUT_SUPPLEMENTAL,
      reason: "exception_thrown",
    });
  });

  it("17. resultado final de todos os 8 cenários do Bloco A passa validateConversationHandoffExecutionResultV1 sem falhar", async () => {
    const scenarios: ReadonlyArray<() => Promise<ConversationHandoffExecutionResultV1>> = [
      () =>
        executeConversationHandoffV1(
          AGGREGATE_WITHOUT_SUPPLEMENTAL,
          createInvoker({ primary: { kind: "resolve", value: SUCCESS_RESULT } }, []),
        ),
      () =>
        executeConversationHandoffV1(
          AGGREGATE_WITHOUT_SUPPLEMENTAL,
          createInvoker({ primary: { kind: "resolve", value: BLOCKED_RESULT } }, []),
        ),
      () =>
        executeConversationHandoffV1(
          AGGREGATE_WITHOUT_SUPPLEMENTAL,
          createInvoker({ primary: { kind: "reject", error: new Error("x") } }, []),
        ),
      () =>
        executeConversationHandoffV1(
          AGGREGATE_WITHOUT_SUPPLEMENTAL,
          createInvoker({ primary: { kind: "resolve", value: {} } }, []),
        ),
      () =>
        executeConversationHandoffV1(
          AGGREGATE_WITH_SUPPLEMENTAL,
          createInvoker(
            {
              primary: { kind: "resolve", value: SUCCESS_RESULT },
              supplemental: { kind: "resolve", value: OTHER_SUCCESS_RESULT },
            },
            [],
          ),
        ),
      () =>
        executeConversationHandoffV1(
          AGGREGATE_WITH_SUPPLEMENTAL,
          createInvoker(
            {
              primary: { kind: "resolve", value: SUCCESS_RESULT },
              supplemental: { kind: "resolve", value: TRANSIENT_FAILURE_RESULT },
            },
            [],
          ),
        ),
      () =>
        executeConversationHandoffV1(
          AGGREGATE_WITH_SUPPLEMENTAL,
          createInvoker(
            {
              primary: { kind: "resolve", value: SUCCESS_RESULT },
              supplemental: { kind: "reject", error: new Error("x") },
            },
            [],
          ),
        ),
      () =>
        executeConversationHandoffV1(
          AGGREGATE_WITH_SUPPLEMENTAL,
          createInvoker(
            {
              primary: { kind: "resolve", value: SUCCESS_RESULT },
              supplemental: { kind: "resolve", value: { status: "success", responseText: "" } },
            },
            [],
          ),
        ),
    ];

    for (const runScenario of scenarios) {
      const result = await runScenario();
      const validation = validateConversationHandoffExecutionResultV1(result);
      expect(validation.ok).toBe(true);
    }
  });
});

describe("Bloco D — sequencialidade real", () => {
  it("18. supplemental só é invocado depois que a promise do primary resolveu (ordem real com delay artificial)", async () => {
    const events: Array<{ segment: string; at: number }> = [];
    const invoke: ConversationHandoffInvokerV1 = async (command) => {
      if (command.segment === "primary") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push({ segment: "primary", at: Date.now() });
        return SUCCESS_RESULT;
      }
      events.push({ segment: "supplemental", at: Date.now() });
      return OTHER_SUCCESS_RESULT;
    };

    await executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);

    expect(events).toHaveLength(2);
    expect(events[0]?.segment).toBe("primary");
    expect(events[1]?.segment).toBe("supplemental");
    expect(events[1]?.at).toBeGreaterThanOrEqual(events[0]?.at ?? 0);
  });

  it("19. inspeção estática: zero uso de Promise.all/Promise.allSettled/Promise.race no código-fonte de executor.ts", () => {
    const source = readFileSync(fileURLToPath(new URL("../executor.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/Promise\.all|Promise\.allSettled|Promise\.race/);
  });

  it("20. supplemental não é chamado enquanto a promise do primary está pendente", async () => {
    let resolvePrimary: ((value: unknown) => void) | undefined;
    const primaryPromise = new Promise((resolve) => {
      resolvePrimary = resolve;
    });
    let supplementalCalled = false;
    const invoke: ConversationHandoffInvokerV1 = async (command) => {
      if (command.segment === "primary") {
        return primaryPromise;
      }
      supplementalCalled = true;
      return OTHER_SUCCESS_RESULT;
    };

    const resultPromise = executeConversationHandoffV1(AGGREGATE_WITH_SUPPLEMENTAL, invoke);

    // Deixa passar algumas voltas de microtask sem resolver o primary.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(supplementalCalled).toBe(false);

    resolvePrimary?.(SUCCESS_RESULT);
    await resultPromise;
    expect(supplementalCalled).toBe(true);
  });
});

describe("Bloco E — pureza / ausência de dependência operacional", () => {
  const executorSource = readFileSync(
    fileURLToPath(new URL("../executor.ts", import.meta.url)),
    "utf8",
  );

  it("21. zero import de supabase-js/createClient em executor.ts", () => {
    expect(executorSource).not.toMatch(/supabase-js|createClient/);
  });

  it("22. zero uso de fetch( em executor.ts", () => {
    expect(executorSource).not.toMatch(/fetch\(/);
  });

  it("23. zero Deno.env/Bun.env/process.env em executor.ts", () => {
    expect(executorSource).not.toMatch(/Deno\.env|Bun\.env|process\.env/);
  });

  it("24. zero SQL ou .rpc( em executor.ts", () => {
    expect(executorSource).not.toMatch(/\.rpc\(|SELECT |INSERT INTO|UPDATE .* SET/i);
  });

  it("25. zero referência a OpenAI/Anthropic/IA real em executor.ts", () => {
    expect(executorSource).not.toMatch(/openai|anthropic/i);
  });

  it("26. zero uso de Date.now()/new Date() em executor.ts", () => {
    expect(executorSource).not.toMatch(/Date\.now\(\)|new Date\(/);
  });

  it("27. zero uso de randomUUID em executor.ts", () => {
    expect(executorSource).not.toMatch(/randomUUID/);
  });

  it("28. zero import de fs/Deno file APIs em executor.ts", () => {
    expect(executorSource).not.toMatch(
      /node:fs|from ["']fs["']|Deno\.readTextFile|Deno\.readFile|Deno\.writeFile/,
    );
  });

  it("29. zero any/as any/as unknown as/@ts-ignore/@ts-nocheck em executor.ts", () => {
    expect(executorSource).not.toMatch(/\bany\b|as any|as unknown as|@ts-ignore|@ts-nocheck/);
  });

  it("30. executor.ts delega toda validação ao C1/C2A e não reimplementa regras (inspeção do código-fonte)", () => {
    expect(executorSource).toContain("validateConversationExecutionResult");
    expect(executorSource).not.toMatch(/UUID_REGEX|isPlainObject|hasUsefulText|isUuid\(/);
  });
});

describe("Bloco F — não mutação", () => {
  it("31. não muta o comando de entrada (descriptors idênticos antes/depois)", async () => {
    const command: ConversationHandoffExecutionCommandV1 = {
      primary: PRIMARY_COMMAND,
      supplemental: SUPPLEMENTAL_COMMAND,
    };
    const keysBefore = Reflect.ownKeys(command);
    const descriptorsBefore = keysBefore.map((key) =>
      Object.getOwnPropertyDescriptor(command, key),
    );
    const calls: string[] = [];
    const invoke = createInvoker(
      {
        primary: { kind: "resolve", value: SUCCESS_RESULT },
        supplemental: { kind: "resolve", value: OTHER_SUCCESS_RESULT },
      },
      calls,
    );

    await executeConversationHandoffV1(command, invoke);

    expect(Reflect.ownKeys(command)).toEqual(keysBefore);
    const descriptorsAfter = keysBefore.map((key) => Object.getOwnPropertyDescriptor(command, key));
    expect(descriptorsAfter).toEqual(descriptorsBefore);
  });

  it("32. não muta o valor bruto retornado por invoke antes de validar", async () => {
    const rawValue = { status: "success", responseText: "não mutar isto" };
    const before = structuredClone(rawValue);
    const calls: string[] = [];
    const invoke = createInvoker({ primary: { kind: "resolve", value: rawValue } }, calls);

    await executeConversationHandoffV1(AGGREGATE_WITHOUT_SUPPLEMENTAL, invoke);

    expect(rawValue).toEqual(before);
  });

  it("33. aceita command com Object.freeze aplicado, sem lançar", async () => {
    const command = Object.freeze({
      primary: Object.freeze({ ...PRIMARY_COMMAND }),
      supplemental: Object.freeze({ ...SUPPLEMENTAL_COMMAND }),
    });
    const calls: string[] = [];
    const invoke = createInvoker(
      {
        primary: { kind: "resolve", value: SUCCESS_RESULT },
        supplemental: { kind: "resolve", value: OTHER_SUCCESS_RESULT },
      },
      calls,
    );

    await expect(executeConversationHandoffV1(command, invoke)).resolves.toEqual({
      status: "completed",
      command,
      primaryResult: SUCCESS_RESULT,
      supplementalResult: OTHER_SUCCESS_RESULT,
    });
  });
});
