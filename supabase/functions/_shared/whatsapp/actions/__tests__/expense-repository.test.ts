// Build expense-repository — Testes do Repository
// execute_whatsapp_expense_create. Runner: bun test. Sem rede, sem banco.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { ExpenseCreateExecutionCommand } from "../expense-types.ts";
import {
  ExpenseActionMalformedResponseError,
  ExpenseActionRpcExceptionError,
  ExpenseActionTransportError,
  ExpenseActionUnknownResultError,
  WhatsappExpenseActionRepository,
  parseExecuteExpenseCreate,
  type ExpenseActionRpcInvoker,
  type ExpenseActionSupabaseLike,
} from "../expense-repository.ts";

// ---------- fixtures ----------

const UUID_DRAFT = "11111111-1111-1111-1111-111111111111";
const UUID_STATE = "22222222-2222-2222-2222-222222222222";
const UUID_CONF = "33333333-3333-3333-3333-333333333333";
const UUID_SRC = "44444444-4444-4444-4444-444444444444";
const UUID_QUEUE = "55555555-5555-5555-5555-555555555555";
const UUID_USER = "66666666-6666-6666-6666-666666666666";
const UUID_CONTACT = "77777777-7777-7777-7777-777777777777";
const UUID_VEHICLE = "88888888-8888-8888-8888-888888888888";
const UUID_EXEC = "99999999-9999-9999-9999-999999999999";
const UUID_DESP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const CMD: ExpenseCreateExecutionCommand = {
  actionType: "expense_create",
  draftId: UUID_DRAFT,
  conversationStateId: UUID_STATE,
  confirmationMessageId: UUID_CONF,
  sourceMessageId: UUID_SRC,
  queueItemId: UUID_QUEUE,
  userId: UUID_USER,
  contactId: UUID_CONTACT,
  vehicleId: UUID_VEHICLE,
  categoria: "Combustível",
  valor: 149.9,
  descricao: "posto shell",
  expectedStateVersion: 3,
  orchestratorVersion: "v1",
};

type RpcCall = { fn: string; params: Record<string, unknown> };

function makeClient(
  payload: unknown | Error,
): { client: ExpenseActionSupabaseLike; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const invoker: ExpenseActionRpcInvoker = async (fn, params) => {
    calls.push({ fn, params });
    if (payload instanceof Error) throw payload;
    return { data: payload as never, error: null };
  };
  return { client: { rpc: invoker }, calls };
}

function makeErrClient(
  code: string | null,
  message: string,
): ExpenseActionSupabaseLike {
  const invoker: ExpenseActionRpcInvoker = async () => {
    return { data: null, error: { code, message } };
  };
  return { rpc: invoker };
}

// ============================================================
// applied / replayed
// ============================================================

describe("kinds felizes", () => {
  test("applied com todos os campos", async () => {
    const { client } = makeClient({
      kind: "applied",
      actionExecutionId: UUID_EXEC,
      despesaId: UUID_DESP,
      valor: 149.9,
      categoria: "Combustível",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    const r = await repo.executeExpenseCreate(CMD);
    expect(r).toEqual({
      kind: "applied",
      actionExecutionId: UUID_EXEC,
      despesaId: UUID_DESP,
      valor: 149.9,
      categoria: "Combustível",
    });
  });

  test("applied com valor inteiro", async () => {
    const { client } = makeClient({
      kind: "applied",
      actionExecutionId: UUID_EXEC,
      despesaId: UUID_DESP,
      valor: 80,
      categoria: "Lavagem",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    const r = await repo.executeExpenseCreate(CMD);
    expect(r.kind).toBe("applied");
  });

  test("applied aceita payload como array de 1 elemento", async () => {
    const { client } = makeClient([
      {
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        despesaId: UUID_DESP,
        valor: 12,
        categoria: "IPVA",
      },
    ]);
    const repo = new WhatsappExpenseActionRepository(client);
    const r = await repo.executeExpenseCreate(CMD);
    expect(r.kind).toBe("applied");
  });

  test("replayed com todos os campos", async () => {
    const { client } = makeClient({
      kind: "replayed",
      actionExecutionId: UUID_EXEC,
      despesaId: UUID_DESP,
      valor: 200,
      categoria: "Revisão",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    const r = await repo.executeExpenseCreate(CMD);
    expect(r).toEqual({
      kind: "replayed",
      actionExecutionId: UUID_EXEC,
      despesaId: UUID_DESP,
      valor: 200,
      categoria: "Revisão",
    });
  });
});

// ============================================================
// rejected (8 reasons)
// ============================================================

const REJECTED_REASONS = [
  "contact_missing",
  "contact_unlinked",
  "vehicle_not_found",
  "vehicle_not_owned",
  "vehicle_archived",
  "invariant_violation",
  "categoria_invalid",
  "valor_invalid",
] as const;

describe("rejected", () => {
  for (const reason of REJECTED_REASONS) {
    test(`rejected reason=${reason}`, async () => {
      const { client } = makeClient({ kind: "rejected", reason });
      const repo = new WhatsappExpenseActionRepository(client);
      const r = await repo.executeExpenseCreate(CMD);
      expect(r).toEqual({ kind: "rejected", reason });
    });
  }
});

// ============================================================
// conflicted (2 reasons emitidos pela RPC real)
// ============================================================

describe("conflicted", () => {
  test("state_version_conflict com currentStateVersion", async () => {
    const { client } = makeClient({
      kind: "conflicted",
      reason: "state_version_conflict",
      currentStateVersion: 42,
    });
    const repo = new WhatsappExpenseActionRepository(client);
    const r = await repo.executeExpenseCreate(CMD);
    expect(r).toEqual({
      kind: "conflicted",
      reason: "state_version_conflict",
      currentStateVersion: 42,
    });
  });

  test("action_execution_conflict SEM campos extras", async () => {
    const { client } = makeClient({
      kind: "conflicted",
      reason: "action_execution_conflict",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    const r = await repo.executeExpenseCreate(CMD);
    expect(r).toEqual({
      kind: "conflicted",
      reason: "action_execution_conflict",
    });
    expect((r as Record<string, unknown>).currentStateVersion).toBeUndefined();
  });
});

// ============================================================
// unknown kind / unknown reason
// ============================================================

describe("unknown", () => {
  test("kind desconhecido (no_op não existe pra despesa)", async () => {
    const { client } = makeClient({
      kind: "no_op",
      actionExecutionId: UUID_EXEC,
    });
    const repo = new WhatsappExpenseActionRepository(client);
    await expect(repo.executeExpenseCreate(CMD)).rejects.toBeInstanceOf(
      ExpenseActionUnknownResultError,
    );
  });

  test("kind transient_error desconhecido no repositório", async () => {
    const { client } = makeClient({
      kind: "transient_error",
      reason: "database_unavailable",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    await expect(repo.executeExpenseCreate(CMD)).rejects.toBeInstanceOf(
      ExpenseActionUnknownResultError,
    );
  });

  test("rejected reason desconhecida", async () => {
    const { client } = makeClient({
      kind: "rejected",
      reason: "km_invalid",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    await expect(repo.executeExpenseCreate(CMD)).rejects.toBeInstanceOf(
      ExpenseActionUnknownResultError,
    );
  });

  test("conflicted reason km_conflict (não existe pra despesa)", async () => {
    const { client } = makeClient({
      kind: "conflicted",
      reason: "km_conflict",
      currentKm: 100,
    });
    const repo = new WhatsappExpenseActionRepository(client);
    await expect(repo.executeExpenseCreate(CMD)).rejects.toBeInstanceOf(
      ExpenseActionUnknownResultError,
    );
  });

  test("conflicted reason idempotency_payload_mismatch (não emitido pela RPC)", async () => {
    const { client } = makeClient({
      kind: "conflicted",
      reason: "idempotency_payload_mismatch",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    await expect(repo.executeExpenseCreate(CMD)).rejects.toBeInstanceOf(
      ExpenseActionUnknownResultError,
    );
  });
});

// ============================================================
// malformed
// ============================================================

describe("malformed", () => {
  test("payload nulo", async () => {
    const { client } = makeClient(null);
    const repo = new WhatsappExpenseActionRepository(client);
    await expect(repo.executeExpenseCreate(CMD)).rejects.toBeInstanceOf(
      ExpenseActionMalformedResponseError,
    );
  });

  test("payload não-objeto (número)", () => {
    expect(() => parseExecuteExpenseCreate(42)).toThrow(
      ExpenseActionMalformedResponseError,
    );
  });

  test("payload não-objeto (string)", () => {
    expect(() => parseExecuteExpenseCreate("applied")).toThrow(
      ExpenseActionMalformedResponseError,
    );
  });

  test("array vazio", async () => {
    const { client } = makeClient([]);
    const repo = new WhatsappExpenseActionRepository(client);
    await expect(repo.executeExpenseCreate(CMD)).rejects.toBeInstanceOf(
      ExpenseActionMalformedResponseError,
    );
  });

  test("array com mais de 1 linha", async () => {
    const { client } = makeClient([
      {
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        despesaId: UUID_DESP,
        valor: 1,
        categoria: "Lavagem",
      },
      {
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        despesaId: UUID_DESP,
        valor: 2,
        categoria: "Lavagem",
      },
    ]);
    const repo = new WhatsappExpenseActionRepository(client);
    await expect(repo.executeExpenseCreate(CMD)).rejects.toBeInstanceOf(
      ExpenseActionMalformedResponseError,
    );
  });

  test("applied com despesaId ausente", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        valor: 10,
        categoria: "Lavagem",
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("applied com despesaId null", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        despesaId: null,
        valor: 10,
        categoria: "Lavagem",
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("applied com valor null", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        despesaId: UUID_DESP,
        valor: null,
        categoria: "Lavagem",
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("applied com categoria null", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        despesaId: UUID_DESP,
        valor: 10,
        categoria: null,
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("applied com categoria fora das 8 válidas", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        despesaId: UUID_DESP,
        valor: 10,
        categoria: "Outros",
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("applied com actionExecutionId não-string", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "applied",
        actionExecutionId: 123,
        despesaId: UUID_DESP,
        valor: 10,
        categoria: "Lavagem",
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("applied com valor NaN", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "applied",
        actionExecutionId: UUID_EXEC,
        despesaId: UUID_DESP,
        valor: Number.NaN,
        categoria: "Lavagem",
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("replayed com despesaId null", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "replayed",
        actionExecutionId: UUID_EXEC,
        despesaId: null,
        valor: 10,
        categoria: "Lavagem",
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("replayed com valor null", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "replayed",
        actionExecutionId: UUID_EXEC,
        despesaId: UUID_DESP,
        valor: null,
        categoria: "Lavagem",
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("replayed com categoria null", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "replayed",
        actionExecutionId: UUID_EXEC,
        despesaId: UUID_DESP,
        valor: 10,
        categoria: null,
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("replayed com categoria fora das 8 válidas", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "replayed",
        actionExecutionId: UUID_EXEC,
        despesaId: UUID_DESP,
        valor: 10,
        categoria: "Diversos",
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("rejected sem reason", () => {
    expect(() =>
      parseExecuteExpenseCreate({ kind: "rejected" }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("state_version_conflict sem currentStateVersion", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "conflicted",
        reason: "state_version_conflict",
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });

  test("state_version_conflict com currentStateVersion float", () => {
    expect(() =>
      parseExecuteExpenseCreate({
        kind: "conflicted",
        reason: "state_version_conflict",
        currentStateVersion: 1.5,
      }),
    ).toThrow(ExpenseActionMalformedResponseError);
  });
});

// ============================================================
// erros de transporte / RPC
// ============================================================

describe("transporte / RPC", () => {
  test("response.error preenchido -> ExpenseActionRpcExceptionError", async () => {
    const repo = new WhatsappExpenseActionRepository(
      makeErrClient("P0001", "boom"),
    );
    await expect(repo.executeExpenseCreate(CMD)).rejects.toBeInstanceOf(
      ExpenseActionRpcExceptionError,
    );
  });

  test("response.error preserva code e message", async () => {
    const repo = new WhatsappExpenseActionRepository(
      makeErrClient("42P01", "relation missing"),
    );
    try {
      await repo.executeExpenseCreate(CMD);
      throw new Error("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(ExpenseActionRpcExceptionError);
      const e = err as ExpenseActionRpcExceptionError;
      expect(e.code).toBe("42P01");
      expect(e.message).toBe("relation missing");
    }
  });

  test("rpc() lança excecao -> ExpenseActionTransportError", async () => {
    const { client } = makeClient(new Error("network dead"));
    const repo = new WhatsappExpenseActionRepository(client);
    await expect(repo.executeExpenseCreate(CMD)).rejects.toBeInstanceOf(
      ExpenseActionTransportError,
    );
  });

  test("sucesso: passa data adiante (parser recebe payload cru)", async () => {
    const { client, calls } = makeClient({
      kind: "applied",
      actionExecutionId: UUID_EXEC,
      despesaId: UUID_DESP,
      valor: 5,
      categoria: "Multas",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    const r = await repo.executeExpenseCreate(CMD);
    expect(r.kind).toBe("applied");
    expect(calls.length).toBe(1);
  });
});

// ============================================================
// Repository: nome da RPC + mapeamento de params
// ============================================================

describe("executeExpenseCreate — params passados ao client.rpc", () => {
  test("chama a RPC com o nome exato execute_whatsapp_expense_create", async () => {
    const { client, calls } = makeClient({
      kind: "applied",
      actionExecutionId: UUID_EXEC,
      despesaId: UUID_DESP,
      valor: 149.9,
      categoria: "Combustível",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    await repo.executeExpenseCreate(CMD);
    expect(calls.length).toBe(1);
    expect(calls[0].fn).toBe("execute_whatsapp_expense_create");
  });

  test("mapeia nomes E valores camelCase -> p_snake_case corretamente", async () => {
    const { client, calls } = makeClient({
      kind: "applied",
      actionExecutionId: UUID_EXEC,
      despesaId: UUID_DESP,
      valor: 149.9,
      categoria: "Combustível",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    await repo.executeExpenseCreate(CMD);
    expect(calls[0].params).toEqual({
      p_draft_id: UUID_DRAFT,
      p_conversation_state_id: UUID_STATE,
      p_confirmation_message_id: UUID_CONF,
      p_source_message_id: UUID_SRC,
      p_queue_item_id: UUID_QUEUE,
      p_user_id: UUID_USER,
      p_contact_id: UUID_CONTACT,
      p_vehicle_id: UUID_VEHICLE,
      p_categoria: "Combustível",
      p_valor: 149.9,
      p_descricao: "posto shell",
      p_expected_state_version: 3,
      p_orchestrator_version: "v1",
    });
  });

  test("descricao null é preservado (não vira string vazia)", async () => {
    const { client, calls } = makeClient({
      kind: "applied",
      actionExecutionId: UUID_EXEC,
      despesaId: UUID_DESP,
      valor: 10,
      categoria: "Lavagem",
    });
    const repo = new WhatsappExpenseActionRepository(client);
    await repo.executeExpenseCreate({ ...CMD, descricao: null });
    expect(calls[0].params.p_descricao).toBeNull();
  });
});

// ============================================================
// Segurança estática do módulo
// ============================================================

describe("segurança estática", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const REPO_PATH = resolve(HERE, "../expense-repository.ts");
  const SRC = readFileSync(REPO_PATH, "utf8");

  test("não importa Deno/fetch/React/node:crypto", () => {
    expect(SRC).not.toMatch(/from\s+["']https?:\/\//);
    expect(SRC).not.toMatch(/\bDeno\./);
    expect(SRC).not.toMatch(/\bfetch\(/);
    expect(SRC).not.toMatch(/from\s+["']react/);
    expect(SRC).not.toMatch(/node:crypto/);
  });

  test("não menciona km_update nem maintenance_register", () => {
    expect(SRC).not.toMatch(/km_update/);
    expect(SRC).not.toMatch(/maintenance_register/);
  });
});
