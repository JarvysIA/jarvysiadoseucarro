// Normalizador Z-API inbound (Build 5.4B - Deno).
// Port tolerante da lógica de src/lib/whatsapp/providers/zapi-provider.ts.
// Nunca lança. Sempre retorna NormalizedWhatsappInbound.

import type { NormalizedWhatsappInbound, WhatsappMessageType } from "./types.ts";
import { normalizeBrazilPhoneToE164 } from "./phone.ts";
import { safeString, sanitizeWhatsappPayload } from "./sanitize.ts";

const MEDIA_URL_MAX = 2000;
const TEXT_BODY_MAX = 4000;

function pickString(obj: unknown, ...paths: string[]): string | null {
  if (obj == null || typeof obj !== "object") return null;
  for (const path of paths) {
    const parts = path.split(".");
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[p];
    }
    if (typeof cur === "string" && cur.trim() !== "") return cur;
    if (typeof cur === "number") return String(cur);
  }
  return null;
}

function pickBool(obj: unknown, ...paths: string[]): boolean {
  const s = pickString(obj, ...paths);
  if (s != null) return s === "true" || s === "1";
  if (obj == null || typeof obj !== "object") return false;
  for (const path of paths) {
    const parts = path.split(".");
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[p];
    }
    if (typeof cur === "boolean") return cur;
  }
  return false;
}

const TEXT_PATHS = [
  "text.message",
  "message.text",
  "data.text",
  "data.message",
  "text",
  "message",
  "body",
  "msg",
  "content",
] as const;

function pickInboundText(payload: Record<string, unknown>): string | null {
  return pickString(payload, ...TEXT_PATHS);
}

function detectMessageType(
  payload: Record<string, unknown>,
  mimeType: string | null,
  mediaUrl: string | null,
): WhatsappMessageType {
  // 1) Explicit type hints (ignore generic wrappers like "ReceivedCallback").
  const explicit = pickString(payload, "messageType", "type", "event");
  if (explicit) {
    const t = explicit.toLowerCase();
    if (t.includes("image") && !t.includes("received")) return "image";
    if (t.includes("pdf")) return "pdf";
    if (t.includes("document")) {
      if (mimeType && mimeType.toLowerCase().includes("pdf")) return "pdf";
      return "file";
    }
    if (t.includes("audio") || t.includes("voice") || t.includes("ptt")) return "audio";
    if (t.includes("video")) return "video";
    if (t.includes("system")) return "system";
  }

  // 2) Prioritize real text content BEFORE any media auxiliary check
  //    (payload.photo is the sender's avatar, not a message attachment).
  const text = pickInboundText(payload);
  if (text != null && text.trim() !== "") return "text";

  // 3) Real media MIME type on the message.
  if (mimeType) {
    const m = mimeType.toLowerCase();
    if (m.startsWith("image/")) return "image";
    if (m === "application/pdf") return "pdf";
    if (m.startsWith("audio/")) return "audio";
    if (m.startsWith("video/")) return "video";
  }

  if (mediaUrl && mediaUrl.toLowerCase().endsWith(".pdf")) return "pdf";

  // 4) Real media fields on the message. NOTE: payload.photo is intentionally
  //    excluded — Z-API sends the contact's profile photo/avatar under that
  //    key, which must never classify a message as image.
  if (payload.image || (payload as Record<string, unknown>).imageUrl) return "image";
  if (payload.document || payload.file) {
    if (mimeType && mimeType.toLowerCase().includes("pdf")) return "pdf";
    return "file";
  }
  if (payload.audio || payload.voice) return "audio";
  if (payload.video) return "video";

  return "unknown";
}

function normalizeReceivedAt(raw: string | null): string {
  if (!raw) return new Date().toISOString();
  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    const ms = num < 1e12 ? num * 1000 : num;
    return new Date(ms).toISOString();
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export function normalizeZapiInbound(payload: unknown): NormalizedWhatsappInbound {
  const sanitized = sanitizeWhatsappPayload(payload);
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;

  const instanceId = pickString(
    p,
    "instanceId",
    "instance_id",
    "instance.id",
    "instance",
    "connectedPhone",
  );
  const providerEventId = pickString(
    p,
    "eventId",
    "event_id",
    "event.id",
    "webhookId",
    "id",
  );
  const providerMessageId = pickString(
    p,
    "messageId",
    "message_id",
    "msgId",
    "message.id",
    "message.messageId",
    "data.messageId",
  );

  const rawPhone = pickString(
    p,
    "phone",
    "from",
    "sender",
    "senderPhone",
    "participantPhone",
    "message.from",
  );
  const phoneE164 = normalizeBrazilPhoneToE164(rawPhone ?? "");
  const displayName = pickString(
    p,
    "senderName",
    "pushName",
    "notifyName",
    "name",
    "contactName",
    "chatName",
    "contact.name",
  );

  const fromStr = pickString(p, "from") ?? "";
  const isGroup =
    pickBool(p, "isGroup", "isGroupMsg", "group") ||
    (typeof rawPhone === "string" && rawPhone.includes("@g.us")) ||
    fromStr.includes("@g.us");

  const rawMediaUrl = pickString(
    p,
    "mediaUrl",
    "imageUrl",
    "documentUrl",
    "audioUrl",
    "videoUrl",
    "fileUrl",
    "url",
    "image.imageUrl",
    "image.url",
    "document.documentUrl",
    "document.url",
    "audio.audioUrl",
    "video.videoUrl",
    "file.url",
  );
  const mediaUrl = safeString(rawMediaUrl, MEDIA_URL_MAX);

  const mediaMimeType = pickString(
    p,
    "mimeType",
    "mimetype",
    "mediaMimeType",
    "image.mimeType",
    "document.mimeType",
    "audio.mimeType",
    "video.mimeType",
    "file.mimeType",
  );

  const messageType = detectMessageType(p, mediaMimeType, mediaUrl);

  const rawText =
    messageType === "text"
      ? pickString(p, "text", "message", "body", "text.message", "message.text", "data.text")
      : pickString(p, "caption", "text.caption", "image.caption", "document.caption");
  const textBody = safeString(rawText, TEXT_BODY_MAX);

  const eventType = pickString(p, "event", "type", "messageType") ?? "message";

  const receivedAt = normalizeReceivedAt(
    pickString(p, "moment", "timestamp", "receivedAt", "date"),
  );

  return {
    provider: "zapi",
    instanceId: instanceId ?? null,
    providerEventId: providerEventId ?? null,
    providerMessageId: providerMessageId ?? null,
    direction: "inbound",
    phoneE164,
    displayName: displayName ?? null,
    messageType,
    textBody,
    mediaUrl,
    mediaMimeType: mediaMimeType ?? null,
    isGroup,
    eventType,
    receivedAt,
    rawPayloadSanitized: sanitized,
  };
}
