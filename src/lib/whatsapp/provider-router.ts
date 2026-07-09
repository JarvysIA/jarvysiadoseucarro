/**
 * Provider router (Build 5.3). Sem banco, sem env, sem API externa.
 */

import type {
  NormalizedWhatsappInbound,
  ProviderName,
  WhatsappProvider,
  WhatsappWebhookVerificationInput,
  WhatsappWebhookVerificationResult,
} from "./provider-types";
import { zapiProvider } from "./providers/zapi-provider";

export function getWhatsappProvider(provider: ProviderName): WhatsappProvider {
  if (provider === "zapi") return zapiProvider;
  throw new Error(`whatsapp provider not supported yet: ${provider}`);
}

export function normalizeInboundByProvider(
  provider: ProviderName,
  payload: unknown,
): NormalizedWhatsappInbound {
  return getWhatsappProvider(provider).normalizeInbound(payload);
}

export function verifyWebhookByProvider(
  provider: ProviderName,
  input: WhatsappWebhookVerificationInput,
): WhatsappWebhookVerificationResult {
  return getWhatsappProvider(provider).verifyWebhook(input);
}
