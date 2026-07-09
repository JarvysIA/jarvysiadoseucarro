// Tipos WhatsApp provider-agnostic (Build 5.4B - Edge Function/Deno).
// Port dos tipos criados no Build 5.3 (src/lib/whatsapp/provider-types.ts).

export type ProviderName = "zapi" | "meta_cloud" | "other";

export type WhatsappMessageType =
  | "text"
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "file"
  | "system"
  | "unknown";

export type NormalizedWhatsappInbound = {
  provider: ProviderName;
  instanceId: string | null;
  providerEventId: string | null;
  providerMessageId: string | null;
  direction: "inbound";
  phoneE164: string | null;
  displayName: string | null;
  messageType: WhatsappMessageType;
  textBody: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  isGroup: boolean;
  eventType: string;
  receivedAt: string;
  rawPayloadSanitized: Record<string, unknown>;
};

export type WhatsappWebhookVerificationResult = {
  ok: boolean;
  errorMessage?: string;
};
