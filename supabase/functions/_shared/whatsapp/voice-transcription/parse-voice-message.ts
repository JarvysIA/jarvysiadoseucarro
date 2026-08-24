// Transcrição de mensagem de voz via IA (Lovable AI Gateway), espelhando
// o padrão de receipt-ocr/parse-receipt.ts (Build OCR-1). Endpoint,
// formato multipart e formato de resposta confirmados por teste real
// (não suposição) — ver PASSO 1 do Build VOICE-1. Função isolada: sem
// Supabase, sem gate comercial, sem integração com WhatsApp — recebe
// áudio em base64 já pronto, devolve texto transcrito.

export type ParseVoiceInput = {
  audioBase64: string;
  mimeType?: string;
};

export type ParseVoiceResult = { ok: true; transcript: string } | { ok: false; error: string };

const MAX_AUDIO_BASE64_CHARS = 12_000_000;
const TRANSCRIPTION_ENDPOINT = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const TRANSCRIPTION_MODEL = "openai/gpt-4o-mini-transcribe";

// Leitura de Deno.env via globalThis (mesmo padrão de actions/deps.ts,
// actions/expense-deps.ts e receipt-ocr/parse-receipt.ts) — evita
// ReferenceError ao importar este módulo fora do Deno (ex: bun test).
type DenoEnvLike = { get(name: string): string | undefined };
type DenoGlobalLike = { env?: DenoEnvLike };

function readDenoEnv(name: string): string | undefined {
  const denoGlobal = (globalThis as unknown as { Deno?: DenoGlobalLike }).Deno;
  return denoGlobal?.env?.get(name);
}

export async function parseVoiceMessage(input: ParseVoiceInput): Promise<ParseVoiceResult> {
  if (!input?.audioBase64 || typeof input.audioBase64 !== "string") {
    return { ok: false, error: "audioBase64 é obrigatório" };
  }
  if (input.audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    return { ok: false, error: "Áudio muito grande (máx ~9MB)." };
  }

  const apiKey = readDenoEnv("LOVABLE_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "LOVABLE_API_KEY não configurada no ambiente Deno." };
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(input.audioBase64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } catch (e) {
    return { ok: false, error: "audioBase64 inválido (não decodifica)." };
  }

  try {
    const formData = new FormData();
    formData.append("model", TRANSCRIPTION_MODEL);
    const audioBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(audioBuffer).set(bytes);
    formData.append(
      "file",
      new Blob([audioBuffer], { type: input.mimeType || "audio/ogg" }),
      "voice.ogg",
    );

    const resp = await fetch(TRANSCRIPTION_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 429) {
        return { ok: false, error: "Muitas requisições. Tente novamente em alguns segundos." };
      }
      if (resp.status === 402) {
        return { ok: false, error: "Créditos de IA esgotados. Adicione créditos na workspace." };
      }
      console.error("[parse-voice-message] gateway error:", resp.status, text);
      return { ok: false, error: "Falha ao chamar o serviço de transcrição." };
    }

    let json: unknown;
    try {
      json = await resp.json();
    } catch (e) {
      return { ok: false, error: "Resposta inválida do serviço de transcrição." };
    }

    const text = (json as { text?: unknown } | null)?.text;
    if (typeof text !== "string") {
      return { ok: false, error: "Resposta inválida do serviço de transcrição." };
    }

    const trimmed = text.trim();
    if (trimmed === "") {
      return {
        ok: false,
        error: "Não consegui identificar fala no áudio. Tente gravar de novo.",
      };
    }

    return { ok: true, transcript: trimmed };
  } catch (e) {
    console.error("[parse-voice-message] exception:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Erro desconhecido." };
  }
}
