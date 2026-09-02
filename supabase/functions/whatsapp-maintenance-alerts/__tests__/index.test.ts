// Testes de whatsapp-maintenance-alerts/index.ts (Build Maintenance-Alert).
// Runner: bun test. Mesmo padrão de whatsapp-process-orchestrator/
// __tests__/index.test.ts: mocka globalThis.Deno (env) com afterEach
// restaurando, client estrutural mockado (nunca mock.module()).

import { afterEach, describe, expect, test } from "bun:test";
import {
  createProductionLogger,
  handleRequest,
  runMaintenanceAlertsBatch,
  safeEqual,
  type MaintenanceAlertsClient,
  type MaintenanceAlertsLogEvent,
  type MilestoneNoticeRow,
  type VehicleCandidateRow,
  type WhatsappContactRow,
  type WhatsappProviderInstanceRow,
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
const ALERTS_SECRET = "correct-maintenance-alerts-secret";

function fullConfigEnv(): Record<string, string> {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    WHATSAPP_MAINTENANCE_ALERTS_SECRET: ALERTS_SECRET,
  };
}

function makeRequest(
  method: string,
  opts: { headers?: Record<string, string>; search?: string } = {},
): Request {
  const url = `https://example.invalid/whatsapp-maintenance-alerts${opts.search ?? ""}`;
  return new Request(url, { method, headers: opts.headers ?? {} });
}

function silentLogger(): (event: MaintenanceAlertsLogEvent) => void {
  return () => {};
}

// ============================================================
// safeEqual (mesma prova de sempre)
// ============================================================

describe("safeEqual", () => {
  test("strings iguais => true", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });
  test("strings diferentes => false", () => {
    expect(safeEqual("abc123", "xyz789")).toBe(false);
  });
});

// ============================================================
// createProductionLogger
// ============================================================

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

    createProductionLogger()({ event: "candidate_error", vehicleId: "v1" });
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
// Mock client estrutural
// ============================================================

type MockClientOptions = {
  vehicles: VehicleCandidateRow[];
  contacts: WhatsappContactRow[];
  instances: WhatsappProviderInstanceRow[];
  notices?: Map<string, MilestoneNoticeRow>;
  insertShouldFail?: (row: Record<string, unknown>) => boolean;
};

function makeMockClient(opts: MockClientOptions) {
  const calls = {
    inserts: [] as Record<string, unknown>[],
    rpcCalls: [] as { fn: string; params: Record<string, unknown> }[],
  };
  const notices = opts.notices ?? new Map<string, MilestoneNoticeRow>();

  const client: MaintenanceAlertsClient = {
    from(table: string) {
      if (table === "veiculos") {
        return {
          select: (_cols: string) => ({
            in: (_col: string, _vals: string[]) => ({
              not: (_col2: string, _op: string, _val: null) => ({
                limit: async (_n: number) => ({ data: opts.vehicles, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "whatsapp_contacts") {
        return {
          select: (_cols: string) => ({
            in: (_col: string, userIds: string[]) => ({
              not: (_c2: string, _op: string, _v: null) => ({
                eq: (_c3: string, _v3: boolean) => ({
                  eq: async (_c4: string, _v4: boolean) => ({
                    data: opts.contacts.filter((c) => userIds.includes(c.user_id)),
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "whatsapp_provider_instances") {
        return {
          select: (_cols: string) => ({
            eq: async (_c: string, _v: string) => ({ data: opts.instances, error: null }),
          }),
        };
      }
      if (table === "whatsapp_milestone_notices") {
        return {
          select: (_cols: string) => ({
            eq: (_c: string, vehicleId: string) => ({
              eq: (_c2: string, milestoneKm: number) => ({
                maybeSingle: async () => {
                  const key = `${vehicleId}:${milestoneKm}`;
                  return { data: notices.get(key) ?? null, error: null };
                },
              }),
            }),
          }),
        };
      }
      if (table === "whatsapp_outbound_queue") {
        return {
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
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.rpcCalls.push({ fn, params });
      return { data: { kind: "recorded" }, error: null };
    },
  } as unknown as MaintenanceAlertsClient;

  return { client, calls };
}

const VEHICLE_ID = "veh-1";
const USER_ID = "user-1";
const CONTACT_ID = "contact-1";

function baseVehicle(overrides: Partial<VehicleCandidateRow> = {}): VehicleCandidateRow {
  return {
    id: VEHICLE_ID,
    marca: "Toyota",
    modelo: "Corolla",
    km_atual: 119000, // dentro da janela do marco 120000 (distância 1000 <= 2000)
    jarvys_technical_profile: {
      fuelKind: "combustao",
      timingSystem: "correia_dentada",
      transmissionKind: "automatico",
      steeringKind: "hidraulica",
    },
    user_id: USER_ID,
    ...overrides,
  };
}

function baseContact(overrides: Partial<WhatsappContactRow> = {}): WhatsappContactRow {
  return {
    id: CONTACT_ID,
    user_id: USER_ID,
    assigned_provider: "zapi",
    assigned_instance_id: "inst-1",
    ...overrides,
  };
}

function baseInstance(overrides: Partial<WhatsappProviderInstanceRow> = {}): WhatsappProviderInstanceRow {
  return {
    provider: "zapi",
    instance_id: "inst-1",
    status: "active",
    ...overrides,
  };
}

// ============================================================
// runMaintenanceAlertsBatch — cenários exigidos
// ============================================================

describe("runMaintenanceAlertsBatch", () => {
  test("1) dentro da janela, nunca notificado => insere outbound + chama a RPC", async () => {
    const { client, calls } = makeMockClient({
      vehicles: [baseVehicle()],
      contacts: [baseContact()],
      instances: [baseInstance()],
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(1);
    expect(result.candidatesEvaluated).toBe(1);
    expect(calls.inserts.length).toBe(1);
    expect(calls.inserts[0]!.vehicle_id).toBe(VEHICLE_ID);
    expect(calls.inserts[0]!.purpose).toBe("notification");
    expect(calls.inserts[0]!.status).toBe("queued");
    expect(calls.inserts[0]!.idempotency_key).toBe(`milestone_alert:${VEHICLE_ID}:120000`);
    expect(calls.rpcCalls.length).toBe(1);
    expect(calls.rpcCalls[0]!.fn).toBe("record_whatsapp_milestone_notice");
    expect(calls.rpcCalls[0]!.params).toEqual({
      p_user_id: USER_ID,
      p_vehicle_id: VEHICLE_ID,
      p_milestone_km: 120000,
      p_action: "notified",
    });
  });

  test("2) dentro da janela, já 'notified' pra esse marco => pula, nenhum insert/RPC", async () => {
    const notices = new Map<string, MilestoneNoticeRow>([
      [`${VEHICLE_ID}:120000`, { status: "notified", snoozed_until: null }],
    ]);
    const { client, calls } = makeMockClient({
      vehicles: [baseVehicle()],
      contacts: [baseContact()],
      instances: [baseInstance()],
      notices,
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(0);
    expect(result.skipped.already_notified).toBe(1);
    expect(calls.inserts.length).toBe(0);
    expect(calls.rpcCalls.length).toBe(0);
  });

  test("3) dentro da janela, 'snoozed' com snoozed_until no futuro => pula", async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    const notices = new Map<string, MilestoneNoticeRow>([
      [`${VEHICLE_ID}:120000`, { status: "snoozed", snoozed_until: future }],
    ]);
    const { client, calls } = makeMockClient({
      vehicles: [baseVehicle()],
      contacts: [baseContact()],
      instances: [baseInstance()],
      notices,
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(0);
    expect(result.skipped.snoozed).toBe(1);
    expect(calls.inserts.length).toBe(0);
    expect(calls.rpcCalls.length).toBe(0);
  });

  test("4) dentro da janela, 'snoozed' com snoozed_until no passado => prossegue (envia)", async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    const notices = new Map<string, MilestoneNoticeRow>([
      [`${VEHICLE_ID}:120000`, { status: "snoozed", snoozed_until: past }],
    ]);
    const { client, calls } = makeMockClient({
      vehicles: [baseVehicle()],
      contacts: [baseContact()],
      instances: [baseInstance()],
      notices,
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(1);
    expect(result.skipped.snoozed).toBe(0);
    expect(calls.inserts.length).toBe(1);
    expect(calls.rpcCalls.length).toBe(1);
  });

  test("5) fora da janela => pula, nem consulta o cache de notices", async () => {
    const { client, calls } = makeMockClient({
      vehicles: [baseVehicle({ km_atual: 115000 })], // distância 5000 > ALERT_WINDOW (2000)
      contacts: [baseContact()],
      instances: [baseInstance()],
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(0);
    expect(result.skipped.outside_window).toBe(1);
    expect(calls.inserts.length).toBe(0);
    expect(calls.rpcCalls.length).toBe(0);
  });

  test("6) sem jarvys_technical_profile => usa fallback, ainda gera itens base e envia", async () => {
    const { client, calls } = makeMockClient({
      vehicles: [baseVehicle({ jarvys_technical_profile: null })],
      contacts: [baseContact()],
      instances: [baseInstance()],
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(1);
    expect(calls.inserts.length).toBe(1);
    const text = calls.inserts[0]!.text_body as string;
    // Marco 120000 com perfil fallback (timing/transmissão/direção
    // "desconhecido") ainda gera os itens base (óleo, filtro etc.) —
    // confirma que o texto não ficou vazio/quebrado.
    expect(text.includes("Óleo e filtro de óleo") || text.includes("💧")).toBe(true);
  });

  test("status 'dismissed' => pula, nenhum insert/RPC", async () => {
    const notices = new Map<string, MilestoneNoticeRow>([
      [`${VEHICLE_ID}:120000`, { status: "dismissed", snoozed_until: null }],
    ]);
    const { client, calls } = makeMockClient({
      vehicles: [baseVehicle()],
      contacts: [baseContact()],
      instances: [baseInstance()],
      notices,
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(0);
    expect(result.skipped.dismissed).toBe(1);
    expect(calls.inserts.length).toBe(0);
    expect(calls.rpcCalls.length).toBe(0);
  });

  test("veículo sem contato válido (verificado/opt_out/is_primary) => no_contact, nunca vira candidato avaliado", async () => {
    const { client, calls } = makeMockClient({
      vehicles: [baseVehicle()],
      contacts: [], // nenhum contato bate
      instances: [baseInstance()],
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.candidatesEvaluated).toBe(0);
    expect(result.skipped.no_contact).toBe(1);
    expect(calls.inserts.length).toBe(0);
  });

  test("contato sem instância ativa correspondente => no_instance", async () => {
    const { client, calls } = makeMockClient({
      vehicles: [baseVehicle()],
      contacts: [baseContact()],
      instances: [baseInstance({ status: "active", instance_id: "outro-inst" })], // não bate com o do contato
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.candidatesEvaluated).toBe(0);
    expect(result.skipped.no_instance).toBe(1);
    expect(calls.inserts.length).toBe(0);
  });

  test("insert em whatsapp_outbound_queue falha (ex: idempotency_key duplicada) => pula, não chama RPC", async () => {
    const { client, calls } = makeMockClient({
      vehicles: [baseVehicle()],
      contacts: [baseContact()],
      instances: [baseInstance()],
      insertShouldFail: () => true,
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.sent).toBe(0);
    expect(result.skipped.duplicate_queued).toBe(1);
    expect(calls.rpcCalls.length).toBe(0);
  });

  test("múltiplos veículos: contagens agregadas corretamente", async () => {
    const v2 = baseVehicle({ id: "veh-2", km_atual: 115000, user_id: "user-2" });
    const c2 = baseContact({ id: "contact-2", user_id: "user-2" });
    const notices = new Map<string, MilestoneNoticeRow>([
      [`${VEHICLE_ID}:120000`, { status: "notified", snoozed_until: null }],
    ]);
    const { client } = makeMockClient({
      vehicles: [baseVehicle(), v2],
      contacts: [baseContact(), c2],
      instances: [baseInstance()],
      notices,
    });

    const result = await runMaintenanceAlertsBatch(client, { limit: 200, logger: silentLogger() });

    expect(result.candidatesEvaluated).toBe(2);
    expect(result.sent).toBe(0);
    expect(result.skipped.already_notified).toBe(1);
    expect(result.skipped.outside_window).toBe(1);
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
    const body = await res.json();
    expect(body).toEqual({ error: "server_not_configured" });
  });

  test("SUPABASE_URL/SERVICE_ROLE_KEY presentes, ALERTS_SECRET ausente => 500 worker_not_configured", async () => {
    setDenoEnv({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY });
    const res = await handleRequest(makeRequest("POST"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "worker_not_configured" });
  });
});

describe("handleRequest — autenticação", () => {
  test("sem header x-maintenance-alerts-secret => 401", async () => {
    setDenoEnv(fullConfigEnv());
    const res = await handleRequest(makeRequest("POST"));
    expect(res.status).toBe(401);
  });

  test("header com valor errado => 401", async () => {
    setDenoEnv(fullConfigEnv());
    const res = await handleRequest(
      makeRequest("POST", { headers: { "x-maintenance-alerts-secret": "valor-errado" } }),
    );
    expect(res.status).toBe(401);
  });

  test("header correto => passa da checagem de autenticação (nunca 401)", async () => {
    setDenoEnv(fullConfigEnv());
    const res = await handleRequest(
      makeRequest("POST", { headers: { "x-maintenance-alerts-secret": ALERTS_SECRET } }),
    );
    // Mesma ressalva documentada em whatsapp-process-orchestrator/
    // __tests__/index.test.ts: o import dinâmico de esm.sh é bloqueado
    // pelo proxy de rede deste sandbox — cai no catch geral (500). O que
    // importa aqui é que a autenticação foi superada antes disso.
    expect(res.status).not.toBe(401);
    expect([200, 500]).toContain(res.status);
  });
});
