/**
 * WhatsApp provider-agnostic contracts (Build 5.3).
 * Nenhum efeito colateral. Sem banco, sem env, sem API externa.
 */

export type ProviderName = "zapi" | "meta_cloud" | "other";

export type WhatsappDirection = "inbound" | "outbound" | "status";

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

export type NormalizedWhatsappOutboundRequest = {
  provider: ProviderName;
  instanceId: string;
  phoneE164: string;
  messageType: "text" | "image" | "pdf";
  textBody?: string;
  mediaStoragePath?: string;
};

export type WhatsappSendResult = {
  ok: boolean;
  providerMessageId?: string;
  errorMessage?: string;
  rawResponseSanitized?: Record<string, unknown>;
};

export type WhatsappWebhookVerificationInput = {
  headers?: Headers | Record<string, string | undefined>;
  expectedSecret?: string | null;
  payload?: unknown;
};

export type WhatsappWebhookVerificationResult = {
  ok: boolean;
  errorMessage?: string;
};

export interface WhatsappProvider {
  name: ProviderName;
  verifyWebhook(input: WhatsappWebhookVerificationInput): WhatsappWebhookVerificationResult;
  normalizeInbound(payload: unknown): NormalizedWhatsappInbound;
  sendMessage(request: NormalizedWhatsappOutboundRequest): Promise<WhatsappSendResult>;
}
