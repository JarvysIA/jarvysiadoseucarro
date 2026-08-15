import { afterEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_HANDOFF_ACTIVATION_LINK_BASE,
  CONVERSATION_HANDOFF_TRANSIENT_FAILURE_TEXT,
  CONVERSATION_HANDOFF_VEHICLE_NOT_FOUND_TEXT,
  buildConversationHandoffActivationLink,
  buildConversationHandoffActivationUpsellText,
  buildConversationHandoffFinalIdempotencyKey,
  executeConversationHandoffEntrypoint,
} from "../entrypoint.ts";
import { CONVERSATION_HANDOFF_CONTRACT_VERSION } from "../contract.ts";
import type {
  ConversationHandoffExecutionCommandV1,
  ConversationHandoffPrimaryCommandV1,
  ConversationHandoffSupplementalCommandV1,
} from "../execution-contract.ts";
import { buildConversationHandoffIdempotencyKey } from "../outbound.ts";
import type {
  RpcInvoker,
  SupabaseFromBuilder,
  SupabaseLike,
  SupabaseMaybeSingleResult,
  SupabaseSelectResult,
} from "../../orchestrator/repository.ts";

// ------------------------------------------------------------
// C3 real via mock de fetch — EXATAMENTE o mesmo padrão já usado em
// dr-jarvys-adapter.test.ts (setDenoEnv/mockFetchResponse/afterEach).
// Não usa mock.module: uma tentativa anterior com mock.module() para
// substituir createAskDrJarvysInvoker foi abandonada depois de provar,
// rodando o gate 2 de verdade (todos os arquivos de teste do C-track
// juntos), que ela vaza para dr-jarvys-adapter.test.ts quando os
// arquivos rodam no mesmo processo `bun test` — quebrando 12 testes de
// um arquivo protegido mesmo sem esse arquivo ser tocado. mock.module
// é global ao processo, não por arquivo; fetch/Deno mockados com
// afterEach restaurando o original é o padrão local e seguro já
// comprovado em produção neste repositório.
const ORIGINAL_DENO = (globalThis as unknown as { Deno?: unknown }).Deno;
const ORIGINAL_FETCH = globalThis.fetch;

function setDenoEnv(vars: Record<string, string | undefined>): void {
  (globalThis as unknown as { Deno?: unknown }).Deno = {
    env: { get: (name: string) => vars[name] },
  };
}

afterEach(() => {
  (globalThis as unknown as { Deno?: unknown }).Deno = ORIGINAL_DENO;
  globalThis.fetch = ORIGINAL_FETCH;
});

const VALID_KEY = "test-lovable-key";

function aiResponseBody(text: string): Record<string, unknown> {
  return {
    choices: [{ message: { content: JSON.stringify({ inScope: true, response: text }) } }],
  };
}

type FetchHandler = () => Response;

function mockFetchSequence(handlers: readonly FetchHandler[]): ReturnType<typeof mock> {
  let index = 0;
  const fetchMock = mock(async () => {
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    if (!handler) throw new Error("mockFetchSequence sem handler configurado");
    return handler();
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function mockFetchSuccess(text: string): ReturnType<typeof mock> {
  return mockFetchSequence([
    () => new Response(JSON.stringify(aiResponseBody(text)), { status: 200 }),
  ]);
}

function mockFetchNeverCalled(): ReturnType<typeof mock> {
  const fetchMock = mock(async () => {
    throw new Error("fetch não deveria ser chamado");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

// ------------------------------------------------------------
// Helpers de UUID válido (contract.ts exige o formato v4-like via regex).
// ------------------------------------------------------------

function uuid(fill: string): string {
  return `${fill.repeat(8)}-${fill.repeat(4)}-4${fill.repeat(3)}-8${fill.repeat(3)}-${fill.repeat(12)}`;
}

const CONTACT_ID = uuid("1");
const USER_ID = uuid("2");
const VEHICLE_ID = uuid("3");
const SOURCE_MESSAGE_ID = uuid("4");

function primaryCommand(
  sourceMessageId: string,
  vehicleId: string | null = null,
): ConversationHandoffPrimaryCommandV1 {
  return {
    version: CONVERSATION_HANDOFF_CONTRACT_VERSION,
    kind: "conversation",
    segment: "primary",
    contactId: CONTACT_ID,
    userId: USER_ID,
    vehicleId,
    sourceMessageId,
    originalText: "Meu carro está fazendo um barulho estranho no motor.",
  };
}

function supplementalCommand(
  sourceMessageId: string,
  vehicleId: string | null = null,
): ConversationHandoffSupplementalCommandV1 {
  return {
    version: CONVERSATION_HANDOFF_CONTRACT_VERSION,
    kind: "conversation",
    segment: "supplemental",
    contactId: CONTACT_ID,
    userId: USER_ID,
    vehicleId,
    sourceMessageId,
    originalText: "Meu carro está fazendo um barulho estranho no motor.",
  };
}

// ------------------------------------------------------------
// Mock estrutural de .from() — mesmo padrão já usado em
// dr-jarvys-authorization.test.ts (MockSelectBuilder/makeFromMock),
// redeclarado aqui para não depender daquele arquivo de teste.
// ------------------------------------------------------------

type TableRows = Record<string, Record<string, unknown>[]>;

class MockSelectBuilder implements PromiseLike<SupabaseSelectResult> {
  private readonly filters: Array<[string, unknown]> = [];

  constructor(
    private readonly runSelect: (filters: readonly [string, unknown][]) => SupabaseSelectResult,
  ) {}

  eq(column: string, value: unknown): MockSelectBuilder {
    this.filters.push([column, value]);
    return this;
  }

  async maybeSingle(): Promise<SupabaseMaybeSingleResult> {
    const result = this.runSelect(this.filters);
    if (result.error) return { data: null, error: result.error };
    return { data: result.data?.[0] ?? null, error: null };
  }

  then<TResult1 = SupabaseSelectResult, TResult2 = never>(
    onfulfilled?: ((value: SupabaseSelectResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.runSelect(this.filters)).then(onfulfilled, onrejected);
  }
}

function makeFromMock(rows: TableRows): (table: string) => SupabaseFromBuilder {
  return (table: string) => ({
    select: () =>
      new MockSelectBuilder((filters) => {
        const matched = (rows[table] ?? []).filter((row) =>
          filters.every(([column, value]) => row[column] === value),
        );
        return { data: matched, error: null };
      }),
  });
}

// ------------------------------------------------------------
// Backend falso do ledger (C5) + outbound (C6) via .rpc() — simula as
// transições CAS reais o suficiente pra exercitar a orquestração deste
// entrypoint sem precisar de Postgres. Mapas expostos para os testes
// poderem semear estado (ex: uma reserva já 'completed'/'failed') antes
// de chamar o entrypoint, para os cenários de replay.
// ------------------------------------------------------------

type FakeLedgerRow = {
  id: string;
  status: "reserved" | "invoking" | "completed" | "failed";
  resultStatus: string | null;
};

type FakeOutboundRow = {
  id: string;
  messageId: string;
  textBody: string;
  deliverable: boolean | undefined;
};

function strParam(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
}

function makeFakeBackend(): {
  rpc: RpcInvoker;
  ledger: Map<string, FakeLedgerRow>;
  outbound: Map<string, FakeOutboundRow>;
} {
  const ledger = new Map<string, FakeLedgerRow>();
  const outbound = new Map<string, FakeOutboundRow>();
  let counter = 0;
  const nextId = (prefix: string): string => `${prefix}-${++counter}`;

  function findLedgerById(id: string): FakeLedgerRow | undefined {
    for (const row of ledger.values()) {
      if (row.id === id) return row;
    }
    return undefined;
  }

  const rpc = (async (fn: string, params: Record<string, unknown>) => {
    switch (fn) {
      case "reserve_conversation_handoff_execution": {
        const key = `${strParam(params, "p_source_message_id")}:${strParam(params, "p_segment")}`;
        let row = ledger.get(key);
        const isNew = !row;
        if (!row) {
          row = { id: nextId("ledger"), status: "reserved", resultStatus: null };
          ledger.set(key, row);
        }
        return {
          data: [
            {
              id: row.id,
              status: row.status,
              is_new_reservation: isNew,
              result_status: row.resultStatus,
            },
          ],
          error: null,
        };
      }
      case "mark_conversation_handoff_invoking": {
        const row = findLedgerById(strParam(params, "p_id"));
        if (!row || row.status !== "reserved") return { data: false, error: null };
        row.status = "invoking";
        return { data: true, error: null };
      }
      case "complete_conversation_handoff_execution": {
        const row = findLedgerById(strParam(params, "p_id"));
        if (!row || row.status !== "invoking") return { data: false, error: null };
        row.status = "completed";
        row.resultStatus = strParam(params, "p_result_status");
        return { data: true, error: null };
      }
      case "fail_conversation_handoff_execution": {
        const row = findLedgerById(strParam(params, "p_id"));
        if (!row || row.status !== "invoking") return { data: false, error: null };
        row.status = "failed";
        row.resultStatus = strParam(params, "p_result_status");
        return { data: true, error: null };
      }
      case "enqueue_conversation_handoff_outbound": {
        const key = strParam(params, "p_idempotency_key");
        const existing = outbound.get(key);
        if (existing) {
          return {
            data: {
              result: "replayed",
              outbound_message_id: existing.messageId,
              outbound_queue_id: existing.id,
            },
            error: null,
          };
        }
        const row: FakeOutboundRow = {
          id: nextId("queue"),
          messageId: nextId("msg"),
          textBody: strParam(params, "p_text_body"),
          deliverable: typeof params.p_deliverable === "boolean" ? params.p_deliverable : undefined,
        };
        outbound.set(key, row);
        return {
          data: {
            result: "created",
            outbound_message_id: row.messageId,
            outbound_queue_id: row.id,
          },
          error: null,
        };
      }
      case "get_conversation_handoff_outbound_by_key": {
        const row = outbound.get(strParam(params, "p_idempotency_key"));
        if (!row) return { data: [], error: null };
        return {
          data: [
            {
              text_body: row.textBody,
              outbound_message_id: row.messageId,
              outbound_queue_id: row.id,
            },
          ],
          error: null,
        };
      }
      default:
        return { data: null, error: { message: `unexpected_rpc:${fn}`, code: null } };
    }
  }) as RpcInvoker;

  return { rpc, ledger, outbound };
}

type RpcCall = { fn: string; params: Record<string, unknown> };

function withRpcSpy(rpc: RpcInvoker): { rpc: RpcInvoker; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const wrapped = (async (fn: string, params: Record<string, unknown>) => {
    calls.push({ fn, params });
    return rpc(fn, params);
  }) as RpcInvoker;
  return { rpc: wrapped, calls };
}

// Substitui a resposta da N-ésima chamada de uma RPC específica — usado
// pra simular falha do ledger só na reserva do segmento supplemental
// (a 2ª chamada de mark_conversation_handoff_invoking, já que o
// executor sempre processa primary antes de supplemental, nunca em
// paralelo — garantia do C2B).
function withNthCallOverride(
  rpc: RpcInvoker,
  targetFn: string,
  n: number,
  override: () => { data: unknown; error: unknown },
): RpcInvoker {
  let count = 0;
  return (async (fn: string, params: Record<string, unknown>) => {
    if (fn === targetFn) {
      count += 1;
      if (count === n) return override();
    }
    return rpc(fn, params);
  }) as RpcInvoker;
}

function makeClient(rows: TableRows, rpc: RpcInvoker): SupabaseLike {
  return { from: makeFromMock(rows), rpc };
}

// ------------------------------------------------------------
// Fixtures de autorização (C4) — mesmo padrão de fixture já usado em
// dr-jarvys-authorization.test.ts.
// ------------------------------------------------------------

const VIP_PROFILE = { id: USER_ID, status_usuario: "vip", trial_inicio: null };
const ATIVO_PROFILE = { id: USER_ID, status_usuario: "ativo", trial_inicio: null };

const AUTHORIZED_ROWS: TableRows = {
  profiles: [VIP_PROFILE],
  pagamentos_pix: [],
  veiculos: [{ id: VEHICLE_ID, user_id: USER_ID, status: "ativo" }],
};

const BLOCKED_NO_SUGGESTION_ROWS: TableRows = {
  profiles: [VIP_PROFILE],
  pagamentos_pix: [],
  veiculos: [],
};

const BLOCKED_WITH_SUGGESTION_ROWS: TableRows = {
  profiles: [ATIVO_PROFILE],
  pagamentos_pix: [],
  veiculos: [{ id: VEHICLE_ID, user_id: USER_ID, status: "ativo" }],
};

const VEHICLE_REQUIRED_ROWS: TableRows = {
  profiles: [VIP_PROFILE],
  pagamentos_pix: [],
  veiculos: [],
};

function executionCommand(
  primary: ConversationHandoffPrimaryCommandV1,
  supplemental?: ConversationHandoffSupplementalCommandV1,
): ConversationHandoffExecutionCommandV1 {
  return supplemental ? { primary, supplemental } : { primary };
}

describe("Bloco A — curto-circuito (bloqueio de autorização)", () => {
  it("1. authorized:false/authorization_required COM suggestedVehicleId → texto contém link com ?ativar=, outcome correto", async () => {
    const backend = makeFakeBackend();
    const client = makeClient(BLOCKED_WITH_SUGGESTION_ROWS, backend.rpc);
    const command = executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null));

    const result = await executeConversationHandoffEntrypoint(client, command);

    expect(result.outcome).toBe("blocked_authorization_required");
    expect(result.outboundResult?.result).toBe("created");
    const [outboundRow] = [...backend.outbound.values()];
    expect(outboundRow?.textBody).toContain(`?ativar=${VEHICLE_ID}`);
    expect(outboundRow?.textBody).toBe(buildConversationHandoffActivationUpsellText(VEHICLE_ID));
    // Achado crítico do C9: a única linha de um bloqueio é a resposta
    // final ao usuário (chave ":final") — deliverable:true, nunca "internal".
    expect(outboundRow?.deliverable).toBe(true);
  });

  it("2. authorized:false/authorization_required SEM suggestedVehicleId → texto contém link SEM ?ativar=", async () => {
    const backend = makeFakeBackend();
    const client = makeClient(BLOCKED_NO_SUGGESTION_ROWS, backend.rpc);
    const command = executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null));

    const result = await executeConversationHandoffEntrypoint(client, command);

    expect(result.outcome).toBe("blocked_authorization_required");
    const [outboundRow] = [...backend.outbound.values()];
    expect(outboundRow?.textBody).not.toContain("?ativar=");
    expect(outboundRow?.textBody).toBe(buildConversationHandoffActivationUpsellText(undefined));
    expect(outboundRow?.textBody).toContain(CONVERSATION_HANDOFF_ACTIVATION_LINK_BASE);
  });

  it("3. authorized:false/vehicle_required → texto exato CONVERSATION_HANDOFF_VEHICLE_NOT_FOUND_TEXT", async () => {
    const backend = makeFakeBackend();
    const client = makeClient(VEHICLE_REQUIRED_ROWS, backend.rpc);
    const command = executionCommand(primaryCommand(SOURCE_MESSAGE_ID, VEHICLE_ID));

    const result = await executeConversationHandoffEntrypoint(client, command);

    expect(result.outcome).toBe("blocked_vehicle_required");
    const [outboundRow] = [...backend.outbound.values()];
    expect(outboundRow?.textBody).toBe(CONVERSATION_HANDOFF_VEHICLE_NOT_FOUND_TEXT);
  });

  it("4. nos 3 casos bloqueados: reserveConversationHandoffExecution NUNCA é chamada", async () => {
    const scenarios: Array<[TableRows, string | null]> = [
      [BLOCKED_WITH_SUGGESTION_ROWS, null],
      [BLOCKED_NO_SUGGESTION_ROWS, null],
      [VEHICLE_REQUIRED_ROWS, VEHICLE_ID],
    ];
    for (const [rows, vehicleId] of scenarios) {
      const backend = makeFakeBackend();
      const spy = withRpcSpy(backend.rpc);
      const client = makeClient(rows, spy.rpc);
      await executeConversationHandoffEntrypoint(
        client,
        executionCommand(primaryCommand(SOURCE_MESSAGE_ID, vehicleId)),
      );
      const reserveCalls = spy.calls.filter(
        (c) => c.fn === "reserve_conversation_handoff_execution",
      );
      expect(reserveCalls.length).toBe(0);
    }
  });

  it("5. nos 3 casos bloqueados: nenhuma chamada de rede real de IA acontece", async () => {
    const scenarios: Array<[TableRows, string | null]> = [
      [BLOCKED_WITH_SUGGESTION_ROWS, null],
      [BLOCKED_NO_SUGGESTION_ROWS, null],
      [VEHICLE_REQUIRED_ROWS, VEHICLE_ID],
    ];
    for (const [rows, vehicleId] of scenarios) {
      const fetchMock = mockFetchNeverCalled();
      const backend = makeFakeBackend();
      const client = makeClient(rows, backend.rpc);
      await executeConversationHandoffEntrypoint(
        client,
        executionCommand(primaryCommand(SOURCE_MESSAGE_ID, vehicleId)),
      );
      expect(fetchMock).toHaveBeenCalledTimes(0);
    }
  });

  it("6. enqueueConversationHandoffOutbound é chamado com a chave FINAL (':final'), não a chave de segmento", async () => {
    const backend = makeFakeBackend();
    const spy = withRpcSpy(backend.rpc);
    const client = makeClient(BLOCKED_NO_SUGGESTION_ROWS, spy.rpc);
    await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    const enqueueCalls = spy.calls.filter((c) => c.fn === "enqueue_conversation_handoff_outbound");
    expect(enqueueCalls.length).toBe(1);
    expect(enqueueCalls[0]?.params.p_idempotency_key).toBe(
      buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID),
    );
    expect(enqueueCalls[0]?.params.p_idempotency_key).not.toBe(
      buildConversationHandoffIdempotencyKey(SOURCE_MESSAGE_ID, "primary"),
    );
  });
});

describe("Bloco B — invoker guardado, caminho novo", () => {
  it("7. reserva nova → mark_invoking → invoker real chamado → texto persistido sob a chave de SEGMENTO → complete_ com status real", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mockFetchSuccess("Troque o óleo a cada 10 mil km.");
    const backend = makeFakeBackend();
    const spy = withRpcSpy(backend.rpc);
    const client = makeClient(AUTHORIZED_ROWS, spy.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("primary_succeeded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spy.calls.filter((c) => c.fn === "mark_conversation_handoff_invoking").length).toBe(1);

    const segmentKey = buildConversationHandoffIdempotencyKey(SOURCE_MESSAGE_ID, "primary");
    const segmentEnqueue = spy.calls.find(
      (c) =>
        c.fn === "enqueue_conversation_handoff_outbound" &&
        c.params.p_idempotency_key === segmentKey,
    );
    expect(segmentEnqueue).toBeDefined();
    expect(segmentEnqueue?.params.p_text_body).toBe("Troque o óleo a cada 10 mil km.");
    // Achado crítico do C9: a linha de SEGMENTO é uso interno (recuperação
    // em replay) — NUNCA pode entrar como "queued", ou o sender real a
    // reivindicaria e mandaria pro usuário. deliverable:false garante
    // status inicial "internal" na RPC real.
    expect(segmentEnqueue?.params.p_deliverable).toBe(false);

    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    const finalEnqueue = spy.calls.find(
      (c) =>
        c.fn === "enqueue_conversation_handoff_outbound" && c.params.p_idempotency_key === finalKey,
    );
    expect(finalEnqueue).toBeDefined();
    // A linha FINAL é a resposta de verdade ao usuário — deliverable:true
    // garante status inicial "queued", a única que o sender real reivindica.
    expect(finalEnqueue?.params.p_deliverable).toBe(true);

    const completeCalls = spy.calls.filter(
      (c) => c.fn === "complete_conversation_handoff_execution",
    );
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0]?.params.p_result_status).toBe("success");
  });

  it("7b. enqueue do SEGMENTO (interno) devolvendo invalid_deliverable_flag não muda o fluxo — mesma filosofia de qualquer enqueue de segmento falhando silenciosamente", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mockFetchSuccess("Troque o óleo a cada 10 mil km.");
    const backend = makeFakeBackend();
    // 1ª chamada de enqueue_conversation_handoff_outbound é sempre a do
    // SEGMENTO (dentro de createLedgerGuardedInvoker, antes da chamada
    // FINAL do entrypoint) — força só essa a devolver
    // invalid_deliverable_flag, sem afetar a 2ª (final).
    const rpcWithSegmentEnqueueRejected = withNthCallOverride(
      backend.rpc,
      "enqueue_conversation_handoff_outbound",
      1,
      () => ({ data: { result: "invalid_deliverable_flag" }, error: null }),
    );
    const client = makeClient(AUTHORIZED_ROWS, rpcWithSegmentEnqueueRejected);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    // Idêntico ao comportamento já existente quando o enqueue do texto
    // cru falha por qualquer outro motivo (RPC error, exceção, etc.):
    // o entrypoint.ts nunca checa o retorno dessa chamada específica
    // (ver comentário em createLedgerGuardedInvoker: "Mesmo se o enqueue
    // do texto cru falhar, ainda completamos o ledger com o status
    // real") — o ciclo segue normalmente até primary_succeeded.
    expect(result.outcome).toBe("primary_succeeded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.outboundResult?.result).toBe("created");
  });

  it("8. resultado success → complete_ chamado com 'success'", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSuccess("Texto de sucesso.");
    const backend = makeFakeBackend();
    const spy = withRpcSpy(backend.rpc);
    const client = makeClient(AUTHORIZED_ROWS, spy.rpc);

    await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    const completeCalls = spy.calls.filter(
      (c) => c.fn === "complete_conversation_handoff_execution",
    );
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0]?.params.p_result_status).toBe("success");
  });

  it("9. resultado não-success válido (permanent_failure via texto >4000 chars) → complete_ chamado com esse status, NÃO enfileira texto de segmento", async () => {
    // "blocked" não é usado aqui de propósito: dr-jarvys-adapter.ts (C3)
    // nunca produz status:"blocked" na prática (confirmado no checkpoint
    // — mapAskDrJarvysResult só produz success/transient_failure/
    // permanent_failure) — permanent_failure via texto longo é um
    // caminho genuíno e realista de resultado não-success através do
    // invoker REAL, sem precisar mockar nada além do texto de entrada.
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mockFetchNeverCalled(); // askDrJarvys rejeita ANTES de chamar fetch
    const backend = makeFakeBackend();
    const spy = withRpcSpy(backend.rpc);
    const client = makeClient(AUTHORIZED_ROWS, spy.rpc);
    const longTextCommand: ConversationHandoffPrimaryCommandV1 = {
      ...primaryCommand(SOURCE_MESSAGE_ID, null),
      originalText: "a".repeat(4001),
    };

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(longTextCommand),
    );

    expect(result.outcome).toBe("primary_failed");
    expect(fetchMock).toHaveBeenCalledTimes(0);
    const completeCalls = spy.calls.filter(
      (c) => c.fn === "complete_conversation_handoff_execution",
    );
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0]?.params.p_result_status).toBe("permanent_failure");

    const segmentKey = buildConversationHandoffIdempotencyKey(SOURCE_MESSAGE_ID, "primary");
    const segmentEnqueue = spy.calls.find(
      (c) =>
        c.fn === "enqueue_conversation_handoff_outbound" &&
        c.params.p_idempotency_key === segmentKey,
    );
    expect(segmentEnqueue).toBeUndefined();
  });

  it("10. guarda de resultado inválido (fail_ + 'permanent_failure' + exceção) está presente no código-fonte — ver nota de rastreabilidade abaixo", () => {
    // ACHADO IMPORTANTE, reportado explicitamente (não testável como
    // black-box dinâmico): dr-jarvys-adapter.ts's mapAskDrJarvysResult é
    // uma função TOTAL sobre AskDrJarvysResult — todo branch dela produz
    // um ConversationExecutionResult válido (success/transient_failure/
    // permanent_failure, sempre bem formado). askDrJarvys também nunca
    // deixa uma exceção escapar (try/catch cobre inclusive o fetch).
    // Logo, através do invoker REAL — que este entrypoint conecta de
    // forma NÃO injetável, por especificação (createAskDrJarvysInvoker
    // chamado diretamente dentro de createLedgerGuardedInvoker, sem
    // parâmetro de injeção na assinatura pública travada de
    // executeConversationHandoffEntrypoint) — é estruturalmente
    // impossível chegar a um "rawResult" que falhe
    // validateConversationExecutionResult. Testar isso via
    // mock.module() (que substituiria createAskDrJarvysInvoker) foi
    // tentado e descartado: provou vazar entre arquivos de teste no
    // mesmo processo `bun test`, quebrando testes de um arquivo
    // protegido (ver nota no topo do arquivo). Em vez de inventar um
    // teste dinâmico enganoso, confirmamos aqui por inspeção estática
    // que o código de guarda pedido pela especificação está de fato
    // presente e correto no arquivo de produção.
    const entrypointSource = readFileSync(
      fileURLToPath(new URL("../entrypoint.ts", import.meta.url)),
      "utf8",
    );
    expect(entrypointSource).toContain(
      "const validated = validateConversationExecutionResult(rawResult);",
    );
    expect(entrypointSource).toContain("if (!validated.ok) {");
    expect(entrypointSource).toContain(
      'await failConversationHandoffExecution(client, reservation.id, "permanent_failure");',
    );
    expect(entrypointSource).toContain('throw new Error("ledger_invoke_result_invalid");');
  });
});

describe("Bloco C — invoker guardado, replay", () => {
  it("11. reservation.status:'failed' → invoker real NUNCA chamado, resultado transient_failure devolvido direto", async () => {
    const fetchMock = mockFetchNeverCalled();
    const backend = makeFakeBackend();
    backend.ledger.set(`${SOURCE_MESSAGE_ID}:primary`, {
      id: "seed-failed",
      status: "failed",
      resultStatus: "transient_failure",
    });
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("primary_failed");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("12. reservation.status:'completed'+resultStatus:'success', lookup encontra → invoker real NUNCA chamado, texto do lookup usado", async () => {
    const fetchMock = mockFetchNeverCalled();
    const backend = makeFakeBackend();
    const segmentKey = buildConversationHandoffIdempotencyKey(SOURCE_MESSAGE_ID, "primary");
    backend.ledger.set(`${SOURCE_MESSAGE_ID}:primary`, {
      id: "seed-completed",
      status: "completed",
      resultStatus: "success",
    });
    backend.outbound.set(segmentKey, {
      id: "seed-queue-id",
      messageId: "seed-message-id",
      textBody: "Texto já persistido de uma execução anterior.",
    });
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("primary_succeeded");
    expect(fetchMock).toHaveBeenCalledTimes(0);
    const [finalOutboundRow] = [...backend.outbound.values()].filter(
      (r) => r.id !== "seed-queue-id",
    );
    expect(finalOutboundRow?.textBody).toBe("Texto já persistido de uma execução anterior.");
  });

  it("13. reservation.status:'completed'+resultStatus:'success', lookup NÃO encontra → exceção (incerto), invoker real NUNCA chamado", async () => {
    const fetchMock = mockFetchNeverCalled();
    const backend = makeFakeBackend();
    backend.ledger.set(`${SOURCE_MESSAGE_ID}:primary`, {
      id: "seed-completed-2",
      status: "completed",
      resultStatus: "success",
    });
    // Propositalmente NÃO semeia backend.outbound — lookup deve falhar.
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("uncertain");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("14. reservation.status:'completed'+resultStatus diferente de success (blocked) → devolve fixo direto, invoker real NUNCA chamado, NÃO tenta lookup", async () => {
    const fetchMock = mockFetchNeverCalled();
    const backend = makeFakeBackend();
    const spy = withRpcSpy(backend.rpc);
    backend.ledger.set(`${SOURCE_MESSAGE_ID}:primary`, {
      id: "seed-completed-blocked",
      status: "completed",
      resultStatus: "blocked",
    });
    const client = makeClient(AUTHORIZED_ROWS, spy.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("primary_failed");
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(
      spy.calls.filter((c) => c.fn === "get_conversation_handoff_outbound_by_key").length,
    ).toBe(0);
  });

  it("14b. reservation.status:'completed'+resultStatus:'transient_failure' → mapeado sem ambiguidade (único reason válido)", async () => {
    const fetchMock = mockFetchNeverCalled();
    const backend = makeFakeBackend();
    backend.ledger.set(`${SOURCE_MESSAGE_ID}:primary`, {
      id: "seed-completed-transient",
      status: "completed",
      resultStatus: "transient_failure",
    });
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("primary_failed");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("14c. reservation.status:'completed'+resultStatus:'permanent_failure' → mapeado via o único reason observado na prática (invalid_request)", async () => {
    const fetchMock = mockFetchNeverCalled();
    const backend = makeFakeBackend();
    backend.ledger.set(`${SOURCE_MESSAGE_ID}:primary`, {
      id: "seed-completed-permanent",
      status: "completed",
      resultStatus: "permanent_failure",
    });
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("primary_failed");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("15. reservation.isNewReservation:false com status 'reserved' (outro processo concorrente) → exceção lançada, invoker real NUNCA chamado", async () => {
    const fetchMock = mockFetchNeverCalled();
    const backend = makeFakeBackend();
    backend.ledger.set(`${SOURCE_MESSAGE_ID}:primary`, {
      id: "seed-in-progress",
      status: "reserved",
      resultStatus: null,
    });
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("uncertain");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

describe("Bloco D — tradução do resultado agregado do executor em outcome + texto", () => {
  it("16. primary_succeeded → outcome certo, texto = responseText do primary", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSuccess("Resposta do primary.");
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("primary_succeeded");
    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    expect(backend.outbound.get(finalKey)?.textBody).toBe("Resposta do primary.");
  });

  it("17. primary_failed → outcome certo, texto = CONVERSATION_HANDOFF_TRANSIENT_FAILURE_TEXT", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSequence([() => new Response("gateway indisponível", { status: 500 })]);
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("primary_failed");
    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    expect(backend.outbound.get(finalKey)?.textBody).toBe(
      CONVERSATION_HANDOFF_TRANSIENT_FAILURE_TEXT,
    );
  });

  it("18. exceção do invoker GUARDADO (ledger_reserve_failed) → executor classifica primary_outcome_uncertain → outcome='uncertain', mesmo texto de fallback", async () => {
    // A exceção real que o executor (C2B) precisa capturar como
    // "uncertain" vem do INVOKER GUARDADO por este entrypoint (as
    // guardas de ledger), não do C3 real — mapAskDrJarvysResult nunca
    // deixa uma exceção chegar até aqui (ver nota no teste 10). Simula
    // via erro de RPC no reserve_, um dos gatilhos reais de exceção do
    // código de produção.
    const fetchMock = mockFetchNeverCalled();
    const backend = makeFakeBackend();
    const failingRpc = (async (fn: string, params: Record<string, unknown>) => {
      if (fn === "reserve_conversation_handoff_execution") {
        return { data: null, error: { message: "boom", code: null } };
      }
      return backend.rpc(fn, params);
    }) as RpcInvoker;
    const client = makeClient(AUTHORIZED_ROWS, failingRpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("uncertain");
    expect(fetchMock).toHaveBeenCalledTimes(0);
    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    expect(backend.outbound.get(finalKey)?.textBody).toBe(
      CONVERSATION_HANDOFF_TRANSIENT_FAILURE_TEXT,
    );
  });

  it("19. completed → outcome certo, texto = primary + '\\n\\n' + supplemental", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSequence([
      () => new Response(JSON.stringify(aiResponseBody("Parte principal.")), { status: 200 }),
      () => new Response(JSON.stringify(aiResponseBody("Parte complementar.")), { status: 200 }),
    ]);
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(
        primaryCommand(SOURCE_MESSAGE_ID, null),
        supplementalCommand(SOURCE_MESSAGE_ID, null),
      ),
    );

    expect(result.outcome).toBe("completed");
    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    expect(backend.outbound.get(finalKey)?.textBody).toBe(
      "Parte principal.\n\nParte complementar.",
    );
  });

  it("20. partially_completed → outcome certo, texto = só primary", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSequence([
      () => new Response(JSON.stringify(aiResponseBody("Parte principal.")), { status: 200 }),
      () => new Response("gateway indisponível", { status: 500 }),
    ]);
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(
        primaryCommand(SOURCE_MESSAGE_ID, null),
        supplementalCommand(SOURCE_MESSAGE_ID, null),
      ),
    );

    expect(result.outcome).toBe("partially_completed");
    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    expect(backend.outbound.get(finalKey)?.textBody).toBe("Parte principal.");
  });

  it("21. supplemental_outcome_uncertain (exceção guardada só no supplemental) → outcome='partially_completed', texto = só primary", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSuccess("Parte principal.");
    const backend = makeFakeBackend();
    // mark_conversation_handoff_invoking: 1ª chamada (primary) passa,
    // 2ª chamada (supplemental) falha — sequência garantida pelo C2B.
    const rpcWithSupplementalMarkFailing = withNthCallOverride(
      backend.rpc,
      "mark_conversation_handoff_invoking",
      2,
      () => ({ data: false, error: null }),
    );
    const client = makeClient(AUTHORIZED_ROWS, rpcWithSupplementalMarkFailing);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(
        primaryCommand(SOURCE_MESSAGE_ID, null),
        supplementalCommand(SOURCE_MESSAGE_ID, null),
      ),
    );

    expect(result.outcome).toBe("partially_completed");
    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    expect(backend.outbound.get(finalKey)?.textBody).toBe("Parte principal.");
  });
});

describe("Bloco E — combinação de texto", () => {
  it("22. formato exato '\\n\\n' entre os dois textos, nenhum texto extra inventado", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSequence([
      () => new Response(JSON.stringify(aiResponseBody("AAA")), { status: 200 }),
      () => new Response(JSON.stringify(aiResponseBody("BBB")), { status: 200 }),
    ]);
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    await executeConversationHandoffEntrypoint(
      client,
      executionCommand(
        primaryCommand(SOURCE_MESSAGE_ID, null),
        supplementalCommand(SOURCE_MESSAGE_ID, null),
      ),
    );

    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    const text = backend.outbound.get(finalKey)?.textBody;
    expect(text).toBe("AAA\n\nBBB");
    expect(text).not.toContain("Além disso");
    expect(text?.split("\n\n").length).toBe(2);
  });

  it("23. textos com quebra de linha própria dentro deles são preservados sem duplo-escape/alteração", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSequence([
      () => new Response(JSON.stringify(aiResponseBody("Linha 1\nLinha 2")), { status: 200 }),
      () => new Response(JSON.stringify(aiResponseBody("Linha A\nLinha B")), { status: 200 }),
    ]);
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    await executeConversationHandoffEntrypoint(
      client,
      executionCommand(
        primaryCommand(SOURCE_MESSAGE_ID, null),
        supplementalCommand(SOURCE_MESSAGE_ID, null),
      ),
    );

    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    const text = backend.outbound.get(finalKey)?.textBody;
    expect(text).toBe("Linha 1\nLinha 2\n\nLinha A\nLinha B");
  });
});

describe("Bloco F — idempotência ponta a ponta", () => {
  it("24. chamar o entrypoint duas vezes com o MESMO command → segunda chamada não invoca a IA de novo para os segmentos", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mockFetchSuccess("Resposta única.");
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const command = executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null));
    await executeConversationHandoffEntrypoint(client, command);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await executeConversationHandoffEntrypoint(client, command);
    expect(fetchMock).toHaveBeenCalledTimes(1); // continua 1 — segunda chamada não invocou de novo
  });

  it("25. enqueueConversationHandoffOutbound da chave FINAL retorna 'replayed' na segunda chamada, com os mesmos ids da primeira", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSuccess("Resposta única.");
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const command = executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null));
    const first = await executeConversationHandoffEntrypoint(client, command);
    const second = await executeConversationHandoffEntrypoint(client, command);

    expect(first.outboundResult?.result).toBe("created");
    expect(second.outboundResult?.result).toBe("replayed");
    if (
      first.outboundResult &&
      "outboundMessageId" in first.outboundResult &&
      second.outboundResult &&
      "outboundMessageId" in second.outboundResult
    ) {
      expect(second.outboundResult.outboundMessageId).toBe(first.outboundResult.outboundMessageId);
      expect(second.outboundResult.outboundQueueId).toBe(first.outboundResult.outboundQueueId);
    } else {
      throw new Error("esperava outboundResult com ids em ambas as chamadas");
    }
  });
});

describe("Bloco G — pureza e ausência de duplicação", () => {
  const entrypointSource = readFileSync(
    fileURLToPath(new URL("../entrypoint.ts", import.meta.url)),
    "utf8",
  );

  it("26. entrypoint.ts não faz fetch( direto (nenhuma chamada de rede própria)", () => {
    expect(entrypointSource).not.toMatch(/\bfetch\(/);
  });

  it("27. zero .insert(/.update(/.delete(/.upsert( direto em entrypoint.ts", () => {
    expect(entrypointSource).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("28. zero Supabase createClient/Deno.env em entrypoint.ts", () => {
    expect(entrypointSource).not.toMatch(/createClient/);
    expect(entrypointSource).not.toMatch(/Deno\.env/);
  });

  it("29. zero any/as any/as unknown as/@ts-ignore/@ts-nocheck em entrypoint.ts", () => {
    expect(entrypointSource).not.toMatch(/\bany\b|as any|as unknown as|@ts-ignore|@ts-nocheck/);
  });

  it("30. entrypoint.ts não reimplementa buildConversationHandoffIdempotencyKey nem gera UUID novo para chaves de idempotência", () => {
    // A chave de SEGMENTO é sempre construída via a função já existente em
    // outbound.ts (importada, nunca reimplementada) — a única string
    // literal "conversation-handoff:" neste arquivo é dentro da própria
    // função NOVA buildConversationHandoffFinalIdempotencyKey (sufixo
    // ":final", propósito distinto, exigido pela especificação).
    expect(entrypointSource).toContain("buildConversationHandoffIdempotencyKey");
    expect(entrypointSource).toContain('from "./outbound.ts"');
    expect(entrypointSource).not.toMatch(/crypto\.randomUUID|randomUUID\(\)/);
  });
});

describe("Bloco H — funções puras exportadas", () => {
  it("31. buildConversationHandoffActivationLink sem suggestedVehicleId retorna só a base", () => {
    expect(buildConversationHandoffActivationLink(undefined)).toBe(
      CONVERSATION_HANDOFF_ACTIVATION_LINK_BASE,
    );
  });

  it("32. buildConversationHandoffActivationLink com suggestedVehicleId retorna base + ?ativar=", () => {
    expect(buildConversationHandoffActivationLink(VEHICLE_ID)).toBe(
      `${CONVERSATION_HANDOFF_ACTIVATION_LINK_BASE}?ativar=${VEHICLE_ID}`,
    );
  });

  it("33. buildConversationHandoffActivationUpsellText contém o texto fixo e o link", () => {
    const text = buildConversationHandoffActivationUpsellText(VEHICLE_ID);
    expect(text).toContain("Essa conversa livre com o Jarvys é liberada nos planos ativos!");
    expect(text).toContain(`${CONVERSATION_HANDOFF_ACTIVATION_LINK_BASE}?ativar=${VEHICLE_ID}`);
  });

  it("34. buildConversationHandoffFinalIdempotencyKey tem formato exato 'conversation-handoff:{id}:final'", () => {
    expect(buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID)).toBe(
      `conversation-handoff:${SOURCE_MESSAGE_ID}:final`,
    );
  });

  it("35. buildConversationHandoffFinalIdempotencyKey nunca colide com a chave de segmento (sufixo distinto)", () => {
    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    const primaryKey = buildConversationHandoffIdempotencyKey(SOURCE_MESSAGE_ID, "primary");
    const supplementalKey = buildConversationHandoffIdempotencyKey(
      SOURCE_MESSAGE_ID,
      "supplemental",
    );
    expect(finalKey).not.toBe(primaryKey);
    expect(finalKey).not.toBe(supplementalKey);
  });
});

describe("Bloco I — validação defensiva e casos extra", () => {
  it("36. command estruturalmente inválido → lança exceção (erro de programação de quem chama, não um outcome de negócio)", async () => {
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);
    const invalidCommand = {
      primary: { ...primaryCommand(SOURCE_MESSAGE_ID, null), originalText: "" },
    } as ConversationHandoffExecutionCommandV1;

    await expect(executeConversationHandoffEntrypoint(client, invalidCommand)).rejects.toThrow();
  });

  it("37. vehicleId null ponta a ponta (conversa geral, sem veículo específico) → autorizado e concluído normalmente", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSuccess("Resposta geral.");
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("primary_succeeded");
  });

  it("38. texto com emoji/acentuação é preservado sem alteração na combinação final", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchSequence([
      () =>
        new Response(JSON.stringify(aiResponseBody("Verifique o óleo 🛢️ regularmente.")), {
          status: 200,
        }),
      () =>
        new Response(JSON.stringify(aiResponseBody("Não esqueça da revisão! 🚗✨")), {
          status: 200,
        }),
    ]);
    const backend = makeFakeBackend();
    const client = makeClient(AUTHORIZED_ROWS, backend.rpc);

    await executeConversationHandoffEntrypoint(
      client,
      executionCommand(
        primaryCommand(SOURCE_MESSAGE_ID, null),
        supplementalCommand(SOURCE_MESSAGE_ID, null),
      ),
    );

    const finalKey = buildConversationHandoffFinalIdempotencyKey(SOURCE_MESSAGE_ID);
    expect(backend.outbound.get(finalKey)?.textBody).toBe(
      "Verifique o óleo 🛢️ regularmente.\n\nNão esqueça da revisão! 🚗✨",
    );
  });

  it("39. reservation nula (erro de RPC no reserve) → invoker guardado lança, executor classifica como incerto", async () => {
    const fetchMock = mockFetchNeverCalled();
    const failingRpc = (async (fn: string, params: Record<string, unknown>) => {
      if (fn === "reserve_conversation_handoff_execution") {
        return { data: null, error: { message: "boom", code: null } };
      }
      const backend = makeFakeBackend();
      return backend.rpc(fn, params);
    }) as RpcInvoker;
    const client = makeClient(AUTHORIZED_ROWS, failingRpc);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("uncertain");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("40. mark_conversation_handoff_invoking retorna false → invoker guardado lança, invoker real NUNCA chamado", async () => {
    const fetchMock = mockFetchNeverCalled();
    const backend = makeFakeBackend();
    const rpcWithFailingMark = (async (fn: string, params: Record<string, unknown>) => {
      if (fn === "mark_conversation_handoff_invoking") {
        return { data: false, error: null };
      }
      return backend.rpc(fn, params);
    }) as RpcInvoker;
    const client = makeClient(AUTHORIZED_ROWS, rpcWithFailingMark);

    const result = await executeConversationHandoffEntrypoint(
      client,
      executionCommand(primaryCommand(SOURCE_MESSAGE_ID, null)),
    );

    expect(result.outcome).toBe("uncertain");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
