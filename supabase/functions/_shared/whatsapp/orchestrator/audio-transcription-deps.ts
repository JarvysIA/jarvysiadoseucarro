// WIRE-4 — Composição/fábrica de deps.transcribeAudioMessage ligada aos
// executores reais: baixa a mídia (WIRE-3, download-media.ts) e transcreve
// (voice-transcription/parse-voice-message.ts). Não reimplementa NENHUMA
// regra desses dois módulos — só compõe.
//
// Backend-only. NÃO é chamada por nenhum worker/edge function ainda — isso
// é WIRE-5 (createTranscribeAudioMessage(client) será instanciada com um
// client real e passada como deps.transcribeAudioMessage pro
// runWhatsappOrchestratorTestCycle).

import type { SupabaseLike } from "./repository.ts";
import { downloadWhatsappMedia } from "../voice-transcription/download-media.ts";
import { parseVoiceMessage } from "../voice-transcription/parse-voice-message.ts";
import type { TranscribeAudioResult } from "./test-service.ts";

// Mesmo espírito de PERMANENT_FAILURE_ERRORS em
// conversation-handoff/dr-jarvys-adapter.ts: allowlist fechada de erros de
// validação de entrada / conteúdo (não adianta tentar de novo). Qualquer
// outro erro de parseVoiceMessage (chave ausente, rate limit, créditos,
// gateway, resposta inválida, ou qualquer mensagem não reconhecida) é
// transient_error por padrão — nunca tratado como permanente por engano.
const PERMANENT_TRANSCRIPTION_ERRORS: ReadonlySet<string> = new Set([
  "audioBase64 é obrigatório",
  "Áudio muito grande (máx ~9MB).",
  "audioBase64 inválido (não decodifica).",
  "Não consegui identificar fala no áudio. Tente gravar de novo.",
]);

// download-media.ts já devolve erros categorizados (nunca texto bruto de
// exceção) — só reclassificamos categoria em transient/permanent aqui.
function classifyDownloadError(error: string): "transient_error" | "permanent_error" {
  if (error === "invalid_media_url" || error === "media_too_large") {
    return "permanent_error";
  }
  const statusMatch = /^download_failed_status_(\d{3})$/.exec(error);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status >= 400 && status < 500) return "permanent_error";
    return "transient_error"; // 5xx e qualquer outra faixa: assume transitório
  }
  // "download_failed" (rede/timeout/decodificação) e qualquer categoria
  // não reconhecida: assume transitório (fail-safe — melhor tentar de novo).
  return "transient_error";
}

export function createTranscribeAudioMessage(
  client: SupabaseLike,
): (messageId: string) => Promise<TranscribeAudioResult> {
  return async (messageId: string): Promise<TranscribeAudioResult> => {
    try {
      if (!client.from) {
        throw new Error("client_missing_from");
      }

      const res = await client
        .from("whatsapp_messages")
        .select("media_url, media_mime_type")
        .eq("id", messageId)
        .maybeSingle();

      if (res.error) {
        // Busca falhou de forma estruturada (não é exceção não prevista) —
        // trata como mensagem malformada/inacessível, não adianta reexecutar.
        return { kind: "permanent_error", reason: "message_lookup_failed" };
      }

      const row = res.data;
      const mediaUrl = row && typeof row.media_url === "string" ? row.media_url : null;
      if (!mediaUrl) {
        return { kind: "permanent_error", reason: "media_url_missing" };
      }
      const mediaMimeType =
        row && typeof row.media_mime_type === "string" ? row.media_mime_type : undefined;

      const downloadResult = await downloadWhatsappMedia(mediaUrl);
      if (!downloadResult.ok) {
        return {
          kind: classifyDownloadError(downloadResult.error),
          reason: downloadResult.error,
        };
      }

      const transcription = await parseVoiceMessage({
        audioBase64: downloadResult.base64,
        mimeType: mediaMimeType,
      });
      if (!transcription.ok) {
        const kind = PERMANENT_TRANSCRIPTION_ERRORS.has(transcription.error)
          ? "permanent_error"
          : "transient_error";
        return { kind, reason: transcription.error };
      }

      return { kind: "ok", text: transcription.transcript };
    } catch {
      // Qualquer exceção não prevista (rede na busca do client, erro
      // inesperado em qualquer etapa): nunca lança, sempre transient_error —
      // fail-safe: melhor tentar de novo do que descartar a mensagem.
      return { kind: "transient_error", reason: "unexpected_error" };
    }
  };
}
