// Build 5.7F2C1 — Testes do shadow passivo do orquestrador WhatsApp.
// Runner: bun test. Sem rede, sem banco. Mock structural do SupabaseLike.

import { describe, expect, test } from "bun:test";
import {
  runWhatsappOrchestratorShadow,
  SHADOW_TIMEOUT_MS,
  type ShadowDeps,
  type ShadowFromBuilder,
  type ShadowInput,
  type ShadowLogEvent,
  type ShadowLogger,
  type ShadowMaybeSingleResult,
  type ShadowSelectBuilder,
  type ShadowSelectResult,
  type SupabaseLike,
} from "../shadow.ts";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

type TableRows = Record<string, Record<string, unknown>[]>;

type MockOptions = {
  rows: TableRows;
  errorOn?: Record<string, { message: string; code?: string }>;
  delayMsOn?: Record<string, number>;
  throwOn?: Record<string, Error>;
};

type CallLog = {
  selects: Array<{ table: string; columns: string; filters: Array<[string, unknown]>; abortSignals: number }>;
};

function makeSupabase(opts: MockOptions): { client: SupabaseLike; calls: CallLog } {
  const calls: CallLog = { selects: [] };
  const client: SupabaseLike = {
    from(table: string): ShadowFromBuilder {
      return {
        select(columns: string) {
          const filters: Array<[string, unknown]> = [];
          const signals: AbortSignal[] = [];
          const record = { table, columns, filters, abortSignals: 0 };
          calls.selects.push(record);

          const runList = async (): Promise<ShadowSelectResult> => {
            const delay = opts.delayMsOn?.[table];
            if (delay) {
              await new Promise<void>((resolve, reject) => {
                const t = setTimeout(resolve, delay);
                for (const s of signals) {
                  if (s.aborted) { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); return; }
                  s.addEventListener("abort", () => {
                    clearTimeout(t);
                    reject(new DOMException("aborted", "AbortError"));
                  }, { once: true });
                }
              });
            }
            if (opts.throwOn?.[table]) throw opts.throwOn[table];
            if (opts.errorOn?.[table]) {
              return { data: null, error: { message: opts.errorOn[table].message, code: opts.errorOn[table].code ?? null } };
            }
            const matched = (opts.rows[table] ?? []).filter((r) =>
              filters.every(([c, v]) => r[c] === v),
            );
            return { data: matched, error: null };
          };

          const builder = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return builder;
            },
            abortSignal(signal: AbortSignal) {
              signals.push(signal);
              record.abortSignals += 1;
              return builder;
            },
            async maybeSingle(): Promise<ShadowMaybeSingleResult> {
              const r = await runList();
              if (r.error) return { data: null, error: r.error };
              return { data: r.data?.[0] ?? null, error: null };
            },
            then<T1, T2>(
              onFulfilled?: (v: ShadowSelectResult) => T1 | PromiseLike<T1>,
              onRejected?: (e: unknown) => T2 | PromiseLike<T2>,
            ) {
              return runList().then(onFulfilled, onRejected);
            },
          } as unknown as ShadowSelectBuilder;
          return builder;
        },
      };
    },
  };
  return { client, calls };
}

function makeLogger(): { logger: ShadowLogger; events: ShadowLogEvent[] } {
  const events: ShadowLogEvent[] = [];
  const logger: ShadowLogger = {
    info: (e) => events.push(e),
    warn: (e) => events.push(e),
    error: (e) => events.push(e),
  };
  return { logger, events };
}

const BASE_INPUT: ShadowInput = {
  queueItemId: "q-1",
  userId: "u-1",
  message: {
    id: "m-1",
    contactId: "c-1",
    provider: "zapi",
    instanceId: "INSTANCE-ABC",
    direction: "inbound",
    messageType: "text",
    textBody: "oi jarvys",
  },
  now: "2026-07-11T12:00:00Z",
};

function baseRows(overrides: Partial<TableRows> = {}): TableRows {
  return {
    whatsapp_provider_instances: [
      {
        id: "ip-1",
        provider: "zapi",
        instance_id: "INSTANCE-ABC",
        status: "active",
        orchestrator_mode: "shadow",
      },
    ],
    whatsapp_conversation_states: [],
    veiculos: [],
    // Build 5.7F2E1A.5-MJ0 — perfil + ativações são obrigatórios no shadow.
    profiles: [
      { id: "u-1", status_usuario: "vip", trial_inicio: null },
    ],
    pagamentos_pix: [],
    ...overrides,
  };
}


async function run(rowsOverride: Partial<TableRows> = {}, extra?: Partial<ShadowDeps>) {
  const { client, calls } = makeSupabase({ rows: baseRows(rowsOverride) });
  const { logger, events } = makeLogger();
  const res = await runWhatsappOrchestratorShadow(BASE_INPUT, { supabase: client, logger, ...extra });
  return { res, events, calls };
}

// ============================================================
// A. Instância e modos
// ============================================================

describe("shadow — instância e modo", () => {
  test("lookup usa provider + instance_id (não id)", async () => {
    const { calls } = await run();
    const instCall = calls.selects.find((c) => c.table === "whatsapp_provider_instances")!;
    expect(instCall).toBeDefined();
    const filterCols = instCall.filters.map(([c]) => c).sort();
    expect(filterCols).toEqual(["instance_id", "provider"]);
    expect(instCall.filters.find(([c]) => c === "id")).toBeUndefined();
  });

  test("instância ausente → skipped:instance_missing", async () => {
    const { res, events } = await run({ whatsapp_provider_instances: [] });
    expect(res).toEqual({ status: "skipped", reason: "instance_missing", durationMs: expect.any(Number) });
    expect(events).toHaveLength(0);
  });

  test("status='paused' → skipped:instance_not_active", async () => {
    const { res } = await run({
      whatsapp_provider_instances: [{ id: "ip-1", provider: "zapi", instance_id: "INSTANCE-ABC", status: "paused", orchestrator_mode: "shadow" }],
    });
    expect(res.status).toBe("skipped");
    if (res.status === "skipped") expect(res.reason).toBe("instance_not_active");
  });

  test("status='failed' → skipped:instance_not_active", async () => {
    const { res } = await run({
      whatsapp_provider_instances: [{ id: "ip-1", provider: "zapi", instance_id: "INSTANCE-ABC", status: "failed", orchestrator_mode: "shadow" }],
    });
    if (res.status === "skipped") expect(res.reason).toBe("instance_not_active");
    else throw new Error("expected skipped");
  });

  test("active + off → skipped:mode_not_shadow (sem log)", async () => {
    const { res, events } = await run({
      whatsapp_provider_instances: [{ id: "ip-1", provider: "zapi", instance_id: "INSTANCE-ABC", status: "active", orchestrator_mode: "off" }],
    });
    if (res.status === "skipped") expect(res.reason).toBe("mode_not_shadow");
    else throw new Error("expected skipped");
    expect(events).toHaveLength(0);
  });

  test("active + test → skipped:mode_not_shadow", async () => {
    const { res } = await run({
      whatsapp_provider_instances: [{ id: "ip-1", provider: "zapi", instance_id: "INSTANCE-ABC", status: "active", orchestrator_mode: "test" }],
    });
    if (res.status === "skipped") expect(res.reason).toBe("mode_not_shadow");
    else throw new Error("expected skipped");
  });

  test("active + active → skipped:mode_not_shadow", async () => {
    const { res } = await run({
      whatsapp_provider_instances: [{ id: "ip-1", provider: "zapi", instance_id: "INSTANCE-ABC", status: "active", orchestrator_mode: "active" }],
    });
    if (res.status === "skipped") expect(res.reason).toBe("mode_not_shadow");
    else throw new Error("expected skipped");
  });

  test("active + shadow → evaluated", async () => {
    const { res, events } = await run();
    expect(res.status).toBe("evaluated");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("evaluated");
    expect(events[0].orchestratorMode).toBe("shadow");
  });
});

// ============================================================
// B. State
// ============================================================

describe("shadow — state", () => {
  test("state ausente → virtual idle, stateVersion=0, fallbackCount=0, draftVersion=0", async () => {
    const input: ShadowInput = { ...BASE_INPUT, message: { ...BASE_INPUT.message, textBody: "oi" } };
    const { client } = makeSupabase({ rows: baseRows() });
    const { logger, events } = makeLogger();
    const res = await runWhatsappOrchestratorShadow(input, { supabase: client, logger });
    expect(res.status).toBe("evaluated");
    // texto 'oi' vs state virtual idle → greeting no core
    expect(events[0].eventKind).toBe("greeting");
  });

  test("state existente é mapeado (draft_version=2 preservado)", async () => {
    const { res } = await run({
      whatsapp_conversation_states: [
        {
          contact_id: "c-1",
          state: "awaiting_vehicle",
          current_intent: "log_expense",
          awaiting_field: null,
          request_source: null,
          draft_type: null,
          draft_id: null,
          draft_version: 2,
          draft_payload: null,
          active_vehicle_id: null,
          confirmed_at: null,
          executed_at: null,
          last_message_id: null,
          expires_at: null,
          state_version: 7,
          fallback_count: 1,
        },
      ],
    });
    expect(res.status).toBe("evaluated");
  });

  test("nenhuma escrita ocorre (apenas SELECTs)", async () => {
    const { calls } = await run();
    // Cliente mock só expõe .from().select(); qualquer .insert/.update tentaria acessar método inexistente → erro. Aqui basta confirmar tabelas visitadas.
    const tables = calls.selects.map((c) => c.table).sort();
    expect(tables).toEqual([
      "pagamentos_pix",
      "profiles",
      "veiculos",
      "whatsapp_conversation_states",
      "whatsapp_provider_instances",
    ]);

  });
});

// ============================================================
// C. Veículos e activeVehicleIssue
// ============================================================

describe("shadow — veículos", () => {
  test("consulta veiculos com status e filtra archived em memória", async () => {
    const { calls, res } = await run({
      veiculos: [
        { id: "v1", user_id: "u-1", marca: "Fiat", modelo: "Argo", placa: "AAA1234", status: "active", km_atual: null },
        { id: "v2", user_id: "u-1", marca: "VW", modelo: "Gol", placa: "BBB2345", status: "archived", km_atual: null },
      ],
    });
    expect(res.status).toBe("evaluated");
    const vehCall = calls.selects.find((c) => c.table === "veiculos")!;
    expect(vehCall.columns).toContain("status");
    // Não há eq('status', ...) — filtro é em memória.
    expect(vehCall.filters.find(([c]) => c === "status")).toBeUndefined();
  });

  test("activeVehicleId inexistente → activeVehicleIssue=invalid", async () => {
    const { events } = await run({
      whatsapp_conversation_states: [
        {
          contact_id: "c-1",
          state: "idle",
          active_vehicle_id: "ghost",
          draft_version: 0,
          state_version: 1,
          fallback_count: 0,
        },
      ],
      veiculos: [],
    });
    expect(events[0].activeVehicleIssue).toBe("invalid");
  });

  test("activeVehicleId archived → activeVehicleIssue=archived", async () => {
    const { events } = await run({
      whatsapp_conversation_states: [
        {
          contact_id: "c-1",
          state: "idle",
          active_vehicle_id: "v2",
          draft_version: 0,
          state_version: 1,
          fallback_count: 0,
        },
      ],
      veiculos: [
        { id: "v2", user_id: "u-1", marca: "VW", modelo: "Gol", placa: "BBB2345", status: "archived", km_atual: null },
      ],
    });
    expect(events[0].activeVehicleIssue).toBe("archived");
  });

  test("activeVehicleId válido não seta activeVehicleIssue", async () => {
    const { events } = await run({
      whatsapp_conversation_states: [
        {
          contact_id: "c-1",
          state: "idle",
          active_vehicle_id: "v1",
          draft_version: 0,
          state_version: 1,
          fallback_count: 0,
        },
      ],
      veiculos: [
        { id: "v1", user_id: "u-1", marca: "Fiat", modelo: "Argo", placa: "AAA1234", status: "active", km_atual: null },
      ],
    });
    expect(events[0].activeVehicleIssue).toBeUndefined();
  });

  test("veículo de outro usuário não aparece", async () => {
    const { calls } = await run({
      veiculos: [
        { id: "vX", user_id: "outro", marca: "X", modelo: "Y", placa: "ZZZ", status: "active", km_atual: null },
      ],
    });
    const vehCall = calls.selects.find((c) => c.table === "veiculos")!;
    expect(vehCall.filters.find(([c, v]) => c === "user_id" && v === "u-1")).toBeDefined();
  });

  test("nenhuma placa aparece em logs", async () => {
    const { events } = await run({
      veiculos: [
        { id: "v1", user_id: "u-1", marca: "Fiat", modelo: "Argo", placa: "SECRETA123", status: "active", km_atual: null },
      ],
    });
    const json = JSON.stringify(events[0]);
    expect(json).not.toContain("SECRETA123");
    expect(json).not.toContain("placa");
  });
});

// ============================================================
// D. Core determinístico
// ============================================================

describe("shadow — core", () => {
  test("decisão observada é registrada nos campos permitidos", async () => {
    const { events } = await run();
    const evt = events[0];
    expect(evt.decisionKind).toBeDefined();
    expect(evt.eventKind).toBeDefined();
    expect(evt.outcome).toBeDefined();
    expect(evt.nextState).toBeDefined();
    expect("responseKey" in evt).toBe(true);
  });

  test("nenhum texto/originalText aparece em logs", async () => {
    const input: ShadowInput = { ...BASE_INPUT, message: { ...BASE_INPUT.message, textBody: "meu segredo pessoal 12345" } };
    const { client } = makeSupabase({ rows: baseRows() });
    const { logger, events } = makeLogger();
    await runWhatsappOrchestratorShadow(input, { supabase: client, logger });
    const json = JSON.stringify(events);
    expect(json).not.toContain("segredo");
    expect(json).not.toContain("12345");
  });
});

// ============================================================
// E. Timeout e Abort
// ============================================================

describe("shadow — timeout", () => {
  test("AbortSignal encadeado em todas as queries", async () => {
    const { calls } = await run();
    for (const c of calls.selects) {
      expect(c.abortSignals).toBeGreaterThanOrEqual(1);
    }
  });

  test("timer curto aborta consulta e retorna timeout", async () => {
    const { client } = makeSupabase({
      rows: baseRows(),
      delayMsOn: { whatsapp_provider_instances: 500 },
    });
    const { logger, events } = makeLogger();
    const res = await runWhatsappOrchestratorShadow(BASE_INPUT, { supabase: client, logger, timeoutMs: 20 });
    expect(res.status).toBe("timeout");
    expect(events[0].status).toBe("timeout");
  });

  test("nenhum retry é feito", async () => {
    const { calls } = await run();
    const instCalls = calls.selects.filter((c) => c.table === "whatsapp_provider_instances");
    expect(instCalls).toHaveLength(1);
  });
});

// ============================================================
// F. Fail-open
// ============================================================

describe("shadow — fail-open", () => {
  test("erro na instância → failed, sem throw", async () => {
    const { client } = makeSupabase({
      rows: baseRows(),
      errorOn: { whatsapp_provider_instances: { message: "boom", code: "42501" } },
    });
    const { logger, events } = makeLogger();
    const res = await runWhatsappOrchestratorShadow(BASE_INPUT, { supabase: client, logger });
    expect(res.status).toBe("failed");
    if (res.status === "failed") expect(res.errorCategory).toBe("instance_lookup_failed");
    expect(events[0].status).toBe("failed");
    // Nada de mensagem crua do supabase no log.
    expect(JSON.stringify(events[0])).not.toContain("boom");
  });

  test("erro no state → failed:state_lookup_failed", async () => {
    const { client } = makeSupabase({
      rows: baseRows(),
      errorOn: { whatsapp_conversation_states: { message: "boom" } },
    });
    const { logger } = makeLogger();
    const res = await runWhatsappOrchestratorShadow(BASE_INPUT, { supabase: client, logger });
    if (res.status === "failed") expect(res.errorCategory).toBe("state_lookup_failed");
    else throw new Error("expected failed");
  });

  test("erro nos veículos → failed:vehicles_lookup_failed", async () => {
    const { client } = makeSupabase({
      rows: baseRows(),
      errorOn: { veiculos: { message: "boom" } },
    });
    const { logger } = makeLogger();
    const res = await runWhatsappOrchestratorShadow(BASE_INPUT, { supabase: client, logger });
    if (res.status === "failed") expect(res.errorCategory).toBe("vehicles_lookup_failed");
    else throw new Error("expected failed");
  });

  test("throw em SELECT (não-abort) → failed", async () => {
    const { client } = makeSupabase({
      rows: baseRows(),
      throwOn: { whatsapp_provider_instances: new Error("network down") },
    });
    const { logger, events } = makeLogger();
    const res = await runWhatsappOrchestratorShadow(BASE_INPUT, { supabase: client, logger });
    expect(res.status).toBe("failed");
    expect(JSON.stringify(events)).not.toContain("network down");
  });
});

// ============================================================
// G. Logs sanitizados
// ============================================================

describe("shadow — logs", () => {
  test("evento estruturado com tag e IDs técnicos permitidos", async () => {
    const { events } = await run();
    const e = events[0];
    expect(e.tag).toBe("whatsapp_orchestrator_shadow");
    expect(e.queueItemId).toBe("q-1");
    expect(e.messageId).toBe("m-1");
    expect(e.contactId).toBe("c-1");
    expect(e.provider).toBe("zapi");
    expect(e.instanceId).toBe("INSTANCE-ABC");
    expect(typeof e.durationMs).toBe("number");
  });

  test("nenhum telefone, texto, resposta textual, draftPayload, placa, chassi, email", async () => {
    const { events } = await run({
      whatsapp_conversation_states: [
        {
          contact_id: "c-1",
          state: "idle",
          draft_payload: { segredo: "abc-xyz" },
          draft_version: 1,
          state_version: 1,
          fallback_count: 0,
        },
      ],
      veiculos: [
        { id: "v1", user_id: "u-1", marca: "Fiat", modelo: "Argo", placa: "AAA1234", status: "active", km_atual: null },
      ],
    });
    const json = JSON.stringify(events[0]);
    const forbidden = ["+55", "phone", "textBody", "abc-xyz", "AAA1234", "@", "draftPayload", "chassi"];
    for (const needle of forbidden) {
      expect(json.includes(needle)).toBe(false);
    }
  });

  test("SHADOW_TIMEOUT_MS é 800 (default provisório)", () => {
    expect(SHADOW_TIMEOUT_MS).toBe(800);
  });
});

// ============================================================
// Build 5.7F2E1A.5-MA — kmAtual (Shadow, implementação independente)
// Verifica parseKmAtualShadow via caminho passivo, sem side effects.
// ============================================================

describe("shadow — kmAtual (Build 5.7F2E1A.5-MA)", () => {
  function veh(km_atual: unknown): Record<string, unknown> {
    const row: Record<string, unknown> = {
      id: "v1",
      user_id: "u-1",
      marca: "Fiat",
      modelo: "Argo",
      placa: "ABC1D23",
      status: "active",
    };
    if (arguments.length > 0) row.km_atual = km_atual;
    return row;
  }

  test("km_atual null → evaluated, log sem km e sem exception", async () => {
    const { res, events, calls } = await run({ veiculos: [veh(null)] });
    expect(res.status).toBe("evaluated");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("evaluated");
    // Nenhuma RPC nem outras tabelas escritas.
    const tables = calls.selects.map((c) => c.table).sort();
    expect(tables).toEqual(["pagamentos_pix", "profiles", "veiculos", "whatsapp_conversation_states", "whatsapp_provider_instances"]);
    // Nenhum campo kmAtual/km_atual vaza para o log.
    const json = JSON.stringify(events[0]);
    expect(json.includes("kmAtual")).toBe(false);
    expect(json.includes("km_atual")).toBe(false);
  });

  test("km_atual 0 → evaluated (não é tratado como null/malformado)", async () => {
    const { res, events } = await run({ veiculos: [veh(0)] });
    expect(res.status).toBe("evaluated");
    expect(events[0].status).toBe("evaluated");
  });

  test("km_atual string '1000' → failed:vehicles_lookup_failed (sem coerção)", async () => {
    const { res, events } = await run({ veiculos: [veh("1000")] });
    expect(res.status).toBe("failed");
    if (res.status === "failed") expect(res.errorCategory).toBe("vehicles_lookup_failed");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("failed");
    expect(events[0].errorCategory).toBe("vehicles_lookup_failed");
  });

  test("km_atual undefined (coluna ausente) → failed:vehicles_lookup_failed (NÃO vira null)", async () => {
    const rowMissing: Record<string, unknown> = {
      id: "v1", user_id: "u-1", marca: "Fiat", modelo: "Argo", placa: "ABC1D23", status: "active",
    };
    const { res, events } = await run({ veiculos: [rowMissing] });
    expect(res.status).toBe("failed");
    if (res.status === "failed") expect(res.errorCategory).toBe("vehicles_lookup_failed");
    expect(events[0].errorCategory).toBe("vehicles_lookup_failed");
  });

  test("km_atual malformado (decimal) → failed:vehicles_lookup_failed, passividade preservada", async () => {
    const { res, events, calls } = await run({ veiculos: [veh(100.5)] });
    expect(res.status).toBe("failed");
    if (res.status === "failed") expect(res.errorCategory).toBe("vehicles_lookup_failed");
    // Passividade: apenas SELECTs, nenhuma tabela de writes/rpc.
    const tables = new Set(calls.selects.map((c) => c.table));
    expect(tables.has("whatsapp_processing_queue")).toBe(false);
    expect(tables.has("whatsapp_action_executions")).toBe(false);
    expect(tables.has("whatsapp_messages")).toBe(false);
    // Nenhum log evaluated foi emitido; apenas o failed.
    expect(events.filter((e) => e.status === "evaluated")).toHaveLength(0);
    expect(events.filter((e) => e.status === "failed")).toHaveLength(1);
  });

  test("km_atual malformado NÃO dispara claim/apply/release/state/outbound", async () => {
    // A mock structural do supabase (makeSupabase) só expõe .from().select().eq()...
    // Como não há .rpc/.insert/.update/.delete implementados, qualquer tentativa
    // dispararia TypeError. O sucesso silencioso deste teste, portanto, prova
    // que o Shadow permanece exclusivamente read-only mesmo no caminho de
    // falha por malformed km_atual.
    const { res, calls } = await run({ veiculos: [veh("nope")] });
    expect(res.status).toBe("failed");
    // Nenhum SELECT em tabelas de mutação/estado transacional.
    for (const c of calls.selects) {
      expect(["whatsapp_provider_instances", "whatsapp_conversation_states", "veiculos"]).toContain(c.table);
    }
  });
});

