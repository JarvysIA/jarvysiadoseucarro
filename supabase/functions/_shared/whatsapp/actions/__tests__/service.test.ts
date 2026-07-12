// Build 5.7F2E1A — Testes puros e mockados do executeConfirmedKmUpdate.
// Runner: bun test. Sem rede, sem banco, sem Supabase.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  executeConfirmedKmUpdate,
} from "../service.ts";
import {
  KM_MAX_VALUE,
  KM_UPDATE_ACTION_TYPE,
  type ConfirmedKmUpdateInput,
  type ConfirmedKmUpdateLogFields,
  type ConfirmedKmUpdateLogger,
  type KmUpdateExecutionCommand,
  type KmUpdateExecutorPort,
  type KmUpdateExecutorResult,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_PATH = resolve(HERE, "../service.ts");
const TYPES_PATH = resolve(HERE, "../types.ts");

function baseInput(overrides: Partial<ConfirmedKmUpdateInput> = {}): ConfirmedKmUpdateInput {
  return {
    draftId: "draft-1",
    conversationStateId: "cs-1",
    confirmationMessageId: "cm-1",
    sourceMessageId: "sm-1",
    queueItemId: "q-1",
    userId: "u-1",
    contactId: "c-1",
    vehicleId: "v-1",
    expectedPreviousKm: 10000,
    newKm: 12000,
    correctionConfirmed: false,
    correctionReason: null,
    expectedStateVersion: 3,
    orchestratorVersion: "5.7f2e1a",
    ...overrides,
  };
}

type ExecutorCall = { command: KmUpdateExecutionCommand };

function makeExecutor(
  result: KmUpdateExecutorResult | Error,
): { port: KmUpdateExecutorPort; calls: ExecutorCall[] } {
  const calls: ExecutorCall[] = [];
  const port: KmUpdateExecutorPort = {
    executeKmUpdate: (command) => {
      calls.push({ command });
      if (result instanceof Error) {
        return Promise.reject(result);
      }
      return Promise.resolve(result);
    },
  };
  return { port, calls };
}

function makeThrowingExecutor(err: unknown): {
  port: KmUpdateExecutorPort;
  calls: ExecutorCall[];
} {
  const calls: ExecutorCall[] = [];
  const port: KmUpdateExecutorPort = {
    executeKmUpdate: (command) => {
      calls.push({ command });
      return Promise.reject(err);
    },
  };
  return { port, calls };
}

function makeLogger(): {
  logger: ConfirmedKmUpdateLogger;
  entries: ConfirmedKmUpdateLogFields[];
} {
  const entries: ConfirmedKmUpdateLogFields[] = [];
  return {
    entries,
    logger: {
      log(fields) {
        entries.push(fields);
      },
    },
  };
}

const APPLIED: KmUpdateExecutorResult = {
  kind: "applied",
  actionExecutionId: "ae-1",
  previousKm: 10000,
  newKm: 12000,
};

// ---------------------------------------------------------------------------
// A. Validações de string
// ---------------------------------------------------------------------------

describe("A. validações de string obrigatória", () => {
  const requiredIds: Array<keyof ConfirmedKmUpdateInput> = [
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

  for (const key of requiredIds) {
    test(`rejeita '${key}' vazio como malformed/input_invalid`, async () => {
      const { port, calls } = makeExecutor(APPLIED);
      const input = baseInput({ [key]: "" } as Partial<ConfirmedKmUpdateInput>);
      const res = await executeConfirmedKmUpdate(input, { executor: port });
      expect(res.kind).toBe("malformed");
      if (res.kind === "malformed") expect(res.reason).toBe("input_invalid");
      expect(calls.length).toBe(0);
    });

    test(`rejeita '${key}' só com espaços como malformed`, async () => {
      const { port, calls } = makeExecutor(APPLIED);
      const input = baseInput({ [key]: "   " } as Partial<ConfirmedKmUpdateInput>);
      const res = await executeConfirmedKmUpdate(input, { executor: port });
      expect(res.kind).toBe("malformed");
      expect(calls.length).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// B. State version
// ---------------------------------------------------------------------------

describe("B. expectedStateVersion", () => {
  test("aceita zero", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedStateVersion: 0 }),
      { executor: port },
    );
    expect(res.kind).toBe("completed");
    expect(calls[0]!.command.expectedStateVersion).toBe(0);
  });

  test("aceita positivo", async () => {
    const { port } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedStateVersion: 42 }),
      { executor: port },
    );
    expect(res.kind).toBe("completed");
  });

  test("rejeita negativo", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedStateVersion: -1 }),
      { executor: port },
    );
    expect(res.kind).toBe("malformed");
    if (res.kind === "malformed") expect(res.reason).toBe("state_version_invalid");
    expect(calls.length).toBe(0);
  });

  test("rejeita decimal", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedStateVersion: 1.5 }),
      { executor: port },
    );
    expect(res.kind).toBe("malformed");
    expect(calls.length).toBe(0);
  });

  test("rejeita NaN", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedStateVersion: Number.NaN }),
      { executor: port },
    );
    expect(res.kind).toBe("malformed");
    expect(calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C. newKm
// ---------------------------------------------------------------------------

describe("C. newKm", () => {
  const okCases: Array<[string, number]> = [
    ["zero", 0],
    ["um", 1],
    ["aumento normal", 20000],
    ["limite integer", KM_MAX_VALUE],
  ];
  for (const [label, value] of okCases) {
    test(`aceita ${label}`, async () => {
      const { port, calls } = makeExecutor({
        ...APPLIED,
        newKm: value,
      });
      const res = await executeConfirmedKmUpdate(
        baseInput({ newKm: value, expectedPreviousKm: null }),
        { executor: port },
      );
      expect(res.kind).toBe("completed");
      expect(calls[0]!.command.newKm).toBe(value);
    });
  }

  const badCases: Array<[string, unknown]> = [
    ["negativo", -1],
    ["decimal", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["acima do integer", KM_MAX_VALUE + 1],
  ];
  for (const [label, value] of badCases) {
    test(`rejeita ${label} como malformed/km_invalid`, async () => {
      const { port, calls } = makeExecutor(APPLIED);
      const res = await executeConfirmedKmUpdate(
        baseInput({ newKm: value as number, expectedPreviousKm: null }),
        { executor: port },
      );
      expect(res.kind).toBe("malformed");
      if (res.kind === "malformed") expect(res.reason).toBe("km_invalid");
      expect(calls.length).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// D. expectedPreviousKm
// ---------------------------------------------------------------------------

describe("D. expectedPreviousKm", () => {
  test("null aceito", async () => {
    const { port } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedPreviousKm: null, newKm: 100 }),
      { executor: port },
    );
    expect(res.kind).toBe("completed");
  });

  test("zero aceito", async () => {
    const { port } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedPreviousKm: 0, newKm: 100 }),
      { executor: port },
    );
    expect(res.kind).toBe("completed");
  });

  test("positivo aceito", async () => {
    const { port } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedPreviousKm: 100, newKm: 200 }),
      { executor: port },
    );
    expect(res.kind).toBe("completed");
  });

  test("negativo rejeitado", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedPreviousKm: -1 }),
      { executor: port },
    );
    expect(res.kind).toBe("malformed");
    expect(calls.length).toBe(0);
  });

  test("decimal rejeitado", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedPreviousKm: 100.5 }),
      { executor: port },
    );
    expect(res.kind).toBe("malformed");
    expect(calls.length).toBe(0);
  });

  test("acima do integer rejeitado", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedPreviousKm: KM_MAX_VALUE + 1 }),
      { executor: port },
    );
    expect(res.kind).toBe("malformed");
    expect(calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E. Correção
// ---------------------------------------------------------------------------

describe("E. correção", () => {
  test("newKm menor + correctionConfirmed=false -> rejected/correction_not_confirmed, executor não chamado", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({
        expectedPreviousKm: 10000,
        newKm: 5000,
        correctionConfirmed: false,
      }),
      { executor: port },
    );
    expect(res.kind).toBe("rejected");
    if (res.kind === "rejected") expect(res.reason).toBe("correction_not_confirmed");
    expect(calls.length).toBe(0);
  });

  test("newKm menor + correctionConfirmed=true -> executor chamado com isCorrection=true", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({
        expectedPreviousKm: 10000,
        newKm: 5000,
        correctionConfirmed: true,
      }),
      { executor: port },
    );
    expect(res.kind).toBe("completed");
    expect(calls.length).toBe(1);
    expect(calls[0]!.command.isCorrection).toBe(true);
    expect(calls[0]!.command.correctionConfirmed).toBe(true);
  });

  test("newKm maior -> isCorrection=false mesmo com correctionConfirmed=true", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({
        expectedPreviousKm: 10000,
        newKm: 12000,
        correctionConfirmed: true,
      }),
      { executor: port },
    );
    expect(res.kind).toBe("completed");
    expect(calls[0]!.command.isCorrection).toBe(false);
  });

  test("expectedPreviousKm=null -> isCorrection=false", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    await executeConfirmedKmUpdate(
      baseInput({ expectedPreviousKm: null, newKm: 5000, correctionConfirmed: true }),
      { executor: port },
    );
    expect(calls[0]!.command.isCorrection).toBe(false);
  });

  test("correctionReason string vazia é rejeitada como correction_reason_invalid", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(
      baseInput({ correctionReason: "   " }),
      { executor: port },
    );
    expect(res.kind).toBe("malformed");
    if (res.kind === "malformed") expect(res.reason).toBe("correction_reason_invalid");
    expect(calls.length).toBe(0);
  });

  test("correctionReason válido é preservado no comando", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    await executeConfirmedKmUpdate(
      baseInput({
        expectedPreviousKm: 10000,
        newKm: 5000,
        correctionConfirmed: true,
        correctionReason: "hodômetro trocado",
      }),
      { executor: port },
    );
    expect(calls[0]!.command.correctionReason).toBe("hodômetro trocado");
  });
});

// ---------------------------------------------------------------------------
// F. KM igual
// ---------------------------------------------------------------------------

describe("F. KM igual", () => {
  test("executor é chamado quando newKm === expectedPreviousKm", async () => {
    const result: KmUpdateExecutorResult = {
      kind: "no_op",
      actionExecutionId: "ae-noop",
      currentKm: 10000,
    };
    const { port, calls } = makeExecutor(result);
    const res = await executeConfirmedKmUpdate(
      baseInput({ expectedPreviousKm: 10000, newKm: 10000 }),
      { executor: port },
    );
    expect(calls.length).toBe(1);
    expect(calls[0]!.command.isCorrection).toBe(false);
    expect(res.kind).toBe("no_op");
    if (res.kind === "no_op") {
      expect(res.actionExecutionId).toBe("ae-noop");
      expect(res.currentKm).toBe(10000);
    }
  });
});

// ---------------------------------------------------------------------------
// G. Comando normalizado
// ---------------------------------------------------------------------------

describe("G. comando normalizado", () => {
  test("actionType fixo em km_update; nenhum hash/actionExecutionId/timestamp; ids preservados", async () => {
    const { port, calls } = makeExecutor(APPLIED);
    const input = baseInput();
    await executeConfirmedKmUpdate(input, { executor: port });
    const cmd = calls[0]!.command;
    expect(cmd.actionType).toBe(KM_UPDATE_ACTION_TYPE);
    expect(cmd.draftId).toBe(input.draftId);
    expect(cmd.conversationStateId).toBe(input.conversationStateId);
    expect(cmd.confirmationMessageId).toBe(input.confirmationMessageId);
    expect(cmd.sourceMessageId).toBe(input.sourceMessageId);
    expect(cmd.queueItemId).toBe(input.queueItemId);
    expect(cmd.userId).toBe(input.userId);
    expect(cmd.contactId).toBe(input.contactId);
    expect(cmd.vehicleId).toBe(input.vehicleId);
    expect(cmd.expectedPreviousKm).toBe(input.expectedPreviousKm);
    expect(cmd.newKm).toBe(input.newKm);
    expect(cmd.correctionConfirmed).toBe(input.correctionConfirmed);
    expect(cmd.expectedStateVersion).toBe(input.expectedStateVersion);
    expect(cmd.orchestratorVersion).toBe(input.orchestratorVersion);

    const keys = Object.keys(cmd);
    expect(keys.includes("hash")).toBe(false);
    expect(keys.includes("payloadHash")).toBe(false);
    expect(keys.includes("requestHash")).toBe(false);
    expect(keys.includes("actionExecutionId")).toBe(false);
    expect(keys.includes("timestamp")).toBe(false);
    expect(keys.includes("startedAt")).toBe(false);
    expect(keys.includes("completedAt")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// H. Mapeamento de resultados
// ---------------------------------------------------------------------------

describe("H. mapeamento de resultados", () => {
  test("applied -> completed", async () => {
    const { port } = makeExecutor(APPLIED);
    const res = await executeConfirmedKmUpdate(baseInput(), { executor: port });
    expect(res.kind).toBe("completed");
    if (res.kind === "completed") {
      expect(res.actionExecutionId).toBe("ae-1");
      expect(res.previousKm).toBe(10000);
      expect(res.newKm).toBe(12000);
    }
  });

  test("replayed -> replayed com noChange preservado", async () => {
    const { port } = makeExecutor({
      kind: "replayed",
      actionExecutionId: "ae-r",
      previousKm: 10000,
      newKm: 12000,
      noChange: false,
    });
    const res = await executeConfirmedKmUpdate(baseInput(), { executor: port });
    expect(res.kind).toBe("replayed");
    if (res.kind === "replayed") {
      expect(res.actionExecutionId).toBe("ae-r");
      expect(res.noChange).toBe(false);
    }
  });

  test("no_op -> no_op", async () => {
    const { port } = makeExecutor({
      kind: "no_op",
      actionExecutionId: "ae-n",
      currentKm: 500,
    });
    const res = await executeConfirmedKmUpdate(baseInput(), { executor: port });
    expect(res.kind).toBe("no_op");
  });

  const rejectedReasons = [
    "action_not_confirmed",
    "action_kind_invalid",
    "contact_missing",
    "contact_unlinked",
    "vehicle_not_found",
    "vehicle_not_owned",
    "vehicle_archived",
    "km_invalid",
    "correction_not_confirmed",
    "invariant_violation",
  ] as const;

  for (const reason of rejectedReasons) {
    test(`rejected/${reason} preservado`, async () => {
      const { port } = makeExecutor({ kind: "rejected", reason });
      const res = await executeConfirmedKmUpdate(baseInput(), { executor: port });
      expect(res.kind).toBe("rejected");
      if (res.kind === "rejected") expect(res.reason).toBe(reason);
    });
  }

  const conflictReasons = [
    "km_conflict",
    "state_version_conflict",
    "idempotency_payload_mismatch",
    "action_execution_conflict",
  ] as const;

  for (const reason of conflictReasons) {
    test(`conflicted/${reason} preservado`, async () => {
      const { port } = makeExecutor({
        kind: "conflicted",
        reason,
        currentKm: 999,
        currentStateVersion: 7,
      });
      const res = await executeConfirmedKmUpdate(baseInput(), { executor: port });
      expect(res.kind).toBe("conflicted");
      if (res.kind === "conflicted") {
        expect(res.reason).toBe(reason);
        expect(res.currentKm).toBe(999);
        expect(res.currentStateVersion).toBe(7);
      }
    });
  }

  test("transient_error -> transient_failure", async () => {
    const { port } = makeExecutor({
      kind: "transient_error",
      reason: "database_unavailable",
    });
    const res = await executeConfirmedKmUpdate(baseInput(), { executor: port });
    expect(res.kind).toBe("transient_failure");
    if (res.kind === "transient_failure") expect(res.reason).toBe("database_unavailable");
  });
});

// ---------------------------------------------------------------------------
// I. Exceptions
// ---------------------------------------------------------------------------

describe("I. exceptions do executor -> outcome_unknown", () => {
  test("Error genérico", async () => {
    const { port, calls } = makeThrowingExecutor(new Error("segredo do banco vazou"));
    const { logger, entries } = makeLogger();
    const res = await executeConfirmedKmUpdate(baseInput(), {
      executor: port,
      logger,
    });
    expect(res.kind).toBe("outcome_unknown");
    if (res.kind === "outcome_unknown") expect(res.errorCategory).toBe("Error");
    expect(calls.length).toBe(1);
    const serialized = JSON.stringify(entries);
    expect(serialized.includes("segredo")).toBe(false);
  });

  test("TypeError", async () => {
    const { port } = makeThrowingExecutor(new TypeError("boom"));
    const res = await executeConfirmedKmUpdate(baseInput(), { executor: port });
    expect(res.kind).toBe("outcome_unknown");
    if (res.kind === "outcome_unknown") expect(res.errorCategory).toBe("TypeError");
  });

  test("objeto não Error", async () => {
    const { port } = makeThrowingExecutor({ weird: true });
    const res = await executeConfirmedKmUpdate(baseInput(), { executor: port });
    expect(res.kind).toBe("outcome_unknown");
  });

  test("classe customizada", async () => {
    class MyDbError extends Error {}
    const { port } = makeThrowingExecutor(new MyDbError("x"));
    const res = await executeConfirmedKmUpdate(baseInput(), { executor: port });
    expect(res.kind).toBe("outcome_unknown");
    if (res.kind === "outcome_unknown") expect(res.errorCategory).toBe("MyDbError");
  });

  test("nenhum retry: executor chamado uma única vez", async () => {
    const { port, calls } = makeThrowingExecutor(new Error("x"));
    await executeConfirmedKmUpdate(baseInput(), { executor: port });
    expect(calls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// J. Logs sanitizados
// ---------------------------------------------------------------------------

// -------- Helpers estruturais de inspeção de logs (test-only) --------
// Chaves de observabilidade permitidas no logger produtivo do E1A.
const ALLOWED_LOG_KEYS = new Set<string>([
  "event",
  "actionType",
  "outcome",
  "reasonCode",
  "isCorrection",
  "durationMs",
]);

// Chaves sensíveis que jamais podem aparecer em nenhum registro (nem aninhadas).
const FORBIDDEN_LOG_KEYS = new Set<string>([
  "draftId",
  "queueItemId",
  "actionExecutionId",
  "confirmationMessageId",
  "sourceMessageId",
  "conversationStateId",
  "userId",
  "contactId",
  "vehicleId",
  "expectedPreviousKm",
  "newKm",
  "correctionReason",
  "correctionConfirmed",
  "expectedStateVersion",
  "orchestratorVersion",
  "payload",
  "input",
  "metadata",
  "phone",
  "plate",
  "message",
  "body",
]);

type LogLeak =
  | { kind: "forbidden_key"; path: string }
  | { kind: "unknown_key"; path: string; key: string }
  | { kind: "sensitive_string"; path: string; needle: string }
  | { kind: "sensitive_number"; path: string; value: number }
  | { kind: "invalid_duration"; path: string; value: unknown };

function findLogLeaks(
  entries: readonly unknown[],
  sensitiveStrings: readonly string[],
  sensitiveNumbers: readonly number[],
): LogLeak[] {
  const leaks: LogLeak[] = [];

  function walk(value: unknown, path: string, insideDurationMs: boolean): void {
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      for (const s of sensitiveStrings) {
        if (s.length > 0 && value.includes(s)) {
          leaks.push({ kind: "sensitive_string", path, needle: s });
        }
      }
      return;
    }
    if (typeof value === "number") {
      if (!insideDurationMs) {
        for (const n of sensitiveNumbers) {
          if (value === n) leaks.push({ kind: "sensitive_number", path, value });
        }
      }
      return;
    }
    if (typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`, insideDurationMs));
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path === "" ? k : `${path}.${k}`;
      if (FORBIDDEN_LOG_KEYS.has(k)) {
        leaks.push({ kind: "forbidden_key", path: childPath });
      }
      // Somente no nível da entrada validamos o whitelist estrito de chaves.
      if (path.match(/^entries\[\d+\]$/)) {
        if (!ALLOWED_LOG_KEYS.has(k)) {
          leaks.push({ kind: "unknown_key", path: childPath, key: k });
        }
      }
      if (k === "durationMs") {
        if (
          typeof v !== "number" ||
          !Number.isFinite(v) ||
          v < 0
        ) {
          leaks.push({ kind: "invalid_duration", path: childPath, value: v });
        }
        walk(v, childPath, true);
      } else {
        walk(v, childPath, insideDurationMs);
      }
    }
  }

  entries.forEach((e, i) => walk(e, `entries[${i}]`, false));
  return leaks;
}

describe("J. logs sanitizados", () => {
  // Sentinelas distintivos e improváveis de colidir com qualquer campo legítimo
  // (em particular, com durationMs, que é sub-segundo em ms).
  const SENTINEL = {
    draftId: "sentinel-draft-9f4e2a11-0001",
    conversationStateId: "sentinel-cs-9f4e2a11-0002",
    confirmationMessageId: "sentinel-cm-9f4e2a11-0003",
    sourceMessageId: "sentinel-sm-9f4e2a11-0004",
    queueItemId: "sentinel-q-9f4e2a11-0005",
    userId: "sentinel-user-9f4e2a11-0006",
    contactId: "sentinel-contact-9f4e2a11-0007",
    vehicleId: "sentinel-vehicle-9f4e2a11-0008",
    correctionReason: "sentinel-reason-9f4e2a11-hodômetro",
    orchestratorVersion: "sentinel-orch-9f4e2a11-0009",
    expectedPreviousKm: 987654321,
    newKm: 876543212,
  };

  // Strings sensíveis: apenas as que NÃO podem aparecer sob nenhuma chave.
  // draftId/queueItemId são chaves permitidas do contrato, portanto seus
  // valores podem aparecer legitimamente e são omitidos desta lista.
  const SENSITIVE_STRINGS = [
    SENTINEL.conversationStateId,
    SENTINEL.confirmationMessageId,
    SENTINEL.sourceMessageId,
    SENTINEL.userId,
    SENTINEL.contactId,
    SENTINEL.vehicleId,
    SENTINEL.correctionReason,
    SENTINEL.orchestratorVersion,
  ];
  const SENSITIVE_NUMBERS = [SENTINEL.expectedPreviousKm, SENTINEL.newKm];

  test("nenhum campo sensível aparece em logs em fluxo completo (validação estrutural)", async () => {
    const { port } = makeExecutor(APPLIED);
    const { logger, entries } = makeLogger();
    const input = baseInput({
      draftId: SENTINEL.draftId,
      conversationStateId: SENTINEL.conversationStateId,
      confirmationMessageId: SENTINEL.confirmationMessageId,
      sourceMessageId: SENTINEL.sourceMessageId,
      queueItemId: SENTINEL.queueItemId,
      userId: SENTINEL.userId,
      contactId: SENTINEL.contactId,
      vehicleId: SENTINEL.vehicleId,
      expectedPreviousKm: SENTINEL.expectedPreviousKm,
      newKm: SENTINEL.newKm,
      correctionReason: SENTINEL.correctionReason,
      orchestratorVersion: SENTINEL.orchestratorVersion,
    });
    await executeConfirmedKmUpdate(input, { executor: port, logger });

    const leaks = findLogLeaks(entries, SENSITIVE_STRINGS, SENSITIVE_NUMBERS);
    expect(leaks).toEqual([]);

    // durationMs estruturalmente válido em toda entrada que o carregue.
    for (const entry of entries) {
      if ("durationMs" in entry) {
        const d = (entry as { durationMs: unknown }).durationMs;
        expect(typeof d).toBe("number");
        expect(Number.isFinite(d as number)).toBe(true);
        expect((d as number) >= 0).toBe(true);
        // durationMs jamais pode coincidir com KMs sentinela.
        expect(d).not.toBe(SENTINEL.expectedPreviousKm);
        expect(d).not.toBe(SENTINEL.newKm);
      }
      // Whitelist de chaves por entrada.
      for (const k of Object.keys(entry as Record<string, unknown>)) {
        expect(ALLOWED_LOG_KEYS.has(k)).toBe(true);
      }
    }
  });

  test("helper findLogLeaks detecta vazamento real (auto-verificação)", () => {
    // Chave sensível aninhada
    const withForbiddenKey = [{ event: "x", userId: "u" }];
    const leaksKey = findLogLeaks(withForbiddenKey, [], []);
    expect(leaksKey.some((l) => l.kind === "forbidden_key")).toBe(true);

    // String sensível em campo permitido
    const withSensitiveString = [
      { event: `payload=${SENTINEL.userId}`, actionType: "km_update" },
    ];
    const leaksStr = findLogLeaks(withSensitiveString, [SENTINEL.userId], []);
    expect(leaksStr.some((l) => l.kind === "sensitive_string")).toBe(true);

    // Número sensível em campo diferente de durationMs
    const withSensitiveNumber = [
      { event: "x", actionType: "km_update", reasonCode: "r", isCorrection: false, someNum: SENTINEL.newKm },
    ] as unknown as ConfirmedKmUpdateLogFields[];
    const leaksNum = findLogLeaks(withSensitiveNumber, [], [SENTINEL.newKm]);
    expect(leaksNum.some((l) => l.kind === "sensitive_number")).toBe(true);

    // Chave desconhecida (fora do whitelist) no nível da entrada
    const withUnknownKey = [{ event: "x", weirdField: 1 }];
    const leaksUnknown = findLogLeaks(withUnknownKey, [], []);
    expect(leaksUnknown.some((l) => l.kind === "unknown_key")).toBe(true);

    // durationMs inválido
    const withBadDuration = [{ event: "x", durationMs: -1 }];
    const leaksDur = findLogLeaks(withBadDuration, [], []);
    expect(leaksDur.some((l) => l.kind === "invalid_duration")).toBe(true);

    // Logs limpos não produzem vazamento
    const clean = [
      { event: "km_update_started", actionType: "km_update" },
      {
        event: "km_update_completed",
        actionType: "km_update",
        outcome: "completed",
        isCorrection: false,
        durationMs: 0.123,
        draftId: "d",
        queueItemId: "q",
        actionExecutionId: "ae",
      },
    ] as unknown as ConfirmedKmUpdateLogFields[];
    const noLeaks = findLogLeaks(clean, [SENTINEL.userId], [SENTINEL.newKm]);
    expect(noLeaks).toEqual([]);
  });

  test("logs contêm evento started e completed no fluxo feliz", async () => {
    const { port } = makeExecutor(APPLIED);
    const { logger, entries } = makeLogger();
    await executeConfirmedKmUpdate(baseInput(), { executor: port, logger });
    const events = entries.map((e) => e.event);
    expect(events.includes("km_update_started")).toBe(true);
    expect(events.includes("km_update_dispatched")).toBe(true);
    expect(events.includes("km_update_completed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// K. Segurança estática do código-fonte
// ---------------------------------------------------------------------------

describe("K. segurança estática", () => {
  const forbiddenPatterns = [
    "@supabase/supabase-js",
    "createClient",
    "Deno.env",
    "process.env",
    "openai",
    "OpenAI",
    "provider",
    "sender",
    "localStorage",
    "React",
    "node:crypto",
    "crypto.subtle",
  ];

  test("service.ts não contém imports/padrões proibidos", () => {
    const source = readFileSync(SERVICE_PATH, "utf8");
    for (const p of forbiddenPatterns) {
      expect(source.includes(p)).toBe(false);
    }
    expect(/\bfetch\s*\(/.test(source)).toBe(false);
  });

  test("types.ts não contém imports/padrões proibidos", () => {
    const source = readFileSync(TYPES_PATH, "utf8");
    for (const p of forbiddenPatterns) {
      expect(source.includes(p)).toBe(false);
    }
    expect(/\bfetch\s*\(/.test(source)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// L. Foco de escopo
// ---------------------------------------------------------------------------

describe("L. foco de escopo", () => {
  const outOfScope = [
    "expense_create",
    "maintenance_register",
    "select_vehicle",
    "applyTransition",
    "releaseItem",
    "claimItems",
  ];
  test("service.ts trata somente km_update", () => {
    const src = readFileSync(SERVICE_PATH, "utf8");
    for (const p of outOfScope) {
      expect(src.includes(p)).toBe(false);
    }
  });
  test("types.ts trata somente km_update", () => {
    const src = readFileSync(TYPES_PATH, "utf8");
    for (const p of outOfScope) {
      expect(src.includes(p)).toBe(false);
    }
  });
});
