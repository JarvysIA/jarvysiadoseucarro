// SONDAGEM TÉCNICA DESCARTÁVEL (scratch) — apagar depois.
// Não está ligada ao WhatsApp nem ao fluxo de despesas.
import { createFileRoute } from "@tanstack/react-router";

const ENDPOINT = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const MODEL = "openai/gpt-4o-mini-transcribe";

function makeBeepWav(seconds = 2.5, sampleRate = 16000, freq = 440): Uint8Array {
  const n = Math.floor(seconds * sampleRate);
  const dataBytes = n * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const dv = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  w(8, "WAVE");
  w(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  w(36, "data");
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.3 * 32767;
    dv.setInt16(44 + i * 2, v, true);
  }
  return new Uint8Array(buf);
}

export const Route = createFileRoute("/api/public/scratch-voice-test")({
  server: {
    handlers: {
      GET: async () => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        const wav = makeBeepWav();

        const form = new FormData();
        form.append("model", MODEL);
        form.append("file", new Blob([wav], { type: "audio/wav" }), "recording.wav");

        const requestShape = {
          method: "POST",
          url: ENDPOINT,
          headers: {
            Authorization: "Bearer ${LOVABLE_API_KEY}",
            "Content-Type": "multipart/form-data (boundary gerado pelo fetch)",
          },
          bodyType: "multipart/form-data",
          parts: {
            model: MODEL,
            file: `recording.wav (audio/wav, ${wav.byteLength} bytes, beep 440Hz 2.5s, 16kHz mono 16-bit PCM)`,
          },
          note: "sem campo stream → resposta JSON buffered",
        };

        let httpStatus = 0;
        let rawResponse: unknown = null;
        let transcript: string | null = null;
        let error: string | null = null;

        try {
          if (!apiKey) throw new Error("LOVABLE_API_KEY ausente no ambiente");
          const resp = await fetch(ENDPOINT, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
          });
          httpStatus = resp.status;
          const text = await resp.text();
          try {
            rawResponse = JSON.parse(text);
          } catch {
            rawResponse = text;
          }
          transcript = (rawResponse as { text?: string } | null)?.text ?? null;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }

        return Response.json({
          endpoint: ENDPOINT,
          requestShape,
          httpStatus,
          rawResponse,
          transcript,
          error,
        });
      },
    },
  },
});
