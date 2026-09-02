// Build Reengagement-Inactivity — Reengajamento proativo (2 coortes:
// inativos + nunca ativados). Espelha a estrutura HTTP de
// whatsapp-maintenance-alerts/index.ts (POST autenticado, CORS, safeEqual,
// checks de config, import dinâmico do supabase-js, client estrutural
// injetado, lógica extraída pra runReengagementBatch testável, logger
// estruturado próprio) — mesmo padrão, PR #83, já mesclado. Segredo
// PRÓPRIO e distinto (WHATSAPP_REENGAGEMENT_SECRET /
// x-reengagement-secret).
//
// Import dinâmico do supabase-js (não estático no topo): mesmo motivo já
// documentado em whatsapp-process-orchestrator/index.ts e
// whatsapp-maintenance-alerts/index.ts.
//
// Sem tabela de controle nova: usa o próprio histórico de
// whatsapp_outbound_queue (purpose='commercial') como "última vez que
// mandei pra esse contato" — o cooldown de 8 dias vale igual pras duas
// coortes, independente de qual coorte originou o envio anterior.
//
// Não depende do motor de manutenção nem de afiliados — vehicle_id é
// sempre null aqui. Não cria o cron job (instância Z-API ainda não
// conectada).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-reengagement-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Mesma implementação (char a char, tempo constante) já usada em
// whatsapp-process-orchestrator/index.ts e whatsapp-maintenance-alerts/
// index.ts::safeEqual — pequena e auto-contida, copiada em vez de
// extraída pra um helper compartilhado novo (mesma decisão de lá).
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

type DenoEnvLike = { get(name: string): string | undefined };
type DenoGlobalLike = { env?: DenoEnvLike; serve?: (handler: (req: Request) => Promise<Response>) => unknown };

function readDenoGlobal(): DenoGlobalLike | undefined {
  return (globalThis as unknown as { Deno?: DenoGlobalLike }).Deno;
}

function readDenoEnv(name: string): string | undefined {
  return readDenoGlobal()?.env?.get(name);
}

const DEFAULT_BATCH_LIMIT = 200;
const INACTIVITY_WINDOW_MS = 8 * 24 * 60 * 60 * 1000; // 8 dias, vale pras duas coortes.

// Textos exatos, decididos nesta build — nenhuma variação/interpolação.
export const REENGAGEMENT_TEXT_COHORT_A =
  "Oi! 👋 Faz um tempinho que você não aparece por aqui. Quer atualizar a km do seu carro, tirar uma dúvida técnica, ou só dar um oi? Tô sempre por aqui, pronto pra ajudar! 🚗";

export const REENGAGEMENT_TEXT_COHORT_B =
  "Oi! 👋 Vi que você já conectou seu WhatsApp aqui, mas ainda não trocamos uma ideia! É só me mandar um 'oi', contar sobre a última manutenção que você fez, ou perguntar qualquer coisa sobre seu carro — tô aqui pra ajudar! 🚗";

// ------------------------------------------------------------
// Client estrutural mínimo — só o subconjunto de supabase-js que este
// handler usa. Mesmo espírito de MaintenanceAlertsClient
// (whatsapp-maintenance-alerts/index.ts) — permite mockar num teste sem
// tocar no client real nem em mock.module().
// ------------------------------------------------------------

export type ReengagementContactRow = {
  id: string;
  user_id: string;
  last_inbound_at: string | null;
  verified_at: string | null;
  assigned_provider: string | null;
  assigned_instance_id: string | null;
};

export type ReengagementProviderInstanceRow = {
  provider: string;
  instance_id: string;
  status: string;
};

export type ReengagementHistoryRow = {
  created_at: string;
};

type ListResult<T> = { data: T[] | null; error: { message: string } | null };
type MutationResult = { error: { message: string } | null };

// Prefixo comum das duas queries de coorte (verified_at NOT NULL, sem
// opt-out, contato primário) — só diverge no filtro de last_inbound_at
// (NOT NULL + <= cutoff pra coorte A; IS NULL + verified_at <= cutoff pra
// coorte B). Modelado como uma única chain com os dois ramos possíveis no
// último passo, igual ao supabase-js real (builder encadeável, thenable a
// qualquer ponto).
type ContactsFilterStep4 = {
  not(column: "last_inbound_at", operator: "is", value: null): {
    lte(column: "last_inbound_at", value: string): Promise<ListResult<ReengagementContactRow>>;
  };
  is(column: "last_inbound_at", value: null): {
    lte(column: "verified_at", value: string): Promise<ListResult<ReengagementContactRow>>;
  };
};
type ContactsFilterStep3 = {
  eq(column: "is_primary", value: true): ContactsFilterStep4;
};
type ContactsFilterStep2 = {
  eq(column: "opt_out", value: false): ContactsFilterStep3;
};
type ContactsFilterStep1 = {
  not(column: "verified_at", operator: "is", value: null): ContactsFilterStep2;
};

type ProviderInstancesChain = {
  eq(column: "status", value: "active"): Promise<ListResult<ReengagementProviderInstanceRow>>;
};

type OutboundHistoryChain = {
  eq(column: "contact_id", value: string): {
    eq(column: "purpose", value: "commercial"): {
      order(column: "created_at", opts: { ascending: false }): {
        limit(n: 1): Promise<ListResult<ReengagementHistoryRow>>;
      };
    };
  };
};

export type ReengagementClient = {
  from(table: "whatsapp_contacts"): { select(columns: string): ContactsFilterStep1 };
  from(table: "whatsapp_provider_instances"): { select(columns: string): ProviderInstancesChain };
  from(table: "whatsapp_outbound_queue"): {
    select(columns: string): OutboundHistoryChain;
    insert(row: Record<string, unknown>): Promise<MutationResult>;
  };
};

// ------------------------------------------------------------
// Logger estruturado — mesmo padrão de createProductionLogger em
// whatsapp-maintenance-alerts/index.ts. Evento próprio deste domínio.
// ------------------------------------------------------------

export type ReengagementLogEvent =
  | { event: "batch_started"; limit: number }
  | { event: "batch_completed"; evaluated: number; sent: number }
  | { event: "reengagement_sent"; contactId: string; cohort: "a" | "b" }
  | { event: "candidate_error"; contactId: string };

const FAILURE_EVENTS = new Set(["candidate_error"]);

export function createProductionLogger(): (event: ReengagementLogEvent) => void {
  return (event) => {
    const line = JSON.stringify({ tag: "whatsapp-reengagement", ...event });
    if (FAILURE_EVENTS.has(event.event)) {
      console.error(line);
    } else {
      console.log(line);
    }
  };
}

// ------------------------------------------------------------
// runReengagementBatch — lógica completa, extraída do handler HTTP pra
// ficar testável com um client mockado, sem precisar do runtime Deno real
// nem de rede.
// ------------------------------------------------------------

export type ReengagementSkipReason = "no_instance" | "recently_engaged" | "duplicate_queued" | "error";

export type ReengagementBatchResult = {
  candidatesEvaluated: number;
  sent: number;
  sentByCohort: { a: number; b: number };
  skipped: Record<ReengagementSkipReason, number>;
};

function emptySkipCounts(): Record<ReengagementSkipReason, number> {
  return { no_instance: 0, recently_engaged: 0, duplicate_queued: 0, error: 0 };
}

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function runReengagementBatch(
  client: ReengagementClient,
  opts: { limit: number; logger: (event: ReengagementLogEvent) => void },
): Promise<ReengagementBatchResult> {
  const { limit, logger } = opts;
  logger({ event: "batch_started", limit });

  const skipped = emptySkipCounts();
  let sentA = 0;
  let sentB = 0;

  const cutoffMs = Date.now() - INACTIVITY_WINDOW_MS;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const contactCols = "id, user_id, last_inbound_at, verified_at, assigned_provider, assigned_instance_id";

  // 1) Coorte A — já usou, sumiu (last_inbound_at NOT NULL e antigo).
  const cohortARes = await client
    .from("whatsapp_contacts")
    .select(contactCols)
    .not("verified_at", "is", null)
    .eq("opt_out", false)
    .eq("is_primary", true)
    .not("last_inbound_at", "is", null)
    .lte("last_inbound_at", cutoffIso);

  // 2) Coorte B — verificou mas nunca mandou nada (last_inbound_at NULL,
  // conta a partir de verified_at).
  const cohortBRes = await client
    .from("whatsapp_contacts")
    .select(contactCols)
    .not("verified_at", "is", null)
    .eq("opt_out", false)
    .eq("is_primary", true)
    .is("last_inbound_at", null)
    .lte("verified_at", cutoffIso);

  // 3) União — mutuamente exclusivas por construção (last_inbound_at é
  // NULL xor não-NULL, nunca as duas condições batem pro mesmo contato).
  // Aplica o limite de batch por coorte antes do join (mesma decisão de
  // whatsapp-maintenance-alerts: limita a consulta, não a lista já unida).
  const candidates: Array<{ contact: ReengagementContactRow; cohort: "a" | "b" }> = [
    ...(cohortARes.data ?? []).slice(0, limit).map((contact) => ({ contact, cohort: "a" as const })),
    ...(cohortBRes.data ?? []).slice(0, limit).map((contact) => ({ contact, cohort: "b" as const })),
  ];

  // 4) Instâncias de provider ativas — em lote.
  const instancesRes = await client
    .from("whatsapp_provider_instances")
    .select("provider, instance_id, status")
    .eq("status", "active");
  const instancesByKey = new Map<string, ReengagementProviderInstanceRow>();
  for (const inst of instancesRes.data ?? []) {
    instancesByKey.set(`${inst.provider}:${inst.instance_id}`, inst);
  }

  // 5) JOIN com instância ativa — INNER JOIN: sem instância correspondente
  // nunca vira candidato avaliado.
  type JoinedCandidate = {
    contact: ReengagementContactRow;
    cohort: "a" | "b";
    instance: ReengagementProviderInstanceRow;
  };
  const joined: JoinedCandidate[] = [];
  for (const { contact, cohort } of candidates) {
    const key = `${contact.assigned_provider ?? ""}:${contact.assigned_instance_id ?? ""}`;
    const instance = instancesByKey.get(key);
    if (!instance) {
      skipped.no_instance++;
      continue;
    }
    joined.push({ contact, cohort, instance });
  }

  // 6) Avalia cada candidato.
  for (const { contact, cohort, instance } of joined) {
    try {
      const historyRes = await client
        .from("whatsapp_outbound_queue")
        .select("created_at")
        .eq("contact_id", contact.id)
        .eq("purpose", "commercial")
        .order("created_at", { ascending: false })
        .limit(1);
      const lastCommercial = (historyRes.data ?? [])[0] ?? null;
      if (lastCommercial) {
        const lastAt = new Date(lastCommercial.created_at).getTime();
        if (lastAt > cutoffMs) {
          skipped.recently_engaged++;
          continue;
        }
      }

      const text = cohort === "a" ? REENGAGEMENT_TEXT_COHORT_A : REENGAGEMENT_TEXT_COHORT_B;
      const idempotencyKey = `reengagement:${contact.id}:${todayDateKey()}`;

      const insertRes = await client.from("whatsapp_outbound_queue").insert({
        user_id: contact.user_id,
        contact_id: contact.id,
        vehicle_id: null,
        provider: instance.provider,
        instance_id: instance.instance_id,
        message_type: "text",
        text_body: text,
        status: "queued",
        purpose: "commercial",
        idempotency_key: idempotencyKey,
      });
      if (insertRes.error) {
        // Já enfileirado hoje (violação de woq_idempotency_unique) ou
        // outra falha estrutural — nunca trava o lote, só pula este item.
        skipped.duplicate_queued++;
        continue;
      }

      if (cohort === "a") sentA++;
      else sentB++;
      logger({ event: "reengagement_sent", contactId: contact.id, cohort });
    } catch {
      skipped.error++;
      logger({ event: "candidate_error", contactId: contact.id });
    }
  }

  const sent = sentA + sentB;
  const result: ReengagementBatchResult = {
    candidatesEvaluated: joined.length,
    sent,
    sentByCohort: { a: sentA, b: sentB },
    skipped,
  };
  logger({ event: "batch_completed", evaluated: result.candidatesEvaluated, sent: result.sent });
  return result;
}

// ------------------------------------------------------------
// Handler HTTP
// ------------------------------------------------------------

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = readDenoEnv("SUPABASE_URL");
  const serviceRoleKey = readDenoEnv("SUPABASE_SERVICE_ROLE_KEY");
  const reengagementSecret = readDenoEnv("WHATSAPP_REENGAGEMENT_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(JSON.stringify({ tag: "whatsapp-reengagement", error: "server_not_configured" }));
    return json({ error: "server_not_configured" }, 500);
  }
  if (!reengagementSecret) {
    console.error(JSON.stringify({ tag: "whatsapp-reengagement", error: "worker_not_configured" }));
    return json({ error: "worker_not_configured" }, 500);
  }

  const receivedSecret = req.headers.get("x-reengagement-secret") ?? "";
  if (!receivedSecret || !safeEqual(receivedSecret, reengagementSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit ? Number(rawLimit) : DEFAULT_BATCH_LIMIT;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : DEFAULT_BATCH_LIMIT;

  try {
    const mod = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
    const client = mod.createClient(supabaseUrl, serviceRoleKey) as unknown as ReengagementClient;

    const result = await runReengagementBatch(client, {
      limit,
      logger: createProductionLogger(),
    });

    // Só contagens — nunca texto de mensagem, id de contato ou qualquer
    // dado sensível no corpo da resposta.
    return json(result, 200);
  } catch {
    console.error(JSON.stringify({ tag: "whatsapp-reengagement", error: "unexpected_error" }));
    return json({ error: "internal_error" }, 500);
  }
}

// Só inicia o servidor de verdade sob Deno — importar este módulo fora
// dele (bun test) nunca dispara o listener.
const denoGlobal = readDenoGlobal();
if (typeof denoGlobal?.serve === "function") {
  denoGlobal.serve(handleRequest);
}
