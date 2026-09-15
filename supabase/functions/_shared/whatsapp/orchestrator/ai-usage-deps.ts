// Fix-Voice-Transcription-Gate — Composição/fábrica de
// deps.authorizeAudioTranscription e deps.recordAudioTranscriptionUsage
// ligadas aos executores reais (hasFullAccessVehicle em
// ../plan/ai-feature-access.ts e recordAiUsageDeno em
// ../ai-usage-tracking-deno.ts). Não reimplementa NENHUMA regra desses
// dois módulos — só compõe. Mesmo padrão de
// audio-transcription-deps.ts (createTranscribeAudioMessage).

import type { SupabaseLike } from "./repository.ts";
import { hasFullAccessVehicle } from "../plan/ai-feature-access.ts";
import {
  recordAiUsageDeno,
  type AiUsageTrackingDenoClient,
} from "../ai-usage-tracking-deno.ts";

export function createAuthorizeAudioTranscription(
  client: SupabaseLike,
): (userId: string) => Promise<boolean> {
  return async (userId: string): Promise<boolean> => {
    try {
      return await hasFullAccessVehicle(client, userId);
    } catch {
      // Fail-closed: qualquer exceção não prevista nunca autoriza.
      return false;
    }
  };
}

export function createRecordAudioTranscriptionUsage(
  client: SupabaseLike,
): (userId: string) => Promise<void> {
  const trackingClient = client as unknown as AiUsageTrackingDenoClient;
  return async (userId: string): Promise<void> => {
    await recordAiUsageDeno(trackingClient, userId, "audio_transcription");
  };
}
