// Testes de whatsapp-reengagement/index.ts (Build Reengagement-Inactivity).
// Runner: bun test. Mesmo padrão de whatsapp-maintenance-alerts/
// __tests__/index.test.ts: mocka globalThis.Deno (env) com afterEach
// restaurando, client estrutural mockado (nunca mock.module()).
//
// O mock de whatsapp_contacts aplica a MESMA filtragem que a query real
// faria (verified_at NOT NULL + o ramo NOT NULL/lte OU IS NULL/lte de
// last_inbound_at), em vez de devolver listas pré-recortadas por coorte —
// assim os testes provam o comportamento real de exclusividade mútua
// (item 12) a partir de uma única lista de contatos.

import { afterEach, describe, expect, test } from "bun:test";
import {
  createProductionLogger,
  handleRequest,
  REENGAGEMENT_TEXT_COHORT_A,
  REENGAGEMENT_TEXT_COHORT_B,
  runReengagementBatch,
  safeEqual,
  type ReengagementClient,
  type ReengagementContactRow,
  type ReengagementLogEvent,
  type ReengagementProviderInstanceRow,
} from "../index.ts";

const ORIGINAL_DENO = (globalThis as unknown as { Deno?: unknown }).Deno;

function setDenoEnv(vars: Record<string, string | undefined>): void {
  (globalThis as unknown as { Deno?: unknown }).Deno = {
    env: { get: (name: string) => vars[name] },
  };
}

afterEach(() => {
  (globalThis as unknown as { Deno?: unknown }).Deno = ORIGINAL_DENO;
});

const SUPABASE_URL = "https://fake-project.supabase.co";
const SERVICE_ROLE_KEY = "fake-service-role-key";
const REENGAGEMENT_SECRET = "correct-reengagement-secret";

function fullConfigEnv(): Record<string, string> {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    WHATSAPP_REENGAGEMENT_SECRET: REENGAGEMENT_SECRET,
  };
}

function makeRequest(
  method: string,
  opts: { headers?: Record<string, string>; search?: string } = {},
): Request {
  const url = `https://example.invalid/whatsapp-reengagement${opts.search ?? ""}`;
  return new Request(url, { method, headers: opts.headers ?? {} });
}

function silentLogger(): (event: ReengagementLogEvent) => void {
  return () => {};
}

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

// ============================================================
// safeEqual / createProductionLogger
// ============================================================

describe("safeEqual", () => {
  test("strings iguais => true", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });
  test("strings diferentes => false", () => {
    expect(safeEqual("abc123", "xyz789")).toBe(false);
  });
});

describe("createProductionLogger", () => {
  const ORIGINAL_LOG = console.log;
  const ORIGINAL_ERROR = console.error;

  afterEach(() => {
    console.log = ORIGINAL_LOG;
    console.error = ORIGINAL_ERROR;
  });

  test("candidate_error vai pro console.error", () => {
    const errorCalls: string[] = [];
    console.error = ((...args: unknown[]) => {
      errorCalls.push(args.map(String).join(" "));
    }) as typeof console.error;
    console.log = (() => {}) as typeof console.log;

    createProductionLogger()({ event: "candidate_error", contactId: "c1" });
    expect(errorCalls.length).toBe(1);
  });

  test("batch_started vai pro console.log", () => {
    const logCalls: string[] = [];
    console.log = ((...args: unknown[]) => {
      logCalls.push(args.map(String).join(" "));
    }) as typeof console.log;
    console.error = (() => {}) as typeof console.error;

    createProductionLogger()({ event: "batch_started", limit: 200 });
    expect(logCalls.length).toBe(1);
  });
});

// ============================================================
// Mock client estrutural — filtragem real, não listas pré-recortadas.
// ============================================================

type MockClientOptions = {
  contacts: ReengagementContactRow[];
  instances: ReengagementProviderInstanceRow[];
  // contactId -> created_at ISO da linha 'commercial' mais recente já enviada.
  commercialHistory?: Map<string, string>;
  insertShouldFail?: (row: Record<string, unknown>) => boolean;
};

function makeMockClient(opts: MockClientOptions) {
  const calls = {
    inserts: [] as Record<string, unknown>[],
  };
  const history = opts.commercialHistory ?? new Map<string, string>();

  function contactsChain(afterVerifiedNotNull: ReengagementContactRow[]) {
    return {
      eq: (_c2: string, _v2: boolean) => ({
        eq: (_c3: string, _v3: boolean) => ({
          not: (_c4: string, _op4: string, _v4: null) => {
            const afterLastInboundNotNull = afterVerifiedNotNull.filter(
              (c) => c.last_inbound_at !== null,
            );
            return {
              lte: async (_c5: string, cutoffIso: string) => ({
                data: afterLastInboundNotNull.filter(
                  (c) => (c.last_inbound_at as string) <= cutoffIso,
                ),
                error: null,
              }),
            };
          },
          is: (_c4b: string, _v4b: null) => {
            const afterLastInboundNull = afterVerifiedNotNull.filter(
              (c) => c.last_inbound_at === null,
            );
            return {
              lte: async (_c5: string, cutoffIso: string) => ({
                data: afterLastInboundNull.filter(
                  (c) => c.verified_at !== null && (c.verified_at as string) <= cutoffIso,
                ),
                error: null,
              }),
            };
          },
        }),
      }),
    };
  }

  const client: ReengagementClient = {
    from(table: string) {
      if (table === "whatsapp_contacts") {
        return {
          select: (_cols: string) => ({
            not: (_c1: string, _op1: string, _v1: null) =>
              contactsChain(opts.contacts.filter((c) => c.verified_at !== null)),
          }),
        };
      }
      if (table === "whatsapp_provider_instances") {
        return {
          select: (_cols: string) => ({
            eq: async (_c: string, _v: string) => ({
              data: opts.instances.filter((i) => i.status === "active"),
              error: null,
            }),
          }),
        };
      }
      if (table === "whatsapp_outbound_queue") {
        return {
          select: (_cols: string) => ({
            eq: (_c: string, contactId: string) => ({
              eq: (_c2: string, _purpose: string) => ({
                order: (_c3: string, _o: { ascending: boolean }) => ({
                  limit: async (_n: number) => {
                    const createdAt = history.get(contactId);
                    return { data: createdAt ? [{ created_at: createdAt }] : [], error: null };
                  },
                }),
              }),
            }),
          }),
          insert: async (row: Record<string, unknown>) => {
            calls.inserts.push(row);
            if (opts.insertShouldFail?.(row)) {
              return { error: { message: "duplicate key" } };
            }
            return { error: null };
          },
        };
      }
      throw new Error(`tabela não mockada: ${table}`);
    },
  } as unknown as ReengagementClient;

  return { client, calls };
}

const CONTACT_ID = "contact-1";
const USER_ID = "user-1";

function baseContact(overrides: Partial<ReengagementContactRow> = {}): ReengagementContactRow {
  return {
    id: CONTACT_ID,
    user_id: USER_ID,
    last_inbound_at: null,
    verified_at: daysAgoIso(30),
    assigned_provider: "zapi",
    assigned_instance_id: "inst-1",
    ...overrides,
  };
}

function baseInstance(
  overrides: Partial<ReengagementProviderInstanceRow> = {},
): ReengagementProviderInstanceRow {
  return { provider: "zapi", instance_id: "inst-1", status: "active", ...overrides };
}

// ============================================================
// runReengagementBatch — cenários exigidos
// ============================================================

describe("runReengagementBatch", () => {
  test("1) coorte A, nunca reengajado antes => insere com texto de coorte A", async () => {
    const { client, calls } = makeMockClient({
      contacts: [baseContact({ last_inbound_at: daysAgoIso(10) })],
      instances: [baseInstance()],
    });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(1);
    expect(result.sentByCohort).toEqual({ a: 1, b: 0 });
    expect(calls.inserts.length).toBe(1);
    expect(calls.inserts[0]!.text_body).toBe(REENGAGEMENT_TEXT_COHORT_A);
    expect(calls.inserts[0]!.purpose).toBe("commercial");
    expect(calls.inserts[0]!.vehicle_id).toBeNull();
    expect(calls.inserts[0]!.idempotency_key).toMatch(/^reengagement:contact-1:\d{4}-\d{2}-\d{2}$/);
  });

  test("2) coorte A, reengajado há mais de 8 dias => prossegue, manda de novo", async () => {
    const history = new Map([[CONTACT_ID, daysAgoIso(9)]]);
    const { client, calls } = makeMockClient({
      contacts: [baseContact({ last_inbound_at: daysAgoIso(10) })],
      instances: [baseInstance()],
      commercialHistory: history,
    });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(1);
    expect(result.skipped.recently_engaged).toBe(0);
    expect(calls.inserts.length).toBe(1);
  });

  test("3) coorte A, reengajado há menos de 8 dias => pula (recently_engaged)", async () => {
    const history = new Map([[CONTACT_ID, daysAgoIso(3)]]);
    const { client, calls } = makeMockClient({
      contacts: [baseContact({ last_inbound_at: daysAgoIso(10) })],
      instances: [baseInstance()],
      commercialHistory: history,
    });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(0);
    expect(result.skipped.recently_engaged).toBe(1);
    expect(calls.inserts.length).toBe(0);
  });

  test("4) coorte B, nunca reengajado antes => insere com texto de coorte B", async () => {
    const { client, calls } = makeMockClient({
      contacts: [baseContact({ last_inbound_at: null, verified_at: daysAgoIso(9) })],
      instances: [baseInstance()],
    });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(1);
    expect(result.sentByCohort).toEqual({ a: 0, b: 1 });
    expect(calls.inserts.length).toBe(1);
    expect(calls.inserts[0]!.text_body).toBe(REENGAGEMENT_TEXT_COHORT_B);
    expect(calls.inserts[0]!.purpose).toBe("commercial");
  });

  test("5) coorte B, reengajado há menos de 8 dias => pula", async () => {
    const history = new Map([[CONTACT_ID, daysAgoIso(1)]]);
    const { client, calls } = makeMockClient({
      contacts: [baseContact({ last_inbound_at: null, verified_at: daysAgoIso(9) })],
      instances: [baseInstance()],
      commercialHistory: history,
    });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(0);
    expect(result.skipped.recently_engaged).toBe(1);
    expect(calls.inserts.length).toBe(0);
  });

  test("6) last_inbound_at dentro dos 8 dias => não vira candidato de nenhuma coorte", async () => {
    const { client, calls } = makeMockClient({
      contacts: [baseContact({ last_inbound_at: daysAgoIso(2) })],
      instances: [baseInstance()],
    });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.candidatesEvaluated).toBe(0);
    expect(result.sent).toBe(0);
    expect(calls.inserts.length).toBe(0);
  });

  test("7) verified_at dentro dos 8 dias E last_inbound_at nulo => não vira candidato (coorte B ainda não elegível)", async () => {
    const { client, calls } = makeMockClient({
      contacts: [baseContact({ last_inbound_at: null, verified_at: daysAgoIso(2) })],
      instances: [baseInstance()],
    });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.candidatesEvaluated).toBe(0);
    expect(result.sent).toBe(0);
    expect(calls.inserts.length).toBe(0);
  });

  test("8) contato sem instância ativa correspondente => no_instance, nunca avaliado", async () => {
    const { client, calls } = makeMockClient({
      contacts: [baseContact({ last_inbound_at: daysAgoIso(10) })],
      instances: [baseInstance({ instance_id: "outro-inst" })],
    });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.candidatesEvaluated).toBe(0);
    expect(result.skipped.no_instance).toBe(1);
    expect(calls.inserts.length).toBe(0);
  });

  test("9) insert duplicado (mesmo dia) => duplicate_queued, não derruba o lote", async () => {
    const contact2 = baseContact({ id: "contact-2", user_id: "user-2", last_inbound_at: daysAgoIso(10) });
    const { client, calls } = makeMockClient({
      contacts: [baseContact({ last_inbound_at: daysAgoIso(10) }), contact2],
      instances: [baseInstance()],
      insertShouldFail: (row) => row.contact_id === CONTACT_ID,
    });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.skipped.duplicate_queued).toBe(1);
    expect(result.sent).toBe(1);
    expect(calls.inserts.length).toBe(2);
  });

  test("10) autenticação/config ausente => 401/500 (mesmos testes de sempre)", async () => {
    setDenoEnv({});
    const res1 = await handleRequest(makeRequest("POST"));
    expect(res1.status).toBe(500);
    expect(await res1.json()).toEqual({ error: "server_not_configured" });

    setDenoEnv({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY });
    const res2 = await handleRequest(makeRequest("POST"));
    expect(res2.status).toBe(500);
    expect(await res2.json()).toEqual({ error: "worker_not_configured" });

    setDenoEnv(fullConfigEnv());
    const res3 = await handleRequest(makeRequest("POST"));
    expect(res3.status).toBe(401);
  });

  test("11) os 2 textos exatos", () => {
    expect(REENGAGEMENT_TEXT_COHORT_A).toBe(
      "Oi! 👋 Faz um tempinho que você não aparece por aqui. Quer atualizar a km do seu carro, tirar uma dúvida técnica, ou só dar um oi? Tô sempre por aqui, pronto pra ajudar! 🚗",
    );
    expect(REENGAGEMENT_TEXT_COHORT_B).toBe(
      "Oi! 👋 Vi que você já conectou seu WhatsApp aqui, mas ainda não trocamos uma ideia! É só me mandar um 'oi', contar sobre a última manutenção que você fez, ou perguntar qualquer coisa sobre seu carro — tô aqui pra ajudar! 🚗",
    );
  });

  test("12) um contato não pode ser candidato das duas coortes ao mesmo tempo (last_inbound_at é NULL xor não-NULL)", async () => {
    // Uma única lista com 4 contatos: 2 elegíveis pra coorte A, 1 elegível
    // pra coorte B, 1 não elegível pra nenhuma — prova, a partir do mesmo
    // dado, que a filtragem real (não uma lista pré-recortada) nunca
    // duplica um contato entre as duas coortes.
    const contacts: ReengagementContactRow[] = [
      baseContact({ id: "a1", last_inbound_at: daysAgoIso(10) }), // coorte A
      baseContact({ id: "a2", last_inbound_at: daysAgoIso(20) }), // coorte A
      baseContact({ id: "b1", last_inbound_at: null, verified_at: daysAgoIso(9) }), // coorte B
      baseContact({ id: "n1", last_inbound_at: daysAgoIso(1) }), // nenhuma (recente)
    ];
    const { client } = makeMockClient({ contacts, instances: [baseInstance()] });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    // 3 candidatos avaliados (a1, a2, b1) — n1 fora da janela, nunca conta.
    expect(result.candidatesEvaluated).toBe(3);
    expect(result.sentByCohort).toEqual({ a: 2, b: 1 });
    // Nenhum contato apareceu nas duas coortes: soma bate exatamente com
    // o total de candidatos elegíveis (sem overlap/duplicata).
    expect(result.sentByCohort.a + result.sentByCohort.b).toBe(result.candidatesEvaluated);
  });

  test("múltiplos candidatos: contagens agregadas corretamente", async () => {
    const contacts: ReengagementContactRow[] = [
      baseContact({ id: "a1", last_inbound_at: daysAgoIso(10) }),
      baseContact({ id: "b1", last_inbound_at: null, verified_at: daysAgoIso(15) }),
    ];
    const history = new Map([["a1", daysAgoIso(3)]]); // a1 reengajado recentemente => pula
    const { client } = makeMockClient({ contacts, instances: [baseInstance()], commercialHistory: history });

    const result = await runReengagementBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.candidatesEvaluated).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.sentByCohort).toEqual({ a: 0, b: 1 });
    expect(result.skipped.recently_engaged).toBe(1);
  });
});

// ============================================================
// handleRequest — método, CORS, config, autenticação
// ============================================================

describe("handleRequest — método e CORS", () => {
  test("OPTIONS => 204", async () => {
    const res = await handleRequest(makeRequest("OPTIONS"));
    expect(res.status).toBe(204);
  });

  test("GET => 405", async () => {
    const res = await handleRequest(makeRequest("GET"));
    expect(res.status).toBe(405);
  });
});

describe("handleRequest — configuração ausente", () => {
  test("sem nenhuma env => 500 server_not_configured", async () => {
    setDenoEnv({});
    const res = await handleRequest(makeRequest("POST"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_not_configured" });
  });

  test("SUPABASE_URL/SERVICE_ROLE_KEY presentes, REENGAGEMENT_SECRET ausente => 500 worker_not_configured", async () => {
    setDenoEnv({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY });
    const res = await handleRequest(makeRequest("POST"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "worker_not_configured" });
  });
});

describe("handleRequest — autenticação", () => {
  test("sem header x-reengagement-secret => 401", async () => {
    setDenoEnv(fullConfigEnv());
    const res = await handleRequest(makeRequest("POST"));
    expect(res.status).toBe(401);
  });

  test("header com valor errado => 401", async () => {
    setDenoEnv(fullConfigEnv());
    const res = await handleRequest(
      makeRequest("POST", { headers: { "x-reengagement-secret": "valor-errado" } }),
    );
    expect(res.status).toBe(401);
  });

  test("header correto => passa da checagem de autenticação (nunca 401)", async () => {
    setDenoEnv(fullConfigEnv());
    const res = await handleRequest(
      makeRequest("POST", { headers: { "x-reengagement-secret": REENGAGEMENT_SECRET } }),
    );
    // Mesma ressalva documentada nos builds anteriores: o import dinâmico
    // de esm.sh é bloqueado pelo proxy de rede deste sandbox — cai no
    // catch geral (500). O que importa aqui é que a autenticação foi
    // superada antes disso.
    expect(res.status).not.toBe(401);
    expect([200, 500]).toContain(res.status);
  });
});
