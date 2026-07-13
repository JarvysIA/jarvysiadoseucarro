// Edge Function: whatsapp-send-outbound (Build 5.7F2E1A.5-MJ1A).
// Sender outbound WhatsApp via Z-API. Consome whatsapp_outbound_queue,
// envia texto real, atualiza status. Não envia imagem/PDF/áudio/vídeo.
//
// MJ1A: quando o item claimed for um prompt Jarvys de KM (identificado
// pela existência de uma linha em whatsapp_km_prompt_requests cujo
// prompt_message_id = source_message_id do item), a finalização de sucesso
// e a terminal são feitas via RPCs SECURITY DEFINER que atualizam
// atomicamente queue + message + request. Retryable continua usando o
// caminho legado (markRequeue) — nunca finalizador terminal.
//
// Jarvys = cérebro; Z-API = canal.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isLikelyE164, maskPhone } from "../_shared/whatsapp/phone.ts";
import { sendZapiText } from "../_shared/whatsapp/zapi-outbound.ts";
import {
  WhatsappKmPromptRepository,
  type KmPromptSupabaseLike,
} from "../_shared/whatsapp/km-prompts/repository.ts";
import type { KmPromptTerminalReason } from "../_shared/whatsapp/km-prompts/types.ts";

const PROVIDER = "zapi";
const DEFAULT_BATCH = 1;
const MAX_BATCH = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sender-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

type OutboundRow = {
  id: string;
  user_id: string | null;
  contact_id: string | null;
  provider: string;
  instance_id: string | null;
  phone_e164: string | null;
  message_type: string;
  text_body: string | null;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  purpose: string | null;
  expires_at: string | null;
  source_message_id: string | null;
  kmPromptRequestId: string | null;
};

const CLAIM_COLUMNS =
  "id, user_id, contact_id, provider, instance_id, phone_e164, message_type, text_body, status, priority, attempts, max_attempts, scheduled_at, purpose, expires_at, source_message_id";

function backoffMinutes(attempts: number): number {
  if (attempts <= 1) return 1;
  if (attempts === 2) return 5;
  if (attempts === 3) return 15;
  return 60;
}

async function claimBatch(supabase: SupabaseClient, batchSize: number): Promise<OutboundRow[]> {
  const nowIso = new Date().toISOString();
  const { data: candidates } = await supabase
    .from("whatsapp_outbound_queue")
    .select(CLAIM_COLUMNS)
    .eq("status", "queued")
    .eq("provider", PROVIDER)
    .eq("message_type", "text")
    .lte("scheduled_at", nowIso)
    .order("priority", { ascending: false })
    .order("scheduled_at", { ascending: true })
    .limit(batchSize);

  const rows = (candidates as Array<Omit<OutboundRow, "kmPromptRequestId">> | null) ?? [];
  const claimed: OutboundRow[] = [];
  for (const r of rows) {
    const { data: upd } = await supabase
      .from("whatsapp_outbound_queue")
      .update({ status: "sending", attempts: r.attempts + 1 })
      .eq("id", r.id)
      .eq("status", "queued")
      .select(CLAIM_COLUMNS)
      .maybeSingle();
    if (upd) {
      claimed.push({ ...(upd as Omit<OutboundRow, "kmPromptRequestId">), kmPromptRequestId: null });
    }
  }

  // Batch lookup KM prompts em UMA query (sem N+1).
  const sourceMessageIds = claimed
    .map((c) => c.source_message_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (sourceMessageIds.length > 0) {
    const { data: kmRows } = await supabase
      .from("whatsapp_km_prompt_requests")
      .select("id, prompt_message_id")
      .in("prompt_message_id", sourceMessageIds);
    const byMsgId = new Map<string, string>();
    for (const kr of (kmRows as Array<{ id: string; prompt_message_id: string }> | null) ?? []) {
      byMsgId.set(kr.prompt_message_id, kr.id);
    }
    for (const c of claimed) {
      if (c.source_message_id && byMsgId.has(c.source_message_id)) {
        c.kmPromptRequestId = byMsgId.get(c.source_message_id) ?? null;
      }
    }
  }

  return claimed;
}

async function markSent(
  supabase: SupabaseClient,
  id: string,
  providerMessageId: string | null,
) {
  await supabase
    .from("whatsapp_outbound_queue")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      provider_message_id: providerMessageId,
      error_message: null,
    })
    .eq("id", id);
}

async function markCancelled(supabase: SupabaseClient, id: string, reason: string) {
  await supabase
    .from("whatsapp_outbound_queue")
    .update({ status: "cancelled", error_message: reason.slice(0, 200) })
    .eq("id", id);
}

async function markFailed(supabase: SupabaseClient, id: string, reason: string) {
  await supabase
    .from("whatsapp_outbound_queue")
    .update({ status: "failed", error_message: reason.slice(0, 200) })
    .eq("id", id);
}

async function markRequeue(
  supabase: SupabaseClient,
  id: string,
  attempts: number,
  reason: string,
) {
  const delayMs = backoffMinutes(attempts) * 60_000;
  await supabase
    .from("whatsapp_outbound_queue")
    .update({
      status: "queued",
      scheduled_at: new Date(Date.now() + delayMs).toISOString(),
      error_message: reason.slice(0, 200),
    })
    .eq("id", id);
}

async function fetchInstance(supabase: SupabaseClient, instanceId: string) {
  const { data } = await supabase
    .from("whatsapp_provider_instances")
    .select("id, provider, instance_id, status, health_status, daily_message_limit")
    .eq("provider", PROVIDER)
    .eq("instance_id", instanceId)
    .maybeSingle();
  return data as
    | {
        id: string;
        provider: string;
        instance_id: string;
        status: string;
        health_status: string;
        daily_message_limit: number | null;
      }
    | null;
}

async function countSentToday(
  supabase: SupabaseClient,
  instanceId: string,
): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("whatsapp_outbound_queue")
    .select("id", { count: "exact", head: true })
    .eq("provider", PROVIDER)
    .eq("instance_id", instanceId)
    .eq("status", "sent")
    .gte("sent_at", startOfDay.toISOString());
  return count ?? 0;
}

// ------------------------------------------------------------
// KM branch helpers (MJ1A)
// ------------------------------------------------------------

const KM_INVARIANT_RESULTS = new Set<string>([
  "km_prompt_invariant_violation",
  "terminal_after_success_invariant",
  "terminal_after_prompt_progress_invariant",
  "provider_message_id_mismatch",
  "queue_state_invalid",
  "queue_not_found",
  "max_attempts_not_reached",
]);

async function finalizeKmSuccess(
  repo: WhatsappKmPromptRepository,
  queueId: string,
  providerMessageId: string | null,
  log: Record<string, unknown>,
): Promise<{ result: string }> {
  if (!providerMessageId) {
    // Sem provider_message_id não podemos finalizar via RPC (contrato exige).
    // Deixa o item em 'sending' e devolve invariant no relatório.
    console.log(
      JSON.stringify({ ...log, status: "km_invariant", reason: "missing_provider_message_id" }),
    );
    return { result: "km_invariant" };
  }
  const res = await repo.finalizeSent({
    outboundQueueId: queueId,
    providerMessageId,
  });
  if (res.result === "finalized" || res.result === "replayed") {
    console.log(
      JSON.stringify({ ...log, status: "km_sent", result: res.result }),
    );
    return { result: "sent" };
  }
  if (KM_INVARIANT_RESULTS.has(res.result)) {
    console.log(
      JSON.stringify({ ...log, status: "km_invariant", reason: res.result }),
    );
    return { result: "km_invariant" };
  }
  console.log(JSON.stringify({ ...log, status: "km_invariant", reason: res.result }));
  return { result: "km_invariant" };
}

async function finalizeKmTerminal(
  repo: WhatsappKmPromptRepository,
  queueId: string,
  reason: KmPromptTerminalReason,
  errorMessage: string | null,
  log: Record<string, unknown>,
): Promise<{ result: string }> {
  const res = await repo.finalizeFailed({
    outboundQueueId: queueId,
    terminalReason: reason,
    errorMessage,
  });
  if (res.result === "finalized" || res.result === "terminal_replayed") {
    console.log(
      JSON.stringify({ ...log, status: "km_failed", result: res.result, terminal_reason: reason }),
    );
    return { result: "failed" };
  }
  console.log(
    JSON.stringify({ ...log, status: "km_invariant", reason: res.result, terminal_reason: reason }),
  );
  return { result: "km_invariant" };
}

async function processItem(
  supabase: SupabaseClient,
  repo: WhatsappKmPromptRepository,
  item: OutboundRow,
  env: {
    apiBaseUrl: string;
    instanceToken: string;
    clientToken: string;
  },
): Promise<{ result: string; statusCode?: number; retryable?: boolean }> {
  const t0 = Date.now();
  const isKm = item.kmPromptRequestId !== null;
  const log: Record<string, unknown> = {
    tag: "whatsapp-send-outbound",
    queue_id: item.id,
    provider: item.provider,
    instance_id: item.instance_id,
    phone: maskPhone(item.phone_e164),
    attempt: item.attempts,
    is_km: isKm,
    km_prompt_request_id: item.kmPromptRequestId,
  };

  // Helper: falha terminal preflight (com branch KM)
  const failPreflight = async (reason: string) => {
    if (isKm) {
      await finalizeKmTerminal(repo, item.id, "preflight_invalid", reason, log);
      return { result: "failed" };
    }
    await markFailed(supabase, item.id, reason);
    console.log(JSON.stringify({ ...log, status: "failed", reason }));
    return { result: "failed" };
  };

  // Validações pré-envio
  if (item.provider !== PROVIDER) return await failPreflight("unsupported_provider");
  if (item.message_type !== "text") return await failPreflight("unsupported_message_type");
  if (!item.text_body || item.text_body.trim() === "" || item.text_body.length > 4000) {
    return await failPreflight("invalid_text_body");
  }
  if (!item.phone_e164 || !isLikelyE164(item.phone_e164)) {
    return await failPreflight("invalid_phone_e164");
  }
  if (!item.instance_id) return await failPreflight("missing_instance_id");

  // link_code expirado — não envia, cancela sem retry. Não aplica a KM
  // (purpose de KM é 'notification'; garantimos abaixo com isKm=false).
  if (!isKm && item.purpose === "link_code" && item.expires_at) {
    const exp = new Date(item.expires_at).getTime();
    if (Number.isFinite(exp) && exp <= Date.now()) {
      await markCancelled(supabase, item.id, "link_code_expired");
      console.log(JSON.stringify({ ...log, status: "cancelled", reason: "link_code_expired" }));
      return { result: "cancelled" };
    }
  }

  const instance = await fetchInstance(supabase, item.instance_id);
  if (!instance) {
    if (isKm) {
      await finalizeKmTerminal(repo, item.id, "instance_not_found", "instance_not_found", log);
      return { result: "failed" };
    }
    await markFailed(supabase, item.id, "instance_not_found");
    console.log(JSON.stringify({ ...log, status: "failed", reason: "instance_not_found" }));
    return { result: "failed" };
  }
  if (instance.status !== "active" || instance.health_status === "failed") {
    await markRequeue(supabase, item.id, item.attempts, "instance_not_ready");
    console.log(JSON.stringify({ ...log, status: "requeued", reason: "instance_not_ready" }));
    return { result: "requeued" };
  }

  // Opt-out — bypass exclusivo para purpose='link_code'. KM (notification)
  // continua bloqueado se opt_out=true, e nesse caso finaliza terminal.
  if (item.contact_id) {
    const { data: contact } = await supabase
      .from("whatsapp_contacts")
      .select("opt_out")
      .eq("id", item.contact_id)
      .maybeSingle();
    if (contact && (contact as { opt_out: boolean }).opt_out === true) {
      if (item.purpose !== "link_code") {
        if (isKm) {
          await finalizeKmTerminal(repo, item.id, "preflight_invalid", "contact_opted_out", log);
          return { result: "failed" };
        }
        await markCancelled(supabase, item.id, "contact_opted_out");
        console.log(JSON.stringify({ ...log, status: "cancelled", reason: "contact_opted_out" }));
        return { result: "cancelled" };
      }
      console.log(
        JSON.stringify({ ...log, status: "opt_out_bypass", reason: "link_code_reactivation" }),
      );
    }
  }

  // Daily limit da instância (comportamento legado: reagendar próximo dia).
  if (instance.daily_message_limit && instance.daily_message_limit > 0) {
    const sentToday = await countSentToday(supabase, item.instance_id);
    if (sentToday >= instance.daily_message_limit) {
      const nextDay = new Date();
      nextDay.setUTCHours(24, 5, 0, 0);
      await supabase
        .from("whatsapp_outbound_queue")
        .update({
          status: "queued",
          scheduled_at: nextDay.toISOString(),
          error_message: "daily_instance_limit",
        })
        .eq("id", item.id);
      console.log(JSON.stringify({ ...log, status: "requeued", reason: "daily_instance_limit" }));
      return { result: "requeued" };
    }
  }

  // Envio real
  const res = await sendZapiText({
    apiBaseUrl: env.apiBaseUrl,
    instanceId: item.instance_id,
    instanceToken: env.instanceToken,
    clientToken: env.clientToken,
    phoneE164: item.phone_e164,
    textBody: item.text_body,
    clientReference: item.id,
  });

  const elapsedMs = Date.now() - t0;
  const baseOut = {
    ...log,
    statusCode: res.statusCode,
    retryable: res.retryable,
    elapsed_ms: elapsedMs,
  };

  if (res.ok) {
    if (isKm) {
      const km = await finalizeKmSuccess(repo, item.id, res.providerMessageId ?? null, baseOut);
      if (km.result === "sent" && item.contact_id) {
        await supabase
          .from("whatsapp_contacts")
          .update({ last_outbound_at: new Date().toISOString() })
          .eq("id", item.contact_id);
      }
      return { result: km.result, statusCode: res.statusCode };
    }
    await markSent(supabase, item.id, res.providerMessageId ?? null);
    if (item.contact_id) {
      await supabase
        .from("whatsapp_contacts")
        .update({ last_outbound_at: new Date().toISOString() })
        .eq("id", item.contact_id);
    }
    console.log(
      JSON.stringify({
        ...baseOut,
        status: "sent",
        has_provider_message_id: !!res.providerMessageId,
      }),
    );
    return { result: "sent", statusCode: res.statusCode };
  }

  if (res.timeoutAmbiguous) {
    if (isKm) {
      const km = await finalizeKmTerminal(
        repo,
        item.id,
        "timeout_ambiguous",
        "timeout_ambiguous_manual_review",
        baseOut,
      );
      return { result: km.result, statusCode: res.statusCode };
    }
    await markFailed(supabase, item.id, "timeout_ambiguous_manual_review");
    console.log(JSON.stringify({ ...baseOut, status: "failed", reason: "timeout_ambiguous" }));
    return { result: "failed" };
  }

  if (!res.retryable) {
    if (isKm) {
      const km = await finalizeKmTerminal(
        repo,
        item.id,
        "non_retryable_provider_error",
        res.errorCode ?? "send_failed",
        baseOut,
      );
      return { result: km.result, statusCode: res.statusCode };
    }
    await markFailed(supabase, item.id, res.errorCode ?? "send_failed");
    console.log(JSON.stringify({ ...baseOut, status: "failed", reason: res.errorCode }));
    return { result: "failed" };
  }

  if (item.attempts >= item.max_attempts) {
    if (isKm) {
      const km = await finalizeKmTerminal(
        repo,
        item.id,
        "max_attempts_reached",
        res.errorCode ?? "retry",
        baseOut,
      );
      return { result: km.result, statusCode: res.statusCode };
    }
    await markFailed(supabase, item.id, `max_attempts_${res.errorCode ?? "retry"}`);
    console.log(
      JSON.stringify({ ...baseOut, status: "failed", reason: "max_attempts_exceeded" }),
    );
    return { result: "failed" };
  }

  // Retryable: idêntico para KM e não KM (nunca chama finalizador terminal).
  await markRequeue(supabase, item.id, item.attempts, res.errorCode ?? "retryable_error");
  console.log(JSON.stringify({ ...baseOut, status: "requeued", reason: res.errorCode }));
  return { result: "requeued", statusCode: res.statusCode, retryable: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const senderSecret = Deno.env.get("WHATSAPP_SENDER_SECRET");
  if (!senderSecret) return json({ error: "sender_not_configured" }, 500);

  const provided = req.headers.get("x-sender-secret") ?? "";
  if (!provided || !safeEqual(provided, senderSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  const apiBaseUrl = Deno.env.get("ZAPI_API_URL");
  const instanceToken = Deno.env.get("ZAPI_INSTANCE_TOKEN");
  const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN");
  if (!apiBaseUrl || !instanceToken || !clientToken) {
    return json({ error: "zapi_not_configured" }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "supabase_not_configured" }, 500);

  const url = new URL(req.url);
  const raw = url.searchParams.get("batch_size");
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_BATCH;
  const batchSize = Math.min(MAX_BATCH, Math.max(1, Number.isFinite(parsed) ? parsed : DEFAULT_BATCH));

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const repo = new WhatsappKmPromptRepository(supabase as unknown as KmPromptSupabaseLike);

  try {
    const claimed = await claimBatch(supabase, batchSize);
    if (claimed.length === 0) {
      return json({ ok: true, batch_size: batchSize, claimed: 0, results: [] });
    }
    const results: Array<{ id: string; result: string; statusCode?: number; is_km?: boolean }> = [];
    for (const item of claimed) {
      try {
        const r = await processItem(supabase, repo, item, {
          apiBaseUrl,
          instanceToken,
          clientToken,
        });
        results.push({
          id: item.id,
          result: r.result,
          statusCode: r.statusCode,
          is_km: item.kmPromptRequestId !== null,
        });
      } catch (err) {
        const short = err instanceof Error ? err.message.slice(0, 200) : "unknown_error";
        await markRequeue(supabase, item.id, item.attempts, `worker_error:${short}`);
        console.log(
          JSON.stringify({
            tag: "whatsapp-send-outbound",
            queue_id: item.id,
            status: "requeued",
            reason: "worker_error",
          }),
        );
        results.push({ id: item.id, result: "requeued" });
      }
    }
    return json({ ok: true, batch_size: batchSize, claimed: claimed.length, results });
  } catch (err) {
    const short = err instanceof Error ? err.message.slice(0, 200) : "unknown_error";
    console.log(
      JSON.stringify({ tag: "whatsapp-send-outbound", status: "fatal", reason: short }),
    );
    return json({ error: "internal_error" }, 500);
  }
});
