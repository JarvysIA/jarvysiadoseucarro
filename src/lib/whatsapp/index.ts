/**
 * Barrel export da camada WhatsApp provider-agnostic (Build 5.3).
 */
export type {
  NormalizedWhatsappInbound,
  NormalizedWhatsappOutboundRequest,
  ProviderName,
  WhatsappDirection,
  WhatsappMessageType,
  WhatsappProvider,
  WhatsappSendResult,
  WhatsappWebhookVerificationInput,
  WhatsappWebhookVerificationResult,
} from "./provider-types";
export { isLikelyE164, normalizeBrazilPhoneToE164 } from "./phone";
export { maskPhone, sanitizeWhatsappPayload } from "./sanitize";
export {
  getWhatsappProvider,
  normalizeInboundByProvider,
  verifyWebhookByProvider,
} from "./provider-router";
export { zapiProvider } from "./providers/zapi-provider";
