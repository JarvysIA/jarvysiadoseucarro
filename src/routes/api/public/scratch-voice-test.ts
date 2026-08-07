// SONDAGEM TÉCNICA DESCARTÁVEL (scratch) — apagar depois.
// Rodada 2: TTS (fala em pt-BR) -> STT no mesmo gateway.
import { createFileRoute } from "@tanstack/react-router";

const TTS_ENDPOINT = "https://ai.gateway.lovable.dev/v1/audio/speech";
const STT_ENDPOINT = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const TTS_MODEL = "openai/gpt-4o-mini-tts";
const STT_MODEL = "openai/gpt-4o-mini-transcribe";
const PHRASE = "Troquei o óleo do carro por duzentos reais";

export const Route = createFileRoute("/api/public/scratch-voice-test")({
  server: {
    handlers: {
      GET: async () => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        const out: Record<string, unknown> = {
          phraseOriginal: PHRASE,
          ttsEndpoint: TTS_ENDPOINT,
          sttEndpoint: STT_ENDPOINT,
        };

        try {
          if (!apiKey) throw new Error("LOVABLE_API_KEY ausente");

          const ttsBody = {
            model: TTS_MODEL,
            input: PHRASE,
            voice: "alloy",
            response_format: "wav",
            instructions: "Fale em português do Brasil, tom natural e claro.",
          };
          const ttsResp = await fetch(TTS_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(ttsBody),
          });
          out["ttsStatus"] = ttsResp.status;
          out["ttsRequestBody"] = ttsBody;
          if (!ttsResp.ok) {
            out["ttsError"] = await ttsResp.text();
            return Response.json(out);
          }
          const audio = await ttsResp.arrayBuffer();
          out["ttsAudioBytes"] = audio.byteLength;

          const form = new FormData();
          form.append("model", STT_MODEL);
          form.append("file", new Blob([audio], { type: "audio/wav" }), "speech.wav");
          const sttResp = await fetch(STT_ENDPOINT, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
          });
          out["sttStatus"] = sttResp.status;
          const text = await sttResp.text();
          let raw: unknown;
          try {
            raw = JSON.parse(text);
          } catch {
            raw = text;
          }
          out["sttRawResponse"] = raw;
          out["transcript"] = (raw as { text?: string } | null)?.text ?? null;
        } catch (e) {
          out["error"] = e instanceof Error ? e.message : String(e);
        }

        return Response.json(out);
      },
    },
  },
});
