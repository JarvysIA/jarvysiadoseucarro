// Testes de whatsapp-process-orchestrator/index.ts (WIRE-5). Runner: bun test.
//
// Precedente de teste pra um index.ts de edge function: NENHUM existe hoje
// em todo o repositório (confirmado por busca exaustiva nos 13 diretórios
// de function fora de _shared/ — nenhum tem qualquer *.test.ts). Este
// arquivo estabelece o primeiro. Por isso index.ts foi desenhado pra ser
// seguramente importável sob bun (import dinâmico do supabase-js em vez
// de estático no topo, Deno.serve() guardado por checagem de
// disponibilidade) — sem isso, o próprio import deste módulo já quebraria
// o test runner, como o comentário em actions/deps.ts já documenta pra
// esse mesmo import.
//
// Não usa mock.module() — mesma razão documentada em entrypoint.test.ts
// (mock.module vaza entre arquivos no mesmo processo bun test). Mocka
// globalThis.Deno (env) com afterEach restaurando, mesmo padrão de
// parse-voice-message.test.ts/dr-jarvys-adapter.test.ts/
// audio-transcription-deps.test.ts.

import { afterEach, describe, expect, test } from "bun:test";
import {
  buildConversationHandoffCommand,
  createConversationHandoffFallback,
  createLoadMessageText,
  handleRequest,
  safeEqual,
} from "../index.ts";
import type {
  RpcInvoker,
  SupabaseFromBuilder,
  SupabaseLike,
  SupabaseMaybeSingleResult,
} from "../../_shared/whatsapp/orchestrator/repository.ts";
import type { ConversationHandoffFallbackParams } from "../../_shared/whatsapp/orchestrator/test-service.ts";

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
const ORCHESTRATOR_SECRET = "correct-orchestrator-secret";

function fullConfigEnv(): Record<string, string> {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    WHATSAPP_ORCHESTRATOR_SECRET: ORCHESTRATOR_SECRET,
  };
}

function makeRequest(
  method: string,
  opts: { headers?: Record<string, string>; search?: string } = {},
): Request {
  const url = `https://example.invalid/whatsapp-process-orchestrator${opts.search ?? ""}`;
  return new Request(url, { method, headers: opts.headers ?? {} });
}

// ============================================================
// safeEqual
// ============================================================

describe("safeEqual", () => {
  test("strings iguais => true", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });
  test("strings diferentes mesmo tamanho => false", () => {
    expect(safeEqual("abc123", "xyz789")).toBe(false);
  });
  test("tamanhos diferentes => false", () => {
    expect(safeEqual("abc", "abcdef")).toBe(false);
  });
  test("strings vazias => true (mesmo comprimento zero)", () => {
    expect(safeEqual("", "")).toBe(true);
  });
});

// ============================================================
// buildConversationHandoffCommand (função pura)
// ============================================================

// Mesmo helper de fixture de UUID usado em conversation-handoff/__tests__/entrypoint.test.ts.
function uuid(fill: string): string {
  return `${fill.repeat(8)}-${fill.repeat(4)}-4${fill.repeat(3)}-8${fill.repeat(3)}-${fill.repeat(12)}`;
}

describe("buildConversationHandoffCommand", () => {
  test("monta o command primary exatamente a partir dos params", () => {
    const params: ConversationHandoffFallbackParams = {
      sourceMessageId: uuid("1"),
      contactId: uuid("2"),
      userId: uuid("3"),
      vehicleId: uuid("4"),
      originalText: "quanto custa a revisão?",
    };

    const command = buildConversationHandoffCommand(params);

    expect(command).toEqual({
      primary: {
        version: "conversation.v1",
        kind: "conversation",
        segment: "primary",
        contactId: uuid("2"),
        userId: uuid("3"),
        vehicleId: uuid("4"),
        sourceMessageId: uuid("1"),
        originalText: "quanto custa a revisão?",
      },
    });
    expect("supplemental" in command).toBe(false);
  });

  test("vehicleId null é preservado (não vira undefined)", () => {
    const params: ConversationHandoffFallbackParams = {
      sourceMessageId: uuid("5"),
      contactId: uuid("6"),
      userId: uuid("7"),
      vehicleId: null,
      originalText: "oi",
    };

    const command = buildConversationHandoffCommand(params);

    expect(command.primary.vehicleId).toBeNull();
  });
});

// ============================================================
// createConversationHandoffFallback — ponta a ponta com client mockado
// (mesma técnica já usada em entrypoint.test.ts: SupabaseLike mockado,
// nunca mock.module, nunca rede real).
// ============================================================

function makeAuthDeniedClient(): SupabaseLike {
  // Qualquer select (profiles/veiculos/pagamentos_pix) falha de forma
  // estruturada => resolveConversationHandoffAuthorization trata como
  // não-autorizado (fail-closed) => outcome determinístico
  // "blocked_authorization_required", sem precisar montar veículo/perfil
  // válidos nem tocar no ledger/IA.
  return {
    rpc: (async (fn: string) => {
      if (fn === "enqueue_conversation_handoff_outbound") {
        return {
          data: { result: "created", outbound_message_id: "om-1", outbound_queue_id: "oq-1" },
          error: null,
        };
      }
      return { data: null, error: { message: "unexpected rpc in this test", code: null } };
    }) as RpcInvoker,
    from: (_table: string): SupabaseFromBuilder => ({
      select: (_cols: string) => {
        const builder = {
          eq(_c: string, _v: unknown) {
            return builder;
          },
          async maybeSingle(): Promise<SupabaseMaybeSingleResult> {
            return { data: null, error: { message: "boom", code: null } };
          },
        };
        return builder as unknown as ReturnType<SupabaseFromBuilder["select"]>;
      },
    }),
  };
}

describe("createConversationHandoffFallback", () => {
  test("outcome é repassado sem tradução, handled sempre true", async () => {
    const client = makeAuthDeniedClient();
    const fallback = createConversationHandoffFallback(client);

    const result = await fallback({
      sourceMessageId: uuid("8"),
      contactId: uuid("9"),
      userId: uuid("a"),
      vehicleId: null,
      originalText: "quanto custa a revisão?",
    });

    expect(result).toEqual({ handled: true, outcome: "blocked_authorization_required" });
  });
});

// ============================================================
// createLoadMessageText
// ============================================================

function makeMessagesClient(
  row: { text_body?: unknown } | null,
  opts: { queryError?: boolean } = {},
): SupabaseLike {
  return {
    rpc: (async () => ({ data: null, error: null })) as RpcInvoker,
    from: (_table: string): SupabaseFromBuilder => ({
      select: (_cols: string) => {
        const builder = {
          eq(_c: string, _v: unknown) {
            return builder;
          },
          async maybeSingle(): Promise<SupabaseMaybeSingleResult> {
            if (opts.queryError) return { data: null, error: { message: "boom", code: null } };
            return { data: row as Record<string, unknown> | null, error: null };
          },
        };
        return builder as unknown as ReturnType<SupabaseFromBuilder["select"]>;
      },
    }),
  };
}

describe("createLoadMessageText", () => {
  test("linha com text_body string => devolve o texto", async () => {
    const client = makeMessagesClient({ text_body: "gastei 100 reais" });
    const load = createLoadMessageText(client);
    expect(await load("m-1")).toBe("gastei 100 reais");
  });

  test("linha não encontrada => null", async () => {
    const client = makeMessagesClient(null);
    const load = createLoadMessageText(client);
    expect(await load("m-1")).toBeNull();
  });

  test("text_body não-string (null no banco) => null", async () => {
    const client = makeMessagesClient({ text_body: null });
    const load = createLoadMessageText(client);
    expect(await load("m-1")).toBeNull();
  });

  test("busca falha (res.error) => lança (mapeia pro transient_error existente)", async () => {
    const client = makeMessagesClient(null, { queryError: true });
    const load = createLoadMessageText(client);
    await expect(load("m-1")).rejects.toThrow();
  });

  test("client sem .from => lança", async () => {
    const client: SupabaseLike = { rpc: (async () => ({ data: null, error: null })) as RpcInvoker };
    const load = createLoadMessageText(client);
    await expect(load("m-1")).rejects.toThrow();
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

  test("PUT => 405", async () => {
    const res = await handleRequest(makeRequest("PUT"));
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

  test("SUPABASE_URL/SERVICE_ROLE_KEY presentes, ORCHESTRATOR_SECRET ausente => 500 worker_not_configured", async () => {
    setDenoEnv({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY });
    const res = await handleRequest(makeRequest("POST"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "worker_not_configured" });
  });
});

describe("handleRequest — autenticação", () => {
  test("sem header x-orchestrator-secret => 401", async () => {
    setDenoEnv(fullConfigEnv());
    const res = await handleRequest(makeRequest("POST"));
    expect(res.status).toBe(401);
  });

  test("header com valor errado => 401", async () => {
    setDenoEnv(fullConfigEnv());
    const res = await handleRequest(
      makeRequest("POST", { headers: { "x-orchestrator-secret": "valor-errado" } }),
    );
    expect(res.status).toBe(401);
  });

  test("header correto => passa da checagem de autenticação (nunca 401)", async () => {
    setDenoEnv(fullConfigEnv());
    const res = await handleRequest(
      makeRequest("POST", { headers: { "x-orchestrator-secret": ORCHESTRATOR_SECRET } }),
    );
    // Neste sandbox o import dinâmico do supabase-js (https://esm.sh/...)
    // é bloqueado pelo proxy de rede (mesmo bloqueio confirmado pro smoke
    // test estrutural abaixo) — a requisição cai no catch geral e vira
    // 500 internal_error. O que este teste prova é que a autenticação foi
    // superada (nunca 401/403) antes de esbarrar nesse limite ambiental;
    // não afirma que o ciclo do orquestrador completou de verdade — isso
    // só é validável num ambiente com acesso de rede real (CI/Deno).
    expect(res.status).not.toBe(401);
    expect([200, 500]).toContain(res.status);
  });
});

// ============================================================
// Smoke estrutural: createClient() REAL do @supabase/supabase-js
// (WIRE-1 apontou que isso nunca foi exercitado em teste algum do repo —
// só asserção de tipo, nunca verificado em runtime). Confirma que o
// client real tem .rpc/.from como funções e que .from().select() devolve
// algo com .eq/.maybeSingle encadeáveis, ANTES de qualquer teste ao vivo
// em produção — sem completar nenhuma chamada de rede de verdade (nunca
// aguarda .maybeSingle()/.rpc(), só inspeciona a forma dos objetos
// retornados sincronamente pelo builder).
//
// Este sandbox bloqueia o import dinâmico de https://esm.sh/... no nível
// do proxy de rede (confirmado: 403 "request blocked: no rule or
// allowlist entry allows host 'esm.sh'" — mesmo tipo de restrição já
// documentado repetidas vezes nesta sessão pro registry privado). Em vez
// de fabricar um "passou" ou deixar o teste travar/falhar de forma
// enganosa, ele se autodetecta e usa test.skipIf: roda de verdade num
// ambiente com rede (CI/Deno real), e aparece explicitamente como SKIP
// aqui — nunca como PASS silencioso nem como FAIL de código.
// ============================================================

const SUPABASE_JS_URL = "https://esm.sh/@supabase/supabase-js@2.45.4";

async function isEsmShReachable(): Promise<boolean> {
  try {
    const res = await fetch(SUPABASE_JS_URL, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

const esmShReachable = await isEsmShReachable();

describe("smoke estrutural — createClient() real vs. SupabaseLike", () => {
  test.skipIf(!esmShReachable)(
    "client real tem .rpc/.from como funções, .from().select() encadeia .eq/.maybeSingle",
    async () => {
      const mod = await import(SUPABASE_JS_URL);
      const client = mod.createClient("https://fake-project.supabase.co", "fake-anon-key");

      expect(typeof client.rpc).toBe("function");
      expect(typeof client.from).toBe("function");

      const builder = client.from("whatsapp_messages").select("text_body");
      expect(typeof builder.eq).toBe("function");
      expect(typeof builder.maybeSingle).toBe("function");
    },
  );

  test("resultado da pré-checagem de rede é reportado explicitamente (não silencioso)", () => {
    // Não é uma asserção sobre o código — é só um marcador visível no
    // output do bun test dizendo se o smoke test acima rodou de verdade
    // ou foi pulado por falta de rede neste sandbox especificamente.
    console.log(
      `[smoke-check] esm.sh ${esmShReachable ? "alcançável — smoke test real executado" : "bloqueado neste sandbox — smoke test acima foi SKIP, precisa rodar em CI/Deno real"}`,
    );
    expect(typeof esmShReachable).toBe("boolean");
  });
});
