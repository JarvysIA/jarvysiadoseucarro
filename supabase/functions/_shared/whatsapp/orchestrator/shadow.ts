// Build 5.7F2C1 — Shadow passivo do orquestrador WhatsApp.
// Estritamente read-only. Nunca chama claim/apply/release. Nunca escreve.
// Nunca chama sender, provider, IA ou OCR. Falha aberta: nunca propaga
// exception ao worker legado. Emite apenas log sanitizado.
//
// Regras vinculantes (Build 5.7F2C-PLAN e 5.7F2C1):
//   - resolve instância por (provider, instance_id) — nunca por id;
//   - só continua se instance.status='active' e orchestrator_mode='shadow';
//   - state ausente → snapshot virtual idle/v0/draftVersion=0/fallback=0;
//   - veículos: SELECT sem filtro de status, filtro archived em memória,
//     activeVehicleIssue calculado a partir da lista completa;
//   - AbortController + setTimeout + abortSignal encadeado nas queries;
//   - decideConversation apenas observado, nunca aplicado.

import { decideConversation } from "../conversation/index.ts";
import type {
  ConversationState,
  ConversationVehicle,
} from "../conversation/types.ts";
import {
  computeWhatsappVehicleAccessMode,
  type WhatsappVehicleAccessProfileInput,
} from "../plan/vehicle-access-mode.ts";

// ============================================================
// Constantes
// ============================================================

/**
 * Timeout default do shadow em milissegundos. Provisório: não medido em
 * produção. Cobre uma chamada de instância + duas queries paralelas + core
 * síncrono com folga sem ampliar significativamente a latência do worker.
 */
export const SHADOW_TIMEOUT_MS = 800;

// ============================================================
// Cliente estrutural (subset supabase-js suficiente para SELECT + abortSignal)
// ============================================================

export type ShadowSelectResult<T = Record<string, unknown>> = {
  data: T[] | null;
  error: { message: string; code?: string | null } | null;
};

export type ShadowMaybeSingleResult<T = Record<string, unknown>> = {
  data: T | null;
  error: { message: string; code?: string | null } | null;
};

export type ShadowSelectBuilder<T = Record<string, unknown>> =
  PromiseLike<ShadowSelectResult<T>>
  & {
    eq: (column: string, value: unknown) => ShadowSelectBuilder<T>;
    abortSignal: (signal: AbortSignal) => ShadowSelectBuilder<T>;
    maybeSingle: () => Promise<ShadowMaybeSingleResult<T>>;
  };

export type ShadowFromBuilder = {
  select: <T = Record<string, unknown>>(columns: string) => ShadowSelectBuilder<T>;
};

export type SupabaseLike = {
  from: (table: string) => ShadowFromBuilder;
};

// ============================================================
// Logger sanitizado
// ============================================================

export type ShadowLogEvent = {
  tag: "whatsapp_orchestrator_shadow";
  queueItemId: string;
  messageId: string;
  contactId: string;
  provider: string;
  instanceId: string;
  orchestratorMode?: "shadow";
  durationMs: number;
  status: "evaluated" | "skipped" | "failed" | "timeout";
  decisionKind?: string;
  eventKind?: string;
  outcome?: string;
  nextState?: string;
  responseKey?: string | null;
  skipReason?: string;
  errorCategory?: string;
  activeVehicleIssue?: "invalid" | "archived";
};

export type ShadowLogger = {
  info: (evt: ShadowLogEvent) => void;
  warn: (evt: ShadowLogEvent) => void;
  error: (evt: ShadowLogEvent) => void;
};

const defaultLogger: ShadowLogger = {
  info: (evt) => console.info(JSON.stringify(evt)),
  warn: (evt) => console.warn(JSON.stringify(evt)),
  error: (evt) => console.error(JSON.stringify(evt)),
};

// ============================================================
// Input / Output públicos
// ============================================================

export type ShadowInput = {
  queueItemId: string;
  userId: string;
  message: {
    id: string;
    contactId: string;
    provider: string;
    instanceId: string;
    direction: "inbound";
    messageType: "text";
    textBody: string;
  };
  now: string;
};

export type ShadowDeps = {
  supabase: SupabaseLike;
  logger?: ShadowLogger;
  timeoutMs?: number;
};

export type ShadowRunResult =
  | { status: "evaluated"; durationMs: number }
  | {
      status: "skipped";
      reason: "mode_not_shadow" | "instance_not_active" | "instance_missing";
      durationMs: number;
    }
  | { status: "failed"; errorCategory: string; durationMs: number }
  | { status: "timeout"; durationMs: number };

// ============================================================
// Helpers puros
// ============================================================

function virtualState(): ConversationState {
  return {
    state: "idle",
    currentIntent: null,
    awaitingField: null,
    requestSource: null,
    draftType: null,
    draftId: null,
    draftVersion: 0,
    draftPayload: null,
    activeVehicleId: null,
    confirmedAt: null,
    executedAt: null,
    expiresAt: null,
    lastMessageId: null,
  };
}

function mapStateRow(row: Record<string, unknown>): ConversationState {
  const stateName = (row.state as string) ?? "idle";
  return {
    state: stateName as ConversationState["state"],
    currentIntent: (row.current_intent as string | null) ?? null,
    awaitingField: (row.awaiting_field as string | null) ?? null,
    requestSource: (row.request_source as string | null) ?? null,
    draftType: (row.draft_type as string | null) ?? null,
    draftId: (row.draft_id as string | null) ?? null,
    draftVersion:
      row.draft_version == null ? 0 : Number(row.draft_version),
    draftPayload:
      (row.draft_payload as Record<string, unknown> | null) ?? null,
    activeVehicleId: (row.active_vehicle_id as string | null) ?? null,
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    executedAt: (row.executed_at as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    lastMessageId: (row.last_message_id as string | null) ?? null,
  };
}

type VehicleRow = {
  id: string;
  user_id: string | null;
  marca: string | null;
  modelo: string | null;
  placa: string | null;
  status: string | null;
  // Build 5.7F2E1A.5-MA — transporte read-only de km_atual. Nunca logado.
  km_atual: number | null;
};

type ProfileRow = {
  id: string;
  status_usuario: string | null;
  trial_inicio: string | null;
};

type PagamentoRow = {
  veiculo_id: string | null;
};


// Build 5.7F2E1A.5-MA — mesma regra de validação usada no Repository.
const KM_ATUAL_MAX = 2147483647;
function parseKmAtualShadow(raw: unknown): number | null {
  if (raw === null) return null;
  if (raw === undefined) {
    throw new Error("veiculos.km_atual ausente (undefined) — esperado integer|null");
  }
  if (typeof raw !== "number") {
    throw new Error("veiculos.km_atual com tipo inesperado (esperado integer|null)");
  }
  if (!Number.isInteger(raw) || raw < 0 || raw > KM_ATUAL_MAX) {
    throw new Error("veiculos.km_atual fora do range válido (0..2147483647 integer)");
  }
  return raw;
}

function buildBaseLog(input: ShadowInput) {
  return {
    tag: "whatsapp_orchestrator_shadow" as const,
    queueItemId: input.queueItemId,
    messageId: input.message.id,
    contactId: input.message.contactId,
    provider: input.message.provider,
    instanceId: input.message.instanceId,
  };
}

function isAbortLike(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown };
  if (typeof e.name === "string" && /Abort|Timeout/i.test(e.name)) return true;
  if (typeof e.message === "string" && /aborted|timeout/i.test(e.message)) return true;
  return false;
}

// ============================================================
// Função pública
// ============================================================

export async function runWhatsappOrchestratorShadow(
  input: ShadowInput,
  deps: ShadowDeps,
): Promise<ShadowRunResult> {
  const startedAt = Date.now();
  const logger = deps.logger ?? defaultLogger;
  const timeoutMs = deps.timeoutMs ?? SHADOW_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const baseLog = buildBaseLog(input);

  try {
    // 1) Instância — lookup por (provider, instance_id). NUNCA por id.
    let instResp: ShadowMaybeSingleResult;
    try {
      instResp = await deps.supabase
        .from("whatsapp_provider_instances")
        .select("id, status, orchestrator_mode")
        .eq("provider", input.message.provider)
        .eq("instance_id", input.message.instanceId)
        .abortSignal(controller.signal)
        .maybeSingle();
    } catch (err) {
      if (isAbortLike(err, controller.signal)) {
        return emitTimeout(baseLog, startedAt, logger);
      }
      return emitFailed(baseLog, startedAt, "instance_lookup_failed", logger);
    }
    if (instResp.error) {
      return emitFailed(baseLog, startedAt, "instance_lookup_failed", logger);
    }
    const inst = instResp.data as
      | { status?: string | null; orchestrator_mode?: string | null }
      | null;
    if (!inst) {
      return { status: "skipped", reason: "instance_missing", durationMs: Date.now() - startedAt };
    }
    if (inst.status !== "active") {
      return { status: "skipped", reason: "instance_not_active", durationMs: Date.now() - startedAt };
    }
    if (inst.orchestrator_mode !== "shadow") {
      return { status: "skipped", reason: "mode_not_shadow", durationMs: Date.now() - startedAt };
    }

    // 2) State + veículos + profile + activations em paralelo.
    //    Build 5.7F2E1A.5-MJ0 — o classificador de acesso por veículo
    //    exige perfil do usuário e ativações pagas (pagamentos_pix).
    //    Todas compartilham o AbortSignal e são fail-open ao worker legado.
    let stateResp: ShadowMaybeSingleResult;
    let vehiclesResp: ShadowSelectResult<VehicleRow>;
    let profileResp: ShadowMaybeSingleResult<ProfileRow>;
    let activationsResp: ShadowSelectResult<PagamentoRow>;
    try {
      const [s, v, p, a] = await Promise.all([
        deps.supabase
          .from("whatsapp_conversation_states")
          .select(
            "state, current_intent, awaiting_field, request_source, draft_type, draft_id, draft_version, draft_payload, active_vehicle_id, confirmed_at, executed_at, last_message_id, expires_at, state_version, fallback_count",
          )
          .eq("contact_id", input.message.contactId)
          .abortSignal(controller.signal)
          .maybeSingle(),
        deps.supabase
          .from("veiculos")
          .select<VehicleRow>("id, user_id, marca, modelo, placa, status, km_atual")
          .eq("user_id", input.userId)
          .abortSignal(controller.signal),
        deps.supabase
          .from("profiles")
          .select<ProfileRow>("id, status_usuario, trial_inicio")
          .eq("id", input.userId)
          .abortSignal(controller.signal)
          .maybeSingle(),
        deps.supabase
          .from("pagamentos_pix")
          .select<PagamentoRow>("veiculo_id")
          .eq("user_id", input.userId)
          .eq("status", "pago")
          .eq("tipo_produto", "ativacao")
          .abortSignal(controller.signal),
      ]);
      stateResp = s;
      vehiclesResp = v;
      profileResp = p;
      activationsResp = a;
    } catch (err) {
      if (isAbortLike(err, controller.signal)) {
        return emitTimeout(baseLog, startedAt, logger);
      }
      return emitFailed(baseLog, startedAt, "context_lookup_failed", logger);
    }
    if (stateResp.error) {
      return emitFailed(baseLog, startedAt, "state_lookup_failed", logger);
    }
    if (vehiclesResp.error) {
      return emitFailed(baseLog, startedAt, "vehicles_lookup_failed", logger);
    }
    if (profileResp.error) {
      return emitFailed(baseLog, startedAt, "profile_lookup_failed", logger);
    }
    if (activationsResp.error) {
      return emitFailed(baseLog, startedAt, "activations_lookup_failed", logger);
    }
    if (!profileResp.data) {
      return emitFailed(baseLog, startedAt, "profile_missing", logger);
    }

    const stateRow = stateResp.data;
    const state = stateRow ? mapStateRow(stateRow) : virtualState();
    const stateVersion = stateRow
      ? Number((stateRow as Record<string, unknown>).state_version ?? 0)
      : 0;
    const fallbackCount = stateRow
      ? Number((stateRow as Record<string, unknown>).fallback_count ?? 0)
      : 0;
    // stateVersion não é passado ao core; capturado apenas para clareza.
    void stateVersion;

    const profileInput: WhatsappVehicleAccessProfileInput = {
      statusUsuario: profileResp.data.status_usuario,
      trialInicio: profileResp.data.trial_inicio,
    };
    const activationSet = new Set<string>();
    for (const row of activationsResp.data ?? []) {
      if (typeof row.veiculo_id === "string" && row.veiculo_id.length > 0) {
        activationSet.add(row.veiculo_id);
      }
    }
    const nowDate = new Date();

    const allVehicles: VehicleRow[] = vehiclesResp.data ?? [];
    let eligibleVehicles: ConversationVehicle[];
    try {
      eligibleVehicles = allVehicles
        .filter((v) => v.status !== "archived")
        .map((v) => ({
          id: v.id,
          brand: v.marca,
          model: v.modelo,
          plate: v.placa,
          isArchived: false,
          isEligible: true,
          kmAtual: parseKmAtualShadow(v.km_atual),
          whatsappAccessMode: computeWhatsappVehicleAccessMode(
            profileInput,
            {
              id: v.id,
              userId: typeof v.user_id === "string" ? v.user_id : "",
              status: v.status,
              hasPaidActivation: activationSet.has(v.id),
            },
            input.userId,
            nowDate,
          ),
        }));
    } catch {
      return emitFailed(baseLog, startedAt, "vehicles_lookup_failed", logger);
    }


    let activeVehicleIssue: "invalid" | "archived" | null = null;
    if (state.activeVehicleId) {
      const found = allVehicles.find((v) => v.id === state.activeVehicleId);
      if (!found) activeVehicleIssue = "invalid";
      else if (found.status === "archived") activeVehicleIssue = "archived";
    }

    // 3) Core determinístico — apenas observado.
    let decision;
    try {
      decision = decideConversation({
        sourceMessageId: input.message.id,
        messageType: input.message.messageType,
        originalText: input.message.textBody,
        now: input.now,
        state,
        vehicles: eligibleVehicles,
        fallbackCount,
        isReplay: false,
      });
    } catch {
      return emitFailed(baseLog, startedAt, "core_threw", logger);
    }

    const durationMs = Date.now() - startedAt;
    const evt: ShadowLogEvent = {
      ...baseLog,
      orchestratorMode: "shadow",
      durationMs,
      status: "evaluated",
      decisionKind: decision.decisionKind,
      eventKind: decision.eventKind,
      outcome: decision.outcome,
      nextState: decision.nextState,
      responseKey: decision.responseKey ?? null,
    };
    if (activeVehicleIssue) evt.activeVehicleIssue = activeVehicleIssue;
    logger.info(evt);
    return { status: "evaluated", durationMs };
  } catch (err) {
    if (isAbortLike(err, controller.signal)) {
      return emitTimeout(baseLog, startedAt, logger);
    }
    return emitFailed(baseLog, startedAt, "unexpected", logger);
  } finally {
    clearTimeout(timer);
  }
}

function emitTimeout(
  baseLog: ReturnType<typeof buildBaseLog>,
  startedAt: number,
  logger: ShadowLogger,
): ShadowRunResult {
  const durationMs = Date.now() - startedAt;
  logger.warn({
    ...baseLog,
    orchestratorMode: "shadow",
    durationMs,
    status: "timeout",
  });
  return { status: "timeout", durationMs };
}

function emitFailed(
  baseLog: ReturnType<typeof buildBaseLog>,
  startedAt: number,
  errorCategory: string,
  logger: ShadowLogger,
): ShadowRunResult {
  const durationMs = Date.now() - startedAt;
  logger.error({
    ...baseLog,
    orchestratorMode: "shadow",
    durationMs,
    status: "failed",
    errorCategory,
  });
  return { status: "failed", errorCategory, durationMs };
}
