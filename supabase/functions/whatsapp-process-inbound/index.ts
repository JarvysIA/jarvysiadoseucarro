// Edge Function: whatsapp-process-inbound (Build 5.5B).
// Worker inbound MVP. Consome whatsapp_processing_queue, decide ação,
// enfileira respostas em whatsapp_outbound_queue. NÃO chama Z-API, IA, OCR;
// não baixa mídia; não grava despesa; não atualiza KM.
// Jarvys = cérebro; Z-API = canal.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { maskPhone } from "../_shared/whatsapp/phone.ts";
import {
  runWhatsappOrchestratorShadow,
  type SupabaseLike as ShadowSupabaseLike,
} from "../_shared/whatsapp/orchestrator/shadow.ts";

const PROVIDER_DEFAULT = "zapi" as const;
const MAX_BATCH = 10;
const DEFAULT_BATCH = 10;
const ONBOARDING_TEXT =
  "Olá! Sou o Jarvys. Recebi sua mensagem, mas ainda não encontrei este WhatsApp vinculado a uma conta. Para usar os recursos pelo WhatsApp, acesse o app Jarvys e vincule este número.";
const ONBOARDING_UNLINKED_OPTOUT_TEXT =
  "Tudo certo. Se este número estiver vinculado ao Jarvys, ele não receberá mais mensagens não essenciais.";
const OPTOUT_LINKED_TEXT =
  "Tudo certo. Você não receberá mais mensagens do Jarvys por WhatsApp, exceto comunicações essenciais quando aplicável.";
const HELP_LINKED_TEXT =
  "Olá! Sou o Jarvys. Pelo WhatsApp, em breve você poderá enviar notas, fotos do painel e conversar comigo sobre seu veículo. Por enquanto, esta integração está em ativação.";
const JARVYS_STUB_LINKED_TEXT =
  "Recebi sua mensagem. O Dr. Jarvys pelo WhatsApp está em ativação e em breve responderei por aqui.";
const OCR_STUB_TEXT =
  "Recebi sua imagem/documento. O reconhecimento por WhatsApp está em ativação e em breve vou analisar notas, comprovantes e fotos do painel por aqui.";
const UNKNOWN_TEXT =
  "Recebi sua mensagem, mas esse tipo de conteúdo ainda não é suportado pelo Jarvys no WhatsApp.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
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

const STRIP_ACCENTS_RE = /[\u0300-\u036f]/g;
function normalizeCommandText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(STRIP_ACCENTS_RE, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const OPTOUT = new Set(["SAIR", "PARAR", "CANCELAR", "NAO QUERO", "REMOVER", "STOP"]);
const HELP = new Set(["OI", "OLA", "MENU", "AJUDA", "HELP", "?"]);

function looksLikeOptOut(t: string | null | undefined): boolean {
  const n = normalizeCommandText(t);
  return n !== "" && OPTOUT.has(n);
}
function looksLikeHelp(t: string | null | undefined): boolean {
  const n = normalizeCommandText(t);
  return n !== "" && HELP.has(n);
}

type WorkerSupabaseClient = SupabaseClient<any, "public", any>;

type QueueItem = {
  id: string;
  message_id: string | null;
  event_id: string | null;
  queue_type: string;
  attempts: number;
  max_attempts: number;
};

type MessageRow = {
  id: string;
  user_id: string | null;
  contact_id: string | null;
  vehicle_id: string | null;
  provider: string | null;
  instance_id: string | null;
  direction: string | null;
  message_type: string;
  text_body: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  status: string;
};

type ActionKind =
  | "opt_out"
  | "onboarding_unlinked"
  | "onboarding_suppressed_24h"
  | "help_linked"
  | "jarvys_stub_linked"
  | "ocr_stub_queued_for_future"
  | "cancelled"
  | "unknown_type";

type Decision = {
  action: ActionKind;
  reason?: string;
  linked?: boolean;
  suppressed?: boolean;
};

async function findPhoneFromEvent(
  supabase: SupabaseClient,
  eventId: string | null,
): Promise<string | null> {
  if (!eventId) return null;
  const { data } = await supabase
    .from("whatsapp_events")
    .select("phone_e164")
    .eq("id", eventId)
    .maybeSingle();
  return (data as { phone_e164?: string | null } | null)?.phone_e164 ?? null;
}

async function findPhoneFromContact(
  supabase: SupabaseClient,
  contactId: string | null,
): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await supabase
    .from("whatsapp_contacts")
    .select("phone_e164")
    .eq("id", contactId)
    .maybeSingle();
  return (data as { phone_e164?: string | null } | null)?.phone_e164 ?? null;
}

async function onboardingRecentlySent(
  supabase: SupabaseClient,
  phoneE164: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("whatsapp_outbound_queue")
    .select("id")
    .eq("phone_e164", phoneE164)
    .eq("text_body", ONBOARDING_TEXT)
    .gte("created_at", since)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function enqueueOutboundText(
  supabase: SupabaseClient,
  params: {
    user_id: string | null;
    contact_id: string | null;
    provider: string;
    instance_id: string | null;
    phone_e164: string | null;
    text_body: string;
    priority: number;
  },
): Promise<{ ok: boolean; error?: string }> {
  if (!params.phone_e164) return { ok: false, error: "missing_phone_e164" };
  const { error } = await supabase.from("whatsapp_outbound_queue").insert({
    user_id: params.user_id,
    contact_id: params.contact_id,
    vehicle_id: null,
    provider: params.provider || PROVIDER_DEFAULT,
    instance_id: params.instance_id,
    phone_e164: params.phone_e164,
    message_type: "text",
    text_body: params.text_body,
    status: "queued",
    priority: params.priority,
    attempts: 0,
    max_attempts: 5,
    scheduled_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function reevaluateQueueType(
  original: string,
  messageType: string,
  textBody: string | null,
): string {
  if (messageType === "image" || messageType === "pdf") return "ocr";
  if (messageType === "text") {
    if (looksLikeOptOut(textBody) || looksLikeHelp(textBody)) return "command";
    return "jarvys";
  }
  if (["audio", "video", "file", "system", "unknown"].includes(messageType)) return "unknown";
  return original;
}

async function claimNext(
  supabase: SupabaseClient,
  batchSize: number,
): Promise<QueueItem[]> {
  const nowIso = new Date().toISOString();
  const { data: candidates } = await supabase
    .from("whatsapp_processing_queue")
    .select("id, message_id, event_id, queue_type, attempts, max_attempts")
    .eq("status", "queued")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(batchSize);

  const rows = (candidates as QueueItem[] | null) ?? [];
  const claimed: QueueItem[] = [];
  for (const r of rows) {
    const { data: upd } = await supabase
      .from("whatsapp_processing_queue")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        attempts: r.attempts + 1,
      })
      .eq("id", r.id)
      .eq("status", "queued")
      .select("id, message_id, event_id, queue_type, attempts, max_attempts")
      .maybeSingle();
    if (upd) claimed.push(upd as QueueItem);
  }
  return claimed;
}

function backoffMinutes(attempts: number): number {
  return Math.min(Math.pow(2, attempts), 60);
}

async function markDone(supabase: SupabaseClient, queueId: string) {
  await supabase
    .from("whatsapp_processing_queue")
    .update({
      status: "done",
      finished_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", queueId);
}

async function markCancelled(
  supabase: SupabaseClient,
  queueId: string,
  reason: string,
) {
  await supabase
    .from("whatsapp_processing_queue")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
      error_message: reason.slice(0, 200),
    })
    .eq("id", queueId);
}

async function markFailOrRetry(
  supabase: SupabaseClient,
  item: QueueItem,
  errShort: string,
) {
  if (item.attempts >= item.max_attempts) {
    await supabase
      .from("whatsapp_processing_queue")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: errShort.slice(0, 200),
      })
      .eq("id", item.id);
    return;
  }
  const delayMs = backoffMinutes(item.attempts) * 60_000;
  await supabase
    .from("whatsapp_processing_queue")
    .update({
      status: "queued",
      scheduled_at: new Date(Date.now() + delayMs).toISOString(),
      error_message: errShort.slice(0, 200),
    })
    .eq("id", item.id);
}

async function updateMessageDecision(
  supabase: SupabaseClient,
  messageId: string | null,
  decision: Decision,
  msgStatus: "processed" | "ignored" | "cancelled" | "failed",
) {
  if (!messageId) return;
  await supabase
    .from("whatsapp_messages")
    .update({ plan_decision: decision, status: msgStatus })
    .eq("id", messageId);
}

async function processItem(
  supabase: SupabaseClient,
  item: QueueItem,
  baseLog: Record<string, unknown>,
): Promise<{ action: ActionKind | "no_message"; status: string }> {
  if (!item.message_id) {
    await markCancelled(supabase, item.id, "no_message_ref");
    return { action: "no_message", status: "cancelled" };
  }

  const { data: msgData, error: msgErr } = await supabase
    .from("whatsapp_messages")
    .select(
      "id, user_id, contact_id, vehicle_id, provider, instance_id, direction, message_type, text_body, media_url, media_mime_type, status",
    )
    .eq("id", item.message_id)
    .maybeSingle();

  if (msgErr) throw new Error(`msg_lookup_failed:${msgErr.message}`);
  if (!msgData) {
    await markCancelled(supabase, item.id, "message_not_found");
    return { action: "no_message", status: "cancelled" };
  }
  const msg = msgData as MessageRow;

  // Resolve phone (message table doesn't store it; try event then contact).
  const phone =
    (await findPhoneFromEvent(supabase, item.event_id)) ??
    (await findPhoneFromContact(supabase, msg.contact_id));

  const provider = msg.provider ?? PROVIDER_DEFAULT;
  const finalQueueType = reevaluateQueueType(item.queue_type, msg.message_type, msg.text_body);
  const linked = !!(msg.user_id && msg.contact_id);
  const log = { ...baseLog, message_id: msg.id, message_type: msg.message_type, queue_type: finalQueueType, phone: maskPhone(phone) };

  // 0) Shadow passivo do orquestrador (Build 5.7F2C1).
  //    Fail-open: exception/timeout NUNCA interrompe o fluxo legado abaixo.
  //    Gate local para evitar consultas em casos claramente inelegíveis.
  if (
    msg.direction === "inbound" &&
    msg.message_type === "text" &&
    msg.contact_id &&
    msg.user_id &&
    msg.provider &&
    msg.instance_id &&
    !looksLikeOptOut(msg.text_body)
  ) {
    try {
      await runWhatsappOrchestratorShadow(
        {
          queueItemId: item.id,
          userId: msg.user_id,
          message: {
            id: msg.id,
            contactId: msg.contact_id,
            provider: msg.provider,
            instanceId: msg.instance_id,
            direction: "inbound",
            messageType: "text",
            textBody: msg.text_body ?? "",
          },
          now: new Date().toISOString(),
        },
        { supabase: supabase as unknown as ShadowSupabaseLike },
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          tag: "whatsapp_orchestrator_shadow",
          queueItemId: item.id,
          messageId: msg.id,
          status: "failed",
          errorCategory: "hook_threw",
        }),
      );
      void err;
    }
  }

  // 1) OPT-OUT
  if (msg.message_type === "text" && looksLikeOptOut(msg.text_body)) {
    if (linked && msg.contact_id && msg.user_id) {
      await supabase
        .from("whatsapp_contacts")
        .update({ opt_out: true, opt_out_at: new Date().toISOString() })
        .eq("id", msg.contact_id);
      if (phone) {
        await supabase.from("whatsapp_consents").insert({
          user_id: msg.user_id,
          phone_e164: phone,
          consent_type: "notificacoes",
          source: "whatsapp_reply",
          consent_text: "Opt-out solicitado por comando WhatsApp",
          revoked_at: new Date().toISOString(),
        });
      }
      await enqueueOutboundText(supabase, {
        user_id: msg.user_id,
        contact_id: msg.contact_id,
        provider,
        instance_id: msg.instance_id,
        phone_e164: phone,
        text_body: OPTOUT_LINKED_TEXT,
        priority: 100,
      });
      await updateMessageDecision(supabase, msg.id, { action: "opt_out", linked: true }, "processed");
    } else {
      if (phone) {
        await enqueueOutboundText(supabase, {
          user_id: null,
          contact_id: null,
          provider,
          instance_id: msg.instance_id,
          phone_e164: phone,
          text_body: ONBOARDING_UNLINKED_OPTOUT_TEXT,
          priority: 100,
        });
      }
      await updateMessageDecision(
        supabase,
        msg.id,
        { action: "opt_out", linked: false, reason: phone ? undefined : "missing_phone_e164" },
        "processed",
      );
    }
    await markDone(supabase, item.id);
    console.log(JSON.stringify({ ...log, action: "opt_out", linked, status: "done" }));
    return { action: "opt_out", status: "done" };
  }

  // 2) Unlinked user (no user_id and no contact_id)
  if (!linked && !msg.user_id && !msg.contact_id) {
    if (msg.message_type === "text") {
      if (!phone) {
        await updateMessageDecision(
          supabase,
          msg.id,
          { action: "onboarding_unlinked", reason: "missing_phone_e164" },
          "ignored",
        );
        await markDone(supabase, item.id);
        console.log(JSON.stringify({ ...log, action: "onboarding_unlinked", reason: "missing_phone_e164", status: "done" }));
        return { action: "onboarding_unlinked", status: "done" };
      }
      const suppressed = await onboardingRecentlySent(supabase, phone);
      if (suppressed) {
        await updateMessageDecision(supabase, msg.id, { action: "onboarding_suppressed_24h" }, "processed");
        await markDone(supabase, item.id);
        console.log(JSON.stringify({ ...log, action: "onboarding_suppressed_24h", status: "done" }));
        return { action: "onboarding_suppressed_24h", status: "done" };
      }
      await enqueueOutboundText(supabase, {
        user_id: null,
        contact_id: null,
        provider,
        instance_id: msg.instance_id,
        phone_e164: phone,
        text_body: ONBOARDING_TEXT,
        priority: 80,
      });
      await updateMessageDecision(supabase, msg.id, { action: "onboarding_unlinked" }, "processed");
      await markDone(supabase, item.id);
      console.log(JSON.stringify({ ...log, action: "onboarding_unlinked", status: "done" }));
      return { action: "onboarding_unlinked", status: "done" };
    }
    // OCR/unknown from unlinked user → treat below with same "no IA/no OCR" stubs but still onboarding priority.
  }

  // 3) OCR (imagem/pdf)
  if (finalQueueType === "ocr") {
    const legacyAvatar =
      msg.message_type === "image" && !msg.media_url && !msg.media_mime_type;
    if (legacyAvatar) {
      await updateMessageDecision(
        supabase,
        msg.id,
        { action: "cancelled", reason: "legacy_avatar_misclassified" },
        "cancelled",
      );
      await markCancelled(supabase, item.id, "legacy_avatar_misclassified");
      console.log(JSON.stringify({ ...log, action: "cancelled", reason: "legacy_avatar_misclassified", status: "cancelled" }));
      return { action: "cancelled", status: "cancelled" };
    }
    if (phone) {
      await enqueueOutboundText(supabase, {
        user_id: msg.user_id,
        contact_id: msg.contact_id,
        provider,
        instance_id: msg.instance_id,
        phone_e164: phone,
        text_body: OCR_STUB_TEXT,
        priority: 50,
      });
    }
    await updateMessageDecision(
      supabase,
      msg.id,
      { action: "ocr_stub_queued_for_future", reason: phone ? undefined : "missing_phone_e164" },
      "processed",
    );
    await markDone(supabase, item.id);
    console.log(JSON.stringify({ ...log, action: "ocr_stub_queued_for_future", status: "done" }));
    return { action: "ocr_stub_queued_for_future", status: "done" };
  }

  // 4) HELP linked (menu/OI/AJUDA)
  if (linked && msg.message_type === "text" && looksLikeHelp(msg.text_body)) {
    if (phone) {
      await enqueueOutboundText(supabase, {
        user_id: msg.user_id,
        contact_id: msg.contact_id,
        provider,
        instance_id: msg.instance_id,
        phone_e164: phone,
        text_body: HELP_LINKED_TEXT,
        priority: 60,
      });
    }
    await updateMessageDecision(
      supabase,
      msg.id,
      { action: "help_linked", reason: phone ? undefined : "missing_phone_e164" },
      "processed",
    );
    await markDone(supabase, item.id);
    console.log(JSON.stringify({ ...log, action: "help_linked", status: "done" }));
    return { action: "help_linked", status: "done" };
  }

  // 5) Jarvys linked (free text)
  if (linked && finalQueueType === "jarvys") {
    if (phone) {
      await enqueueOutboundText(supabase, {
        user_id: msg.user_id,
        contact_id: msg.contact_id,
        provider,
        instance_id: msg.instance_id,
        phone_e164: phone,
        text_body: JARVYS_STUB_LINKED_TEXT,
        priority: 40,
      });
    }
    await updateMessageDecision(
      supabase,
      msg.id,
      { action: "jarvys_stub_linked", reason: phone ? undefined : "missing_phone_e164" },
      "processed",
    );
    await markDone(supabase, item.id);
    console.log(JSON.stringify({ ...log, action: "jarvys_stub_linked", status: "done" }));
    return { action: "jarvys_stub_linked", status: "done" };
  }

  // 6) Unknown / audio / video / file / system
  if (phone) {
    await enqueueOutboundText(supabase, {
      user_id: msg.user_id,
      contact_id: msg.contact_id,
      provider,
      instance_id: msg.instance_id,
      phone_e164: phone,
      text_body: UNKNOWN_TEXT,
      priority: 30,
    });
  }
  await updateMessageDecision(
    supabase,
    msg.id,
    { action: "unknown_type", reason: phone ? undefined : "missing_phone_e164" },
    "processed",
  );
  await markDone(supabase, item.id);
  console.log(JSON.stringify({ ...log, action: "unknown_type", status: "done" }));
  return { action: "unknown_type", status: "done" };
}

Deno.serve(async (req) => {
  const startedAt = Date.now();

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = Deno.env.get("WHATSAPP_WORKER_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(JSON.stringify({ tag: "whatsapp-process-inbound", error: "server_not_configured" }));
    return json({ error: "server_not_configured" }, 500);
  }
  if (!workerSecret) {
    console.error(JSON.stringify({ tag: "whatsapp-process-inbound", error: "worker_not_configured" }));
    return json({ error: "worker_not_configured" }, 500);
  }

  const receivedSecret = req.headers.get("x-worker-secret") ?? "";
  if (!receivedSecret || !safeEqual(receivedSecret, workerSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let batchSize = DEFAULT_BATCH;
  try {
    const raw = new URL(req.url).searchParams.get("batch_size");
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 1 && n <= MAX_BATCH) batchSize = Math.floor(n);
    }
  } catch {
    batchSize = DEFAULT_BATCH;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const baseLog = { tag: "whatsapp-process-inbound", batch_size: batchSize };

  let claimed: QueueItem[] = [];
  try {
    claimed = await claimNext(supabase, batchSize);
  } catch (err) {
    console.error(
      JSON.stringify({
        ...baseLog,
        status: "claim_failed",
        error_message: err instanceof Error ? err.message : "unknown",
      }),
    );
    return json({ error: "claim_failed" }, 500);
  }

  const summary: Record<string, number> = {};
  for (const item of claimed) {
    try {
      const result = await processItem(supabase, item, {
        ...baseLog,
        queue_id: item.id,
      });
      summary[result.action] = (summary[result.action] ?? 0) + 1;
    } catch (err) {
      const errShort = err instanceof Error ? err.message : "unknown";
      console.error(
        JSON.stringify({
          ...baseLog,
          queue_id: item.id,
          status: "process_error",
          error_message: errShort.slice(0, 200),
        }),
      );
      await markFailOrRetry(supabase, item, errShort);
      summary["retry_or_failed"] = (summary["retry_or_failed"] ?? 0) + 1;
    }
  }

  const elapsed = Date.now() - startedAt;
  console.log(
    JSON.stringify({
      ...baseLog,
      status: "batch_done",
      claimed: claimed.length,
      summary,
      elapsed_ms: elapsed,
    }),
  );
  return json({ ok: true, claimed: claimed.length, summary, elapsed_ms: elapsed });
});
