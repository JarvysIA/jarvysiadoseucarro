// Build expense-service-pure — Testes puros e mockados do
// executeConfirmedExpenseCreate. Runner: bun test. Sem rede, sem banco,
// sem Supabase.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { executeConfirmedExpenseCreate } from "../expense-service.ts";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CREATE_ACTION_TYPE,
  EXPENSE_MAX_VALOR,
  type ConfirmedExpenseCreateInput,
  type ConfirmedExpenseCreateLogFields,
  type ConfirmedExpenseCreateLogger,
  type ExpenseCreateExecutionCommand,
  type ExpenseCreateExecutorPort,
  type ExpenseCreateExecutorResult,
} from "../expense-types.ts";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_PATH = resolve(HERE, "../expense-service.ts");
const TYPES_PATH = resolve(HERE, "../expense-types.ts");

function baseInput(
  overrides: Partial<ConfirmedExpenseCreateInput> = {},
): ConfirmedExpenseCreateInput {
  return {
    draftId: "draft-1",
    conversationStateId: "cs-1",
    confirmationMessageId: "cm-1",
    sourceMessageId: "sm-1",
    queueItemId: "q-1",
    userId: "u-1",
    contactId: "c-1",
    vehicleId: "v-1",
    categoria: "Combustível",
    valor: 149.9,
    descricao: null,
    expectedStateVersion: 3,
    orchestratorVersion: "expense-1",
    ...overrides,
  };
}

type ExecutorCall = ExpenseCreateExecutionCommand;

function makeExecutor(
  result: ExpenseCreateExecutorResult | (() => Promise<ExpenseCreateExecutorResult>),
): { port: ExpenseCreateExecutorPort; calls: ExecutorCall[] } {
  const calls: ExecutorCall[] = [];
  const port: ExpenseCreateExecutorPort = {
    async executeExpenseCreate(command) {
      calls.push(command);
      if (typeof result === "function") return result();
      return result;
    },
  };
  return { port, calls };
}

function makeThrowingExecutor(
  err: unknown,
): { port: ExpenseCreateExecutorPort; calls: ExecutorCall[] } {
  const calls: ExecutorCall[] = [];
  const port: ExpenseCreateExecutorPort = {
    async executeExpenseCreate(command) {
      calls.push(command);
      throw err;
    },
  };
  return { port, calls };
}

function makeLogger(): {
  logger: ConfirmedExpenseCreateLogger;
  entries: ConfirmedExpenseCreateLogFields[];
} {
  const entries: ConfirmedExpenseCreateLogFields[] = [];
  return {
    entries,
    logger: {
      log(f) {
        entries.push(f);
      },
    },
  };
}

const ALLOWED_LOG_KEYS = new Set([
  "event",
  "actionType",
  "outcome",
  "reasonCode",
  "durationMs",
]);

function assertLogsSanitized(entries: ConfirmedExpenseCreateLogFields[]): void {
  for (const e of entries) {
    for (const k of Object.keys(e)) {
      expect(ALLOWED_LOG_KEYS.has(k)).toBe(true);
    }
    // Nunca aparece dado sensível.
    const json = JSON.stringify(e);
    expect(json).not.toContain("draft-1");
    expect(json).not.toContain("cs-1");
    expect(json).not.toContain("cm-1");
    expect(json).not.toContain("sm-1");
    expect(json).not.toContain("q-1");
    expect(json).not.toContain("u-1");
    expect(json).not.toContain("c-1");
    expect(json).not.toContain("v-1");
    expect(json).not.toContain("149.9");
    expect(json).not.toContain("Combustível");
    expect(json).not.toContain("descricao");
  }
}

// ---------------------------------------------------------------------------
// Validações: ids obrigatórios
// ---------------------------------------------------------------------------

describe("ids obrigatórios", () => {
  const idFields: Array<keyof ConfirmedExpenseCreateInput> = [
    "draftId",
    "conversationStateId",
    "confirmationMessageId",
    "sourceMessageId",
    "queueItemId",
    "userId",
    "contactId",
    "vehicleId",
    "orchestratorVersion",
  ];

  for (const field of idFields) {
    test(`${field} vazio -> malformed/input_invalid`, async () => {
      const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "x", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
      const res = await executeConfirmedExpenseCreate(
        baseInput({ [field]: "" } as Partial<ConfirmedExpenseCreateInput>),
        { executor: port },
      );
      expect(res).toEqual({ kind: "malformed", reason: "input_invalid" });
      expect(calls.length).toBe(0);
    });

    test(`${field} só espaços -> malformed/input_invalid`, async () => {
      const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "x", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
      const res = await executeConfirmedExpenseCreate(
        baseInput({ [field]: "   " } as Partial<ConfirmedExpenseCreateInput>),
        { executor: port },
      );
      expect(res).toEqual({ kind: "malformed", reason: "input_invalid" });
      expect(calls.length).toBe(0);
    });

    test(`${field} não-string -> malformed/input_invalid`, async () => {
      const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "x", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
      const res = await executeConfirmedExpenseCreate(
        baseInput({ [field]: 123 as unknown as string }),
        { executor: port },
      );
      expect(res).toEqual({ kind: "malformed", reason: "input_invalid" });
      expect(calls.length).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// expectedStateVersion
// ---------------------------------------------------------------------------

describe("expectedStateVersion", () => {
  test("zero é aceito", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ expectedStateVersion: 0 }), { executor: port });
    expect(res.kind).toBe("completed");
  });

  test("positivo é aceito", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ expectedStateVersion: 42 }), { executor: port });
    expect(res.kind).toBe("completed");
  });

  test("negativo -> malformed/state_version_invalid", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ expectedStateVersion: -1 }), { executor: port });
    expect(res).toEqual({ kind: "malformed", reason: "state_version_invalid" });
    expect(calls.length).toBe(0);
  });

  test("decimal -> malformed/state_version_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ expectedStateVersion: 1.5 }), { executor: port });
    expect(res).toEqual({ kind: "malformed", reason: "state_version_invalid" });
  });

  test("NaN -> malformed/state_version_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ expectedStateVersion: Number.NaN }), { executor: port });
    expect(res).toEqual({ kind: "malformed", reason: "state_version_invalid" });
  });

  test("não-number -> malformed/state_version_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(
      baseInput({ expectedStateVersion: "3" as unknown as number }),
      { executor: port },
    );
    expect(res).toEqual({ kind: "malformed", reason: "state_version_invalid" });
  });
});

// ---------------------------------------------------------------------------
// categoria
// ---------------------------------------------------------------------------

describe("categoria", () => {
  for (const cat of EXPENSE_CATEGORIES) {
    test(`categoria válida "${cat}" é aceita`, async () => {
      const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 149.9, categoria: cat });
      const res = await executeConfirmedExpenseCreate(baseInput({ categoria: cat }), { executor: port });
      expect(res.kind).toBe("completed");
      expect(calls[0].categoria).toBe(cat);
    });
  }

  test("string fora da lista -> malformed/categoria_invalid", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(
      baseInput({ categoria: "Outros" as unknown as typeof EXPENSE_CATEGORIES[number] }),
      { executor: port },
    );
    expect(res).toEqual({ kind: "malformed", reason: "categoria_invalid" });
    expect(calls.length).toBe(0);
  });

  test("string vazia -> malformed/categoria_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(
      baseInput({ categoria: "" as unknown as typeof EXPENSE_CATEGORIES[number] }),
      { executor: port },
    );
    expect(res).toEqual({ kind: "malformed", reason: "categoria_invalid" });
  });

  test("minúsculas -> malformed/categoria_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(
      baseInput({ categoria: "combustível" as unknown as typeof EXPENSE_CATEGORIES[number] }),
      { executor: port },
    );
    expect(res).toEqual({ kind: "malformed", reason: "categoria_invalid" });
  });

  test("sem acento -> malformed/categoria_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(
      baseInput({ categoria: "Combustivel" as unknown as typeof EXPENSE_CATEGORIES[number] }),
      { executor: port },
    );
    expect(res).toEqual({ kind: "malformed", reason: "categoria_invalid" });
  });

  test("não-string -> malformed/categoria_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(
      baseInput({ categoria: 1 as unknown as typeof EXPENSE_CATEGORIES[number] }),
      { executor: port },
    );
    expect(res).toEqual({ kind: "malformed", reason: "categoria_invalid" });
  });
});

// ---------------------------------------------------------------------------
// valor
// ---------------------------------------------------------------------------

describe("valor", () => {
  test("0.01 é aceito", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 0.01, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ valor: 0.01 }), { executor: port });
    expect(res.kind).toBe("completed");
    expect(calls[0].valor).toBe(0.01);
  });

  test("149.90 é aceito", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ valor: 149.9 }), { executor: port });
    expect(res.kind).toBe("completed");
    expect(calls[0].valor).toBe(149.9);
  });

  test("limite EXPENSE_MAX_VALOR é aceito", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: EXPENSE_MAX_VALOR, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ valor: EXPENSE_MAX_VALOR }), { executor: port });
    expect(res.kind).toBe("completed");
  });

  test("0 -> malformed/valor_invalid", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ valor: 0 }), { executor: port });
    expect(res).toEqual({ kind: "malformed", reason: "valor_invalid" });
    expect(calls.length).toBe(0);
  });

  test("negativo -> malformed/valor_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ valor: -10 }), { executor: port });
    expect(res).toEqual({ kind: "malformed", reason: "valor_invalid" });
  });

  test("NaN -> malformed/valor_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ valor: Number.NaN }), { executor: port });
    expect(res).toEqual({ kind: "malformed", reason: "valor_invalid" });
  });

  test("Infinity -> malformed/valor_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ valor: Number.POSITIVE_INFINITY }), { executor: port });
    expect(res).toEqual({ kind: "malformed", reason: "valor_invalid" });
  });

  test("acima do limite -> malformed/valor_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ valor: EXPENSE_MAX_VALOR + 1 }), { executor: port });
    expect(res).toEqual({ kind: "malformed", reason: "valor_invalid" });
  });

  test("fração de centavo 10.999 -> malformed/valor_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ valor: 10.999 }), { executor: port });
    expect(res).toEqual({ kind: "malformed", reason: "valor_invalid" });
  });

  test("não-number -> malformed/valor_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(
      baseInput({ valor: "10" as unknown as number }),
      { executor: port },
    );
    expect(res).toEqual({ kind: "malformed", reason: "valor_invalid" });
  });
});

// ---------------------------------------------------------------------------
// descricao
// ---------------------------------------------------------------------------

describe("descricao", () => {
  test("undefined -> descricao null no comando", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const input = baseInput();
    delete (input as { descricao?: unknown }).descricao;
    const res = await executeConfirmedExpenseCreate(input, { executor: port });
    expect(res.kind).toBe("completed");
    expect(calls[0].descricao).toBeNull();
  });

  test("null -> descricao null no comando", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ descricao: null }), { executor: port });
    expect(res.kind).toBe("completed");
    expect(calls[0].descricao).toBeNull();
  });

  test("string normal é passada trim aplicado", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ descricao: "  posto shell  " }), { executor: port });
    expect(res.kind).toBe("completed");
    expect(calls[0].descricao).toBe("posto shell");
  });

  test("string vazia -> null", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput({ descricao: "   " }), { executor: port });
    expect(res.kind).toBe("completed");
    expect(calls[0].descricao).toBeNull();
  });

  test("string > 500 chars -> malformed/descricao_invalid", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const long = "a".repeat(501);
    const res = await executeConfirmedExpenseCreate(baseInput({ descricao: long }), { executor: port });
    expect(res).toEqual({ kind: "malformed", reason: "descricao_invalid" });
    expect(calls.length).toBe(0);
  });

  test("string exatamente 500 chars é aceita", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const ok = "a".repeat(500);
    const res = await executeConfirmedExpenseCreate(baseInput({ descricao: ok }), { executor: port });
    expect(res.kind).toBe("completed");
    expect(calls[0].descricao).toBe(ok);
  });

  test("não-string -> malformed/descricao_invalid", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(
      baseInput({ descricao: 123 as unknown as string }),
      { executor: port },
    );
    expect(res).toEqual({ kind: "malformed", reason: "descricao_invalid" });
  });
});

// ---------------------------------------------------------------------------
// Comando normalizado
// ---------------------------------------------------------------------------

describe("comando normalizado", () => {
  test("actionType fixo, sem hash/actionExecutionId/timestamp vazando", async () => {
    const { port, calls } = makeExecutor({ kind: "applied", actionExecutionId: "aei-1", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(calls.length).toBe(1);
    const cmd = calls[0];
    expect(cmd.actionType).toBe(EXPENSE_CREATE_ACTION_TYPE);
    const cmdKeys = new Set(Object.keys(cmd));
    const allowed = new Set<keyof ExpenseCreateExecutionCommand>([
      "actionType",
      "draftId",
      "conversationStateId",
      "confirmationMessageId",
      "sourceMessageId",
      "queueItemId",
      "userId",
      "contactId",
      "vehicleId",
      "categoria",
      "valor",
      "descricao",
      "expectedStateVersion",
      "orchestratorVersion",
    ]);
    for (const k of cmdKeys) {
      expect(allowed.has(k as keyof ExpenseCreateExecutionCommand)).toBe(true);
    }
    // Nenhum campo proibido:
    expect(cmdKeys.has("actionExecutionId")).toBe(false);
    expect(cmdKeys.has("payloadHash")).toBe(false);
    expect(cmdKeys.has("createdAt")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mapeamento de kinds do executor
// ---------------------------------------------------------------------------

describe("mapeamento executor -> resultado público", () => {
  test("applied -> completed", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "aei-9", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res).toEqual({ kind: "completed", actionExecutionId: "aei-9", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
  });

  test("replayed -> replayed", async () => {
    const { port } = makeExecutor({ kind: "replayed", actionExecutionId: "aei-9", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res).toEqual({ kind: "replayed", actionExecutionId: "aei-9", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
  });

  test("applied propaga despesaId específico", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "aei-a1", despesaId: "desp-applied-1", valor: 149.9, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res).toEqual({ kind: "completed", actionExecutionId: "aei-a1", despesaId: "desp-applied-1", valor: 149.9, categoria: "Combustível" });
  });

  test("replayed propaga despesaId específico", async () => {
    const { port } = makeExecutor({ kind: "replayed", actionExecutionId: "aei-r1", despesaId: "desp-replayed-2", valor: 149.9, categoria: "Combustível" });
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res).toEqual({ kind: "replayed", actionExecutionId: "aei-r1", despesaId: "desp-replayed-2", valor: 149.9, categoria: "Combustível" });
  });

  test("rejected/categoria_invalid vindo do executor -> passthrough", async () => {
    const { port } = makeExecutor({ kind: "rejected", reason: "categoria_invalid" });
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res).toEqual({ kind: "rejected", reason: "categoria_invalid" });
  });

  test("rejected/valor_invalid vindo do executor -> passthrough", async () => {
    const { port } = makeExecutor({ kind: "rejected", reason: "valor_invalid" });
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res).toEqual({ kind: "rejected", reason: "valor_invalid" });
  });

  const rejReasons = [
    "contact_missing",
    "contact_unlinked",
    "vehicle_not_found",
    "vehicle_not_owned",
    "vehicle_archived",
    "invariant_violation",
  ] as const;
  for (const r of rejReasons) {
    test(`rejected/${r}`, async () => {
      const { port } = makeExecutor({ kind: "rejected", reason: r });
      const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
      expect(res).toEqual({ kind: "rejected", reason: r });
    });
  }

  const confReasons = [
    "state_version_conflict",
    "idempotency_payload_mismatch",
    "action_execution_conflict",
  ] as const;
  for (const r of confReasons) {
    test(`conflicted/${r} sem currentStateVersion`, async () => {
      const { port } = makeExecutor({ kind: "conflicted", reason: r });
      const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
      expect(res).toEqual({ kind: "conflicted", reason: r });
    });
    test(`conflicted/${r} com currentStateVersion`, async () => {
      const { port } = makeExecutor({ kind: "conflicted", reason: r, currentStateVersion: 7 });
      const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
      expect(res).toEqual({ kind: "conflicted", reason: r, currentStateVersion: 7 });
    });
  }

  const trReasons = ["executor_unavailable", "database_unavailable"] as const;
  for (const r of trReasons) {
    test(`transient_error/${r} -> transient_failure`, async () => {
      const { port } = makeExecutor({ kind: "transient_error", reason: r });
      const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
      expect(res).toEqual({ kind: "transient_failure", reason: r });
    });
  }
});

// ---------------------------------------------------------------------------
// Exceptions -> outcome_unknown
// ---------------------------------------------------------------------------

describe("exceptions do executor -> outcome_unknown", () => {
  test("Error genérico -> Error", async () => {
    const { port, calls } = makeThrowingExecutor(new Error("boom"));
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res).toEqual({ kind: "outcome_unknown", errorCategory: "Error" });
    expect(calls.length).toBe(1);
  });

  test("TypeError -> TypeError", async () => {
    const { port, calls } = makeThrowingExecutor(new TypeError("bad"));
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res).toEqual({ kind: "outcome_unknown", errorCategory: "TypeError" });
    expect(calls.length).toBe(1);
  });

  test("objeto não-Error -> Object", async () => {
    const { port, calls } = makeThrowingExecutor({ foo: 1 });
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res.kind).toBe("outcome_unknown");
    expect((res as { errorCategory: string }).errorCategory).toBe("Object");
    expect(calls.length).toBe(1);
  });

  test("classe customizada -> nome da classe", async () => {
    class MyCustomErr extends Error {}
    const { port, calls } = makeThrowingExecutor(new MyCustomErr("x"));
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res).toEqual({ kind: "outcome_unknown", errorCategory: "MyCustomErr" });
    expect(calls.length).toBe(1);
  });

  test("null -> null", async () => {
    const { port } = makeThrowingExecutor(null);
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(res).toEqual({ kind: "outcome_unknown", errorCategory: "null" });
  });

  test("executor chamado uma única vez mesmo lançando", async () => {
    let count = 0;
    const port: ExpenseCreateExecutorPort = {
      async executeExpenseCreate() {
        count++;
        throw new Error("x");
      },
    };
    await executeConfirmedExpenseCreate(baseInput(), { executor: port });
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Logs sanitizados
// ---------------------------------------------------------------------------

describe("logs sanitizados", () => {
  test("fluxo applied: só campos do whitelist, nada de dado sensível", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "aei-1", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const { logger, entries } = makeLogger();
    await executeConfirmedExpenseCreate(baseInput({ descricao: "posto shell" }), { executor: port, logger });
    expect(entries.length).toBeGreaterThan(0);
    assertLogsSanitized(entries);
    const events = entries.map((e) => e.event);
    expect(events).toContain("expense_create_started");
    expect(events).toContain("expense_create_dispatched");
    expect(events).toContain("expense_create_completed");
  });

  test("fluxo malformed: só started + validation_failed", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 1, categoria: "Combustível" });
    const { logger, entries } = makeLogger();
    await executeConfirmedExpenseCreate(baseInput({ valor: -1 }), { executor: port, logger });
    assertLogsSanitized(entries);
    const events = entries.map((e) => e.event);
    expect(events).toContain("expense_create_started");
    expect(events).toContain("expense_create_validation_failed");
    expect(events).not.toContain("expense_create_dispatched");
  });

  test("fluxo exception: outcome_unknown com reasonCode = categoria da classe", async () => {
    const { port } = makeThrowingExecutor(new TypeError("x"));
    const { logger, entries } = makeLogger();
    await executeConfirmedExpenseCreate(baseInput(), { executor: port, logger });
    assertLogsSanitized(entries);
    const outcome = entries.find((e) => e.event === "expense_create_outcome_unknown");
    expect(outcome).toBeDefined();
    expect(outcome?.reasonCode).toBe("TypeError");
  });

  test("logger que lança exception não afeta fluxo", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "aei", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const logger: ConfirmedExpenseCreateLogger = {
      log() {
        throw new Error("logger boom");
      },
    };
    const res = await executeConfirmedExpenseCreate(baseInput(), { executor: port, logger });
    expect(res.kind).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Clock injetável
// ---------------------------------------------------------------------------

describe("clock injetável", () => {
  test("durationMs usa o clock injetado", async () => {
    const { port } = makeExecutor({ kind: "applied", actionExecutionId: "a", despesaId: "desp-0001", valor: 149.9, categoria: "Combustível" });
    const { logger, entries } = makeLogger();
    let t = 1000;
    const clock = () => {
      const now = t;
      t += 25;
      return now;
    };
    await executeConfirmedExpenseCreate(baseInput(), { executor: port, logger, clock });
    const completed = entries.find((e) => e.event === "expense_create_completed");
    expect(completed?.durationMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Segurança estática
// ---------------------------------------------------------------------------

describe("segurança estática", () => {
  const forbidden = [
    "@supabase/supabase-js",
    "createClient",
    "Deno.env",
    "process.env",
    "fetch(",
    "React",
    "node:crypto",
  ];

  test("expense-service.ts não contém importações proibidas", () => {
    const src = readFileSync(SERVICE_PATH, "utf-8");
    for (const f of forbidden) {
      expect(src).not.toContain(f);
    }
  });

  test("expense-types.ts não contém importações proibidas", () => {
    const src = readFileSync(TYPES_PATH, "utf-8");
    for (const f of forbidden) {
      expect(src).not.toContain(f);
    }
  });

  test("expense-service.ts / expense-types.ts não mencionam outras ações", () => {
    const otherActions = ["km_update", "maintenance_register", "applyTransition", "claimItems", "releaseItem"];
    for (const path of [SERVICE_PATH, TYPES_PATH]) {
      const src = readFileSync(path, "utf-8");
      for (const kw of otherActions) {
        expect(src).not.toContain(kw);
      }
    }
  });
});
