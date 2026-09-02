// Build Maintenance-Alert — Alerta proativo de km com itens + links de
// afiliado. Espelha a estrutura HTTP de whatsapp-process-orchestrator/
// index.ts (POST autenticado, CORS, safeEqual, checks de config, import
// dinâmico do supabase-js) mas com um segredo PRÓPRIO e distinto
// (WHATSAPP_MAINTENANCE_ALERTS_SECRET / x-maintenance-alerts-secret) —
// mesmo padrão documentado lá: cada function deste repo usa um segredo
// dedicado, nunca compartilhado.
//
// Import dinâmico do supabase-js (não estático no topo): mesmo motivo já
// documentado em whatsapp-process-orchestrator/index.ts — um import
// estático `from "https://esm.sh/..."` quebra o test runner (bun).
//
// Lógica de negócio extraída pra runMaintenanceAlertsBatch (mesmo padrão
// "Hipótese C" já usado em runGenerateVehicleImage/vehicle-image-cache.ts):
// recebe um client estrutural injetado, sem depender do supabaseAdmin real
// nem de mock.module() — só assim dá pra testar de verdade num sandbox
// onde o import dinâmico de esm.sh é bloqueado pelo proxy de rede.
//
// Não cria o cron job em si (SQL direto, fora deste arquivo — mesmo padrão
// dos outros 5 cron jobs existentes, incluindo o do orquestrador).

import {
  getMilestoneWindowStatus,
} from "../_shared/whatsapp/maintenance-engine/predictive-milestone.ts";
import {
  buildJarvysMilestone,
  type JarvysVehicleProfile,
} from "../_shared/whatsapp/maintenance-engine/jarvys-schedule-rules.ts";
import { buildJarvysVisualGroups } from "../_shared/whatsapp/maintenance-engine/visual-groups.ts";
import { buildMilestoneAlertMessage } from "../_shared/whatsapp/maintenance-engine/message-builder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-maintenance-alerts-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Mesma implementação (char a char, tempo constante) já usada em
// whatsapp-process-orchestrator/index.ts::safeEqual — pequena e
// auto-contida, copiada em vez de extraída pra um helper compartilhado
// novo (não pedido, mesma decisão de lá).
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

// Perfil fallback pra veículos sem jarvys_technical_profile salvo — mesmo
// fallback já usado no restante do app (contexto confirmado no PLAN desta
// build).
const FALLBACK_PROFILE: JarvysVehicleProfile = {
  fuelKind: "combustao",
  timingSystem: "desconhecido",
  transmissionKind: "desconhecido",
  steeringKind: "desconhecida",
};

const DEFAULT_BATCH_LIMIT = 200;

// ------------------------------------------------------------
// Client estrutural mínimo — só o subconjunto de supabase-js que este
// handler usa. Mesmo espírito de VehicleImageAdminClient
// (src/lib/vehicle-image-cache.ts) e SupabaseLike (orchestrator/
// repository.ts) — permite mockar num teste sem tocar no client real nem
// em mock.module().
// ------------------------------------------------------------

export type VehicleCandidateRow = {
  id: string;
  marca: string | null;
  modelo: string | null;
  km_atual: number | null;
  jarvys_technical_profile: unknown;
  user_id: string | null;
};

export type WhatsappContactRow = {
  id: string;
  user_id: string;
  assigned_provider: string | null;
  assigned_instance_id: string | null;
};

export type WhatsappProviderInstanceRow = {
  provider: string;
  instance_id: string;
  status: string;
};

export type MilestoneNoticeRow = {
  status: string;
  snoozed_until: string | null;
};

type ListResult<T> = { data: T[] | null; error: { message: string } | null };
type MaybeSingleResult<T> = { data: T | null; error: { message: string } | null };
type MutationResult = { error: { message: string } | null };
type RpcResult = { data: unknown; error: { message: string } | null };

type VeiculosChain = {
  in(column: "status", values: string[]): {
    not(column: "km_atual", operator: "is", value: null): {
      limit(n: number): Promise<ListResult<VehicleCandidateRow>>;
    };
  };
};

type WhatsappContactsChain = {
  in(column: "user_id", values: string[]): {
    not(column: "verified_at", operator: "is", value: null): {
      eq(column: "opt_out", value: false): {
        eq(column: "is_primary", value: true): Promise<ListResult<WhatsappContactRow>>;
      };
    };
  };
};

type WhatsappProviderInstancesChain = {
  eq(column: "status", value: "active"): Promise<ListResult<WhatsappProviderInstanceRow>>;
};

type MilestoneNoticeChain = {
  eq(column: "vehicle_id", value: string): {
    eq(column: "milestone_km", value: number): {
      maybeSingle(): Promise<MaybeSingleResult<MilestoneNoticeRow>>;
    };
  };
};

export type MaintenanceAlertsClient = {
  from(table: "veiculos"): { select(columns: string): VeiculosChain };
  from(table: "whatsapp_contacts"): { select(columns: string): WhatsappContactsChain };
  from(table: "whatsapp_provider_instances"): {
    select(columns: string): WhatsappProviderInstancesChain;
  };
  from(table: "whatsapp_milestone_notices"): { select(columns: string): MilestoneNoticeChain };
  from(table: "whatsapp_outbound_queue"): {
    insert(row: Record<string, unknown>): Promise<MutationResult>;
  };
  rpc(
    fn: "record_whatsapp_milestone_notice",
    params: {
      p_user_id: string;
      p_vehicle_id: string;
      p_milestone_km: number;
      p_action: "notified";
    },
  ): Promise<RpcResult>;
};

// ------------------------------------------------------------
// Logger estruturado — mesmo padrão de createProductionLogger em
// whatsapp-process-orchestrator/index.ts (linha JSON com tag, eventos de
// falha pro console.error, resto pro console.log). Evento próprio deste
// domínio (não reaproveita TestServiceLogger — formato de evento
// diferente), replicando o padrão em vez de importar a função (instrução
// explícita: "reaproveite... ou replique o padrão").
// ------------------------------------------------------------

export type MaintenanceAlertsLogEvent =
  | { event: "batch_started"; limit: number }
  | { event: "batch_completed"; evaluated: number; sent: number }
  | { event: "candidate_skipped"; vehicleId: string; reason: string }
  | { event: "candidate_error"; vehicleId: string }
  | { event: "alert_sent"; vehicleId: string; milestoneKm: number };

const FAILURE_EVENTS = new Set(["candidate_error"]);

export function createProductionLogger(): (event: MaintenanceAlertsLogEvent) => void {
  return (event) => {
    const line = JSON.stringify({ tag: "whatsapp-maintenance-alerts", ...event });
    if (FAILURE_EVENTS.has(event.event)) {
      console.error(line);
    } else {
      console.log(line);
    }
  };
}

// ------------------------------------------------------------
// runMaintenanceAlertsBatch — lógica completa, extraída do handler HTTP
// pra ficar testável com um client mockado, sem precisar do runtime Deno
// real nem de rede.
// ------------------------------------------------------------

export type MaintenanceAlertsSkipReason =
  | "no_contact"
  | "no_instance"
  | "outside_window"
  | "already_notified"
  | "dismissed"
  | "snoozed"
  | "duplicate_queued"
  | "error";

export type MaintenanceAlertsBatchResult = {
  candidatesEvaluated: number;
  sent: number;
  skipped: Record<MaintenanceAlertsSkipReason, number>;
};

function emptySkipCounts(): Record<MaintenanceAlertsSkipReason, number> {
  return {
    no_contact: 0,
    no_instance: 0,
    outside_window: 0,
    already_notified: 0,
    dismissed: 0,
    snoozed: 0,
    duplicate_queued: 0,
    error: 0,
  };
}

function isValidProfileShape(value: unknown): value is JarvysVehicleProfile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.fuelKind === "string" &&
    typeof v.timingSystem === "string" &&
    typeof v.transmissionKind === "string" &&
    typeof v.steeringKind === "string"
  );
}

export async function runMaintenanceAlertsBatch(
  client: MaintenanceAlertsClient,
  opts: { limit: number; logger: (event: MaintenanceAlertsLogEvent) => void },
): Promise<MaintenanceAlertsBatchResult> {
  const { limit, logger } = opts;
  logger({ event: "batch_started", limit });

  const skipped = emptySkipCounts();
  let sent = 0;

  // 1) Veículos candidatos (ativos, com km_atual).
  const vehiclesRes = await client
    .from("veiculos")
    .select("id, marca, modelo, km_atual, jarvys_technical_profile, user_id")
    .in("status", ["ativo", "active"])
    .not("km_atual", "is", null)
    .limit(limit);
  const vehicles = vehiclesRes.data ?? [];

  const userIds = Array.from(
    new Set(vehicles.map((v) => v.user_id).filter((id): id is string => Boolean(id))),
  );

  // 2) Contatos verificados, sem opt-out, primários — em lote.
  const contactsByUserId = new Map<string, WhatsappContactRow>();
  if (userIds.length > 0) {
    const contactsRes = await client
      .from("whatsapp_contacts")
      .select("id, user_id, assigned_provider, assigned_instance_id")
      .in("user_id", userIds)
      .not("verified_at", "is", null)
      .eq("opt_out", false)
      .eq("is_primary", true);
    for (const c of contactsRes.data ?? []) {
      contactsByUserId.set(c.user_id, c);
    }
  }

  // 3) Instâncias de provider ativas — em lote.
  const instancesByKey = new Map<string, WhatsappProviderInstanceRow>();
  const instancesRes = await client
    .from("whatsapp_provider_instances")
    .select("provider, instance_id, status")
    .eq("status", "active");
  for (const inst of instancesRes.data ?? []) {
    instancesByKey.set(`${inst.provider}:${inst.instance_id}`, inst);
  }

  // 4) Junta vehicle + contact + instance. Vehicle sem contato válido ou
  // sem instância ativa correspondente nunca vira um candidato avaliado
  // (equivalente a um INNER JOIN).
  type JoinedCandidate = {
    vehicle: VehicleCandidateRow;
    contact: WhatsappContactRow;
    instance: WhatsappProviderInstanceRow;
  };
  const joined: JoinedCandidate[] = [];
  for (const vehicle of vehicles) {
    const contact = vehicle.user_id ? contactsByUserId.get(vehicle.user_id) : undefined;
    if (!contact) {
      skipped.no_contact++;
      continue;
    }
    const key = `${contact.assigned_provider ?? ""}:${contact.assigned_instance_id ?? ""}`;
    const instance = instancesByKey.get(key);
    if (!instance) {
      skipped.no_instance++;
      continue;
    }
    joined.push({ vehicle, contact, instance });
  }

  // 5) Avalia cada candidato.
  for (const { vehicle, contact, instance } of joined) {
    try {
      const windowStatus = getMilestoneWindowStatus(vehicle.km_atual ?? 0);
      if (!windowStatus.withinWindow) {
        skipped.outside_window++;
        continue;
      }
      const milestoneKm = windowStatus.milestone;

      const noticeRes = await client
        .from("whatsapp_milestone_notices")
        .select("status, snoozed_until")
        .eq("vehicle_id", vehicle.id)
        .eq("milestone_km", milestoneKm)
        .maybeSingle();
      const notice = noticeRes.error ? null : noticeRes.data;

      if (notice) {
        if (notice.status === "notified") {
          skipped.already_notified++;
          continue;
        }
        if (notice.status === "dismissed") {
          skipped.dismissed++;
          continue;
        }
        if (notice.status === "snoozed") {
          const snoozedUntil = notice.snoozed_until ? new Date(notice.snoozed_until) : null;
          if (snoozedUntil && snoozedUntil.getTime() > Date.now()) {
            skipped.snoozed++;
            continue;
          }
          // snooze expirado → prossegue.
        }
      }

      const profile = isValidProfileShape(vehicle.jarvys_technical_profile)
        ? vehicle.jarvys_technical_profile
        : FALLBACK_PROFILE;
      const milestone = buildJarvysMilestone(milestoneKm, profile);
      const groups = buildJarvysVisualGroups(milestone.items);
      const text = buildMilestoneAlertMessage({
        marca: vehicle.marca ?? "",
        modelo: vehicle.modelo ?? "",
        kmAtual: vehicle.km_atual ?? 0,
        targetKm: milestoneKm,
        groups,
      });

      const idempotencyKey = `milestone_alert:${vehicle.id}:${milestoneKm}`;
      const insertRes = await client.from("whatsapp_outbound_queue").insert({
        user_id: vehicle.user_id,
        contact_id: contact.id,
        vehicle_id: vehicle.id,
        provider: instance.provider,
        instance_id: instance.instance_id,
        message_type: "text",
        text_body: text,
        status: "queued",
        purpose: "notification",
        idempotency_key: idempotencyKey,
      });
      if (insertRes.error) {
        // Já enfileirado antes (violação de woq_idempotency_unique) ou
        // outra falha estrutural — nunca trava o lote, só pula este item.
        skipped.duplicate_queued++;
        continue;
      }

      // Best-effort: se o RPC falhar, o alerta já foi enfileirado (vai ser
      // enviado); só o bookkeeping de "já notificado" pode ficar
      // desatualizado, o que na pior hipótese gera um reenvio na próxima
      // rodada — degradação aceitável, nunca perde o envio já enfileirado.
      await client.rpc("record_whatsapp_milestone_notice", {
        p_user_id: vehicle.user_id ?? "",
        p_vehicle_id: vehicle.id,
        p_milestone_km: milestoneKm,
        p_action: "notified",
      });

      sent++;
      logger({ event: "alert_sent", vehicleId: vehicle.id, milestoneKm });
    } catch {
      skipped.error++;
      logger({ event: "candidate_error", vehicleId: vehicle.id });
    }
  }

  const result: MaintenanceAlertsBatchResult = {
    candidatesEvaluated: joined.length,
    sent,
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
  const alertsSecret = readDenoEnv("WHATSAPP_MAINTENANCE_ALERTS_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(JSON.stringify({ tag: "whatsapp-maintenance-alerts", error: "server_not_configured" }));
    return json({ error: "server_not_configured" }, 500);
  }
  if (!alertsSecret) {
    console.error(JSON.stringify({ tag: "whatsapp-maintenance-alerts", error: "worker_not_configured" }));
    return json({ error: "worker_not_configured" }, 500);
  }

  const receivedSecret = req.headers.get("x-maintenance-alerts-secret") ?? "";
  if (!receivedSecret || !safeEqual(receivedSecret, alertsSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit ? Number(rawLimit) : DEFAULT_BATCH_LIMIT;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : DEFAULT_BATCH_LIMIT;

  try {
    const mod = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
    const client = mod.createClient(supabaseUrl, serviceRoleKey) as unknown as MaintenanceAlertsClient;

    const result = await runMaintenanceAlertsBatch(client, {
      limit,
      logger: createProductionLogger(),
    });

    // Só contagens — nunca texto de mensagem, id de contato ou qualquer
    // dado sensível no corpo da resposta.
    return json(result, 200);
  } catch {
    console.error(JSON.stringify({ tag: "whatsapp-maintenance-alerts", error: "unexpected_error" }));
    return json({ error: "internal_error" }, 500);
  }
}

// Só inicia o servidor de verdade sob Deno — importar este módulo fora
// dele (bun test) nunca dispara o listener.
const denoGlobal = readDenoGlobal();
if (typeof denoGlobal?.serve === "function") {
  denoGlobal.serve(handleRequest);
}
