// WIRE-5 — Consumidor de produção do orquestrador determinístico (C8/Fase
// 18). Espelha a estrutura HTTP de whatsapp-process-inbound/index.ts (POST
// autenticado, batch via query param, CORS, resposta sanitizada) mas NÃO
// reimplementa NENHUMA lógica de negócio própria — delega tudo pra
// runWhatsappOrchestratorTestCycle (orchestrator/test-service.ts), que já
// é exercitado por 169+15 testes (WIRE-4). Este arquivo só compõe as
// dependências reais (client Supabase de verdade, repository, deps de
// ação, transcrição de áudio, handoff pro Dr. Jarvys) e expõe isso via
// HTTP.
//
// Import dinâmico do supabase-js (não estático no topo do arquivo): mesmo
// padrão documentado em actions/deps.ts e voice-transcription/
// parse-voice-message.ts — evita que o test runner (bun) quebre ao
// importar este módulo. Confirmado empiricamente nesta build: um import
// estático `from "https://esm.sh/..."` no topo do arquivo falha ao ser
// resolvido pelo bun neste sandbox (SyntaxError de export ausente).
//
// Segredo PRÓPRIO e distinto dos outros workers (WHATSAPP_ORCHESTRATOR_SECRET
// / x-orchestrator-secret) — não reaproveita WHATSAPP_WORKER_SECRET
// (whatsapp-process-inbound) nem WHATSAPP_SENDER_SECRET
// (whatsapp-send-outbound); confirmado por investigação prévia que cada
// function deste repo usa um segredo dedicado, nunca compartilhado.
//
// Disparo HTTP autenticado (POST) — o mecanismo operacional de QUEM chama
// este endpoint (cron externo, painel, etc.) é uma decisão fora do
// escopo deste arquivo; nenhuma evidência de pg_cron/cron.schedule
// disparando os workers legados foi encontrada no repo (investigação
// prévia), então este worker fica no mesmo estado operacional que eles
// já estão hoje.

import { WhatsappOrchestratorRepository, type SupabaseLike } from "../_shared/whatsapp/orchestrator/repository.ts";
import {
  runWhatsappOrchestratorTestCycle,
  type ConversationHandoffFallbackParams,
  type ConversationHandoffFallbackResult,
  type TestCycleDeps,
} from "../_shared/whatsapp/orchestrator/test-service.ts";
import { createTranscribeAudioMessage } from "../_shared/whatsapp/orchestrator/audio-transcription-deps.ts";
import { createConfirmedKmUpdateDepsFromEnv } from "../_shared/whatsapp/actions/deps.ts";
import { createConfirmedExpenseCreateDepsFromEnv } from "../_shared/whatsapp/actions/expense-deps.ts";
import { executeConversationHandoffEntrypoint } from "../_shared/whatsapp/conversation-handoff/entrypoint.ts";
import { CONVERSATION_HANDOFF_CONTRACT_VERSION } from "../_shared/whatsapp/conversation-handoff/contract.ts";
import type { ConversationHandoffExecutionCommandV1 } from "../_shared/whatsapp/conversation-handoff/execution-contract.ts";

const ORCHESTRATOR_VERSION = "whatsapp-process-orchestrator.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-orchestrator-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Mesma implementação (char a char, tempo constante) de
// whatsapp-process-inbound/index.ts::safeEqual — pequena e auto-contida,
// copiada em vez de extraída pra um helper compartilhado novo (não pedido).
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Leitura de Deno.env via globalThis — mesmo padrão de actions/deps.ts,
// actions/expense-deps.ts e voice-transcription/parse-voice-message.ts —
// evita ReferenceError ao importar este módulo fora do Deno (bun test).
type DenoEnvLike = { get(name: string): string | undefined };
type DenoGlobalLike = { env?: DenoEnvLike; serve?: (handler: (req: Request) => Promise<Response>) => unknown };

function readDenoGlobal(): DenoGlobalLike | undefined {
  return (globalThis as unknown as { Deno?: DenoGlobalLike }).Deno;
}

function readDenoEnv(name: string): string | undefined {
  return readDenoGlobal()?.env?.get(name);
}

// ------------------------------------------------------------
// conversationHandoffFallback — wrapper trivial: monta o command a partir
// dos params (só o segmento primary — a fallback do test-service.ts nunca
// tem um segundo segmento pra oferecer) e chama o entrypoint real.
// executeConversationHandoffEntrypoint SEMPRE enfileira a resposta sozinho
// (deliverable) em qualquer outcome — handled é sempre true. Os 7 valores
// de outcome batem 1:1 entre ConversationHandoffEntrypointOutcome e
// ConversationHandoffFallbackOutcome, sem tradução.
// ------------------------------------------------------------

export function buildConversationHandoffCommand(
  params: ConversationHandoffFallbackParams,
): ConversationHandoffExecutionCommandV1 {
  return {
    primary: {
      version: CONVERSATION_HANDOFF_CONTRACT_VERSION,
      kind: "conversation",
      segment: "primary",
      contactId: params.contactId,
      userId: params.userId,
      vehicleId: params.vehicleId,
      sourceMessageId: params.sourceMessageId,
      originalText: params.originalText,
    },
  };
}

export function createConversationHandoffFallback(
  client: SupabaseLike,
): (params: ConversationHandoffFallbackParams) => Promise<ConversationHandoffFallbackResult> {
  return async (params) => {
    const command = buildConversationHandoffCommand(params);
    const { outcome } = await executeConversationHandoffEntrypoint(client, command);
    return { handled: true, outcome };
  };
}

// ------------------------------------------------------------
// loadMessageText — consulta simples a whatsapp_messages.text_body pelo
// messageId, mesma tabela/coluna que o worker legado já lê. Falha
// estrutural da busca (client sem .from, res.error) lança — cai no
// try/catch que runMessageText já tem, mapeando pra
// transient_error/releasedForRetry (é um problema de infraestrutura,
// vale tentar de novo). Linha ausente ou text_body não-string: devolve
// null — mapeia pro caminho já existente cancelled/contextRejected (não
// há texto processável, e reexecutar não muda isso).
// ------------------------------------------------------------

export function createLoadMessageText(
  client: SupabaseLike,
): (messageId: string) => Promise<string | null> {
  return async (messageId: string): Promise<string | null> => {
    if (!client.from) {
      throw new Error("client_missing_from");
    }
    const res = await client.from("whatsapp_messages").select("text_body").eq("id", messageId).maybeSingle();
    if (res.error) {
      throw new Error("message_lookup_failed");
    }
    const row = res.data;
    if (!row) return null;
    const textBody = row.text_body;
    return typeof textBody === "string" ? textBody : null;
  };
}

// ------------------------------------------------------------
// Handler HTTP
// ------------------------------------------------------------

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = readDenoEnv("SUPABASE_URL");
  const serviceRoleKey = readDenoEnv("SUPABASE_SERVICE_ROLE_KEY");
  const orchestratorSecret = readDenoEnv("WHATSAPP_ORCHESTRATOR_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(JSON.stringify({ tag: "whatsapp-process-orchestrator", error: "server_not_configured" }));
    return json({ error: "server_not_configured" }, 500);
  }
  if (!orchestratorSecret) {
    console.error(JSON.stringify({ tag: "whatsapp-process-orchestrator", error: "worker_not_configured" }));
    return json({ error: "worker_not_configured" }, 500);
  }

  const receivedSecret = req.headers.get("x-orchestrator-secret") ?? "";
  if (!receivedSecret || !safeEqual(receivedSecret, orchestratorSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const workerId = url.searchParams.get("worker_id") || "whatsapp-process-orchestrator";
  const rawBatch = url.searchParams.get("batch");
  const rawLeaseSeconds = url.searchParams.get("lease_seconds");
  const batch = rawBatch ? Number(rawBatch) : undefined;
  const leaseSeconds = rawLeaseSeconds ? Number(rawLeaseSeconds) : undefined;

  try {
    const mod = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
    const client = mod.createClient(supabaseUrl, serviceRoleKey) as SupabaseLike;

    const [kmActionDeps, expenseActionDeps] = await Promise.all([
      createConfirmedKmUpdateDepsFromEnv(),
      createConfirmedExpenseCreateDepsFromEnv(),
    ]);

    const deps: TestCycleDeps = {
      repository: new WhatsappOrchestratorRepository(client),
      loadMessageText: createLoadMessageText(client),
      clock: () => new Date().toISOString(),
      orchestratorVersion: ORCHESTRATOR_VERSION,
      kmActionDeps,
      expenseActionDeps,
      transcribeAudioMessage: createTranscribeAudioMessage(client),
      conversationHandoffFallback: createConversationHandoffFallback(client),
    };

    const result = await runWhatsappOrchestratorTestCycle(
      {
        workerId,
        ...(batch !== undefined && Number.isFinite(batch) ? { batch } : {}),
        ...(leaseSeconds !== undefined && Number.isFinite(leaseSeconds) ? { leaseSeconds } : {}),
      },
      deps,
    );

    // TestCycleResult já é sanitizado por design (workerId, status,
    // contagens, duração) — nunca contém texto de mensagem, base64 ou
    // segredo. Seguro devolver direto no corpo da resposta.
    return json(result, 200);
  } catch {
    // Nunca vaza detalhe de exceção bruta na resposta HTTP (pode conter
    // texto de mensagem, segredo, ou qualquer coisa capturada em algum
    // ponto do pipeline) — só uma categoria genérica, mesmo espírito de
    // download-media.ts/audio-transcription-deps.ts.
    console.error(JSON.stringify({ tag: "whatsapp-process-orchestrator", error: "unexpected_error" }));
    return json({ error: "internal_error" }, 500);
  }
}

// Só inicia o servidor de verdade sob Deno — importar este módulo fora
// dele (bun test) nunca dispara o listener.
const denoGlobal = readDenoGlobal();
if (typeof denoGlobal?.serve === "function") {
  denoGlobal.serve(handleRequest);
}
