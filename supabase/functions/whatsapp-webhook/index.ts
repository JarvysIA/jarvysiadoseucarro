// Edge Function: whatsapp-webhook (Build 5.4B).
// Webhook fino Z-API. Recebe evento, valida, normaliza, persiste, enfileira.
// NÃO faz: OCR, IA, download de mídia, envio outbound, gravação de despesa,
// FIPE, pagamento, chamada externa Z-API. Regra: Jarvys = cérebro, Z-API = canal.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { maskPhone } from "../_shared/whatsapp/phone.ts";
import { normalizeZapiInbound } from "../_shared/whatsapp/normalize.ts";
import type { NormalizedWhatsappInbound } from "../_shared/whatsapp/types.ts";

const MAX_PAYLOAD_BYTES = 512 * 1024;
const PROVIDER = "zapi" as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret, x-zapi-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Comparação com early-exit resistente a timing attack simples.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

const STRIP_ACCENTS_RE = /[\u0300-\u036f]/g;
function normalizeCommandText(text: string | null): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(STRIP_ACCENTS_RE, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const COMMANDS = new Set([
  "SAIR",
  "PARAR",
  "CANCELAR",
  "NAO QUERO",
  "REMOVER",
  "OI",
  "MENU",
  "AJUDA",
]);

function looksLikeCommand(text: string | null): boolean {
  const n = normalizeCommandText(text);
  if (n === "") return false;
  return COMMANDS.has(n);
}

function decideQueueType(n: NormalizedWhatsappInbound): string {
  switch (n.messageType) {
    case "image":
    case "pdf":
      return "ocr";
    case "text":
      return looksLikeCommand(n.textBody) ? "command" : "jarvys";
    case "audio":
    case "video":
    case "file":
    case "system":
    case "unknown":
    default:
      return "unknown";
  }
}

type SupabaseClient = ReturnType<typeof createClient>;

async function insertIgnoredEvent(
  supabase: SupabaseClient,
  n: NormalizedWhatsappInbound,
  errorMessage: string,
): Promise<void> {
  try {
    await supabase.from("whatsapp_events").insert({
      provider: PROVIDER,
      instance_id: n.instanceId,
      event_type: n.eventType,
      provider_event_id: n.providerEventId,
      provider_message_id: n.providerMessageId,
      direction: "inbound",
      phone_e164: n.phoneE164,
      raw_payload_sanitized: n.rawPayloadSanitized,
      received_at: n.receivedAt,
      status: "ignored",
      error_message: errorMessage,
      processed_at: new Date().toISOString(),
    });
  } catch (_) {
    // ignora conflito idempotente / falha soft; log estruturado abaixo.
  }
}

Deno.serve(async (req) => {
  const startedAt = Date.now();

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(JSON.stringify({ tag: "whatsapp-webhook", error: "server_not_configured" }));
    return json({ error: "server_not_configured" }, 500);
  }

  const expectedSecret = Deno.env.get("ZAPI_WEBHOOK_SECRET");
  if (!expectedSecret) {
    console.error(JSON.stringify({ tag: "whatsapp-webhook", error: "webhook_not_configured" }));
    return json({ error: "webhook_not_configured" }, 500);
  }

  const receivedSecret =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-zapi-webhook-secret") ??
    "";
  if (!receivedSecret || !safeEqual(receivedSecret, expectedSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const contentLengthRaw = req.headers.get("content-length");
  if (contentLengthRaw) {
    const cl = Number(contentLengthRaw);
    if (Number.isFinite(cl) && cl > MAX_PAYLOAD_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: true, ignored: "invalid_json" });
  }

  const n = normalizeZapiInbound(raw);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const baseLog = {
    tag: "whatsapp-webhook",
    provider: PROVIDER,
    instance_id: n.instanceId,
    event_type: n.eventType,
    provider_event_id: n.providerEventId,
    provider_message_id: n.providerMessageId,
    phone: maskPhone(n.phoneE164),
    message_type: n.messageType,
  };

  try {
    // 1. Ignora grupos no MVP.
    if (n.isGroup) {
      await insertIgnoredEvent(supabase, n, "group_ignored_mvp");
      console.log(
        JSON.stringify({ ...baseLog, status: "ignored_group", elapsed_ms: Date.now() - startedAt }),
      );
      return json({ ok: true, ignored: "group" });
    }

    // 2. Instance obrigatório.
    if (!n.instanceId) {
      await insertIgnoredEvent(supabase, n, "missing_instance_id");
      console.log(
        JSON.stringify({ ...baseLog, status: "ignored_missing_instance", elapsed_ms: Date.now() - startedAt }),
      );
      return json({ ok: true, ignored: "missing_instance_id" });
    }

    const { data: inst, error: instErr } = await supabase
      .from("whatsapp_provider_instances")
      .select("id, status, health_status")
      .eq("provider", PROVIDER)
      .eq("instance_id", n.instanceId)
      .maybeSingle();

    if (instErr) {
      console.error(JSON.stringify({ ...baseLog, status: "instance_lookup_failed", error_message: instErr.message }));
      return json({ error: "instance_lookup_failed" }, 500);
    }

    if (!inst) {
      await insertIgnoredEvent(supabase, n, "unknown_instance");
      console.log(
        JSON.stringify({ ...baseLog, status: "ignored_unknown_instance", elapsed_ms: Date.now() - startedAt }),
      );
      return json({ ok: true, ignored: "unknown_instance" });
    }

    if ((inst as { status?: string }).status !== "active" || (inst as { health_status?: string }).health_status === "failed") {
      await insertIgnoredEvent(supabase, n, "instance_not_active");
      console.log(
        JSON.stringify({ ...baseLog, status: "ignored_instance_not_active", elapsed_ms: Date.now() - startedAt }),
      );
      return json({ ok: true, ignored: "instance_not_active" });
    }

    // 3. Insere evento (idempotente por provider_event_id quando presente).
    const { data: evtRow, error: evtErr } = await supabase
      .from("whatsapp_events")
      .insert({
        provider: PROVIDER,
        instance_id: n.instanceId,
        event_type: n.eventType,
        provider_event_id: n.providerEventId,
        provider_message_id: n.providerMessageId,
        direction: "inbound",
        phone_e164: n.phoneE164,
        raw_payload_sanitized: n.rawPayloadSanitized,
        received_at: n.receivedAt,
        status: "received",
      })
      .select("id")
      .maybeSingle();

    if (evtErr) {
      // 23505 = unique_violation → duplicata do provider_event_id.
      if ((evtErr as { code?: string }).code === "23505") {
        console.log(
          JSON.stringify({ ...baseLog, status: "duplicate_event", elapsed_ms: Date.now() - startedAt }),
        );
        return json({ ok: true, duplicate: true });
      }
      console.error(JSON.stringify({ ...baseLog, status: "event_insert_failed", error_message: evtErr.message }));
      return json({ error: "event_insert_failed" }, 500);
    }

    const eventId = evtRow?.id as string | undefined;

    // 4. Lookup opcional de contato (sem criar contato sombra).
    let contactId: string | null = null;
    let userId: string | null = null;
    if (n.phoneE164) {
      const { data: contact } = await supabase
        .from("whatsapp_contacts")
        .select("id, user_id")
        .eq("phone_e164", n.phoneE164)
        .maybeSingle();
      if (contact) {
        contactId = (contact as { id: string }).id;
        userId = (contact as { user_id: string | null }).user_id ?? null;
      }
    }

    // 5. Insere mensagem (idempotente por provider_message_id).
    const { data: msgRow, error: msgErr } = await supabase
      .from("whatsapp_messages")
      .insert({
        user_id: userId,
        vehicle_id: null,
        contact_id: contactId,
        provider: PROVIDER,
        instance_id: n.instanceId,
        provider_message_id: n.providerMessageId,
        direction: "inbound",
        message_type: n.messageType,
        text_body: n.textBody,
        media_url: n.mediaUrl,
        media_mime_type: n.mediaMimeType,
        status: "received",
        plan_decision: null,
      })
      .select("id")
      .maybeSingle();

    if (msgErr) {
      if ((msgErr as { code?: string }).code === "23505") {
        // Duplicata de mensagem: marca evento como ignored, não enfileira.
        if (eventId) {
          await supabase
            .from("whatsapp_events")
            .update({
              status: "ignored",
              error_message: "duplicate_message",
              processed_at: new Date().toISOString(),
            })
            .eq("id", eventId);
        }
        console.log(
          JSON.stringify({ ...baseLog, status: "duplicate_message", elapsed_ms: Date.now() - startedAt }),
        );
        return json({ ok: true, duplicate: true });
      }
      console.error(JSON.stringify({ ...baseLog, status: "message_insert_failed", error_message: msgErr.message }));
      return json({ error: "message_insert_failed" }, 500);
    }

    const messageId = msgRow?.id as string | undefined;
    const queueType = decideQueueType(n);

    // 6. Enfileira.
    const { error: qErr } = await supabase.from("whatsapp_processing_queue").insert({
      message_id: messageId ?? null,
      event_id: eventId ?? null,
      queue_type: queueType,
      status: "queued",
      attempts: 0,
      max_attempts: 5,
      scheduled_at: new Date().toISOString(),
    });

    if (qErr) {
      console.error(JSON.stringify({ ...baseLog, status: "queue_insert_failed", error_message: qErr.message }));
      return json({ error: "queue_insert_failed" }, 500);
    }

    // 7. Marca mensagem como queued e evento como processed.
    if (messageId) {
      await supabase
        .from("whatsapp_messages")
        .update({ status: "queued" })
        .eq("id", messageId);
    }
    if (eventId) {
      await supabase
        .from("whatsapp_events")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", eventId);
    }

    console.log(
      JSON.stringify({
        ...baseLog,
        status: "queued",
        queue_type: queueType,
        elapsed_ms: Date.now() - startedAt,
      }),
    );
    return json({ ok: true, message_id: messageId, queued: true, queue_type: queueType });
  } catch (err) {
    console.error(
      JSON.stringify({
        ...baseLog,
        status: "unexpected_error",
        error_message: err instanceof Error ? err.message : "unknown",
      }),
    );
    return json({ error: "internal_error" }, 500);
  }
});
