/**
 * Z-API provider stub (Build 5.3).
 * NÃO chama Z-API real. NÃO lê env. NÃO envia mensagem.
 * Apenas normaliza inbound de forma tolerante e verifica header estruturalmente.
 */

import type {
  NormalizedWhatsappInbound,
  NormalizedWhatsappOutboundRequest,
  WhatsappMessageType,
  WhatsappProvider,
  WhatsappSendResult,
  WhatsappWebhookVerificationInput,
  WhatsappWebhookVerificationResult,
} from "../provider-types";
import { normalizeBrazilPhoneToE164 } from "../phone";
import { sanitizeWhatsappPayload } from "../sanitize";

function headerGet(
  headers: WhatsappWebhookVerificationInput["headers"],
  name: string,
): string | null {
  if (!headers) return null;
  const key = name.toLowerCase();
  if (typeof (headers as Headers).get === "function") {
    const v = (headers as Headers).get(key);
    return v ?? null;
  }
  const rec = headers as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(rec)) {
    if (k.toLowerCase() === key) return v ?? null;
  }
  return null;
}

function pickString(obj: unknown, ...paths: string[]): string | null {
  if (obj == null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const path of paths) {
    const parts = path.split(".");
    let cur: unknown = o;
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
  const o = obj as Record<string, unknown>;
  for (const path of paths) {
    const parts = path.split(".");
    let cur: unknown = o;
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

function detectMessageType(
  payload: unknown,
  mimeType: string | null,
): WhatsappMessageType {
  if (payload == null || typeof payload !== "object") return "unknown";
  const p = payload as Record<string, unknown>;

  const explicit = pickString(p, "type", "messageType", "event");
  if (explicit) {
    const t = explicit.toLowerCase();
    if (t.includes("text") || t.includes("chat") || t.includes("message")) {
      // pode ser text; continua checando abaixo antes de decidir
    }
    if (t.includes("image") || t.includes("photo")) return "image";
    if (t.includes("document") || t.includes("pdf")) {
      if (mimeType && mimeType.toLowerCase().includes("pdf")) return "pdf";
      return "file";
    }
    if (t.includes("audio") || t.includes("voice") || t.includes("ptt")) return "audio";
    if (t.includes("video")) return "video";
    if (t.includes("system")) return "system";
  }

  if (mimeType) {
    const m = mimeType.toLowerCase();
    if (m.startsWith("image/")) return "image";
    if (m === "application/pdf") return "pdf";
    if (m.startsWith("audio/")) return "audio";
    if (m.startsWith("video/")) return "video";
  }

  if (p.image || p.photo || p.imageUrl) return "image";
  if (p.document || p.file) {
    if (mimeType && mimeType.toLowerCase().includes("pdf")) return "pdf";
    return "file";
  }
  if (p.audio || p.voice) return "audio";
  if (p.video) return "video";

  const text = pickString(p, "text", "message", "body", "text.message", "message.text");
  if (text != null) return "text";

  return "unknown";
}

export const zapiProvider: WhatsappProvider = {
  name: "zapi",

  verifyWebhook(input: WhatsappWebhookVerificationInput): WhatsappWebhookVerificationResult {
    const expected = input.expectedSecret ?? null;
    if (!expected) {
      // TODO Build 5.4: exigir secret obrigatório vindo do Vault.
      return { ok: true };
    }
    const provided =
      headerGet(input.headers, "x-webhook-secret") ??
      headerGet(input.headers, "x-zapi-webhook-secret");
    if (!provided || provided !== expected) {
      return { ok: false, errorMessage: "invalid_webhook_secret" };
    }
    return { ok: true };
  },

  normalizeInbound(payload: unknown): NormalizedWhatsappInbound {
    const sanitized = sanitizeWhatsappPayload(payload);
    const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;

    const instanceId = pickString(p, "instanceId", "instance.id", "instance");
    const providerEventId = pickString(
      p,
      "eventId",
      "id",
      "event.id",
      "webhookId",
    );
    const providerMessageId = pickString(
      p,
      "messageId",
      "message.id",
      "message.messageId",
      "id",
    );
    const rawPhone = pickString(
      p,
      "phone",
      "from",
      "sender",
      "senderPhone",
      "message.from",
    );
    const phoneE164 = normalizeBrazilPhoneToE164(rawPhone ?? "");
    const displayName = pickString(
      p,
      "senderName",
      "pushName",
      "notifyName",
      "chatName",
      "contact.name",
    );

    const isGroup =
      pickBool(p, "isGroup", "isGroupMsg", "group") ||
      (typeof rawPhone === "string" && rawPhone.includes("@g.us"));

    const mediaUrl = pickString(
      p,
      "mediaUrl",
      "image.imageUrl",
      "image.url",
      "document.documentUrl",
      "document.url",
      "audio.audioUrl",
      "video.videoUrl",
      "file.url",
    );
    const mediaMimeType = pickString(
      p,
      "mimeType",
      "image.mimeType",
      "document.mimeType",
      "audio.mimeType",
      "video.mimeType",
      "file.mimeType",
    );

    const messageType = detectMessageType(p, mediaMimeType);
    const textBody =
      messageType === "text"
        ? pickString(p, "text", "message", "body", "text.message", "message.text")
        : pickString(p, "caption", "text.caption", "image.caption", "document.caption");

    const eventType = pickString(p, "event", "type", "messageType") ?? "message";

    let receivedAt = pickString(p, "moment", "timestamp", "receivedAt", "date");
    if (receivedAt && /^\d+$/.test(receivedAt)) {
      const num = Number(receivedAt);
      const ms = num < 1e12 ? num * 1000 : num;
      receivedAt = new Date(ms).toISOString();
    } else if (!receivedAt) {
      receivedAt = new Date().toISOString();
    }

    return {
      provider: "zapi",
      instanceId: instanceId ?? null,
      providerEventId: providerEventId ?? null,
      providerMessageId: providerMessageId ?? null,
      direction: "inbound",
      phoneE164,
      displayName: displayName ?? null,
      messageType,
      textBody: textBody ?? null,
      mediaUrl: mediaUrl ?? null,
      mediaMimeType: mediaMimeType ?? null,
      isGroup,
      eventType,
      receivedAt,
      rawPayloadSanitized: sanitized,
    };
  },

  async sendMessage(
    _request: NormalizedWhatsappOutboundRequest,
  ): Promise<WhatsappSendResult> {
    // TODO Build 5.6+: implementar envio real via Z-API com secret do Vault,
    // rate limit, retry backoff, dedupe por provider_message_id.
    return {
      ok: false,
      errorMessage: "Z-API sendMessage not implemented in Build 5.3",
    };
  },
};
