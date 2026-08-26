// Build WIRE-3 — Helper de download de mídia da Z-API (audio), devolvendo
// base64 pronto pro formato esperado por parseVoiceMessage ({ audioBase64 }).
// Módulo isolado: sem Supabase, sem integração com WhatsApp
// orchestrator/routing/test-service — só baixa um mediaUrl e converte pra
// base64. Integração com o restante do pipeline é WIRE-4, build separado.
//
// Hipótese de design (NÃO confirmada, ver nota abaixo): a documentação
// oficial da Z-API (developer.z-api.io) não menciona nenhum header de
// autenticação necessário pra baixar o conteúdo de audioUrl — diferente dos
// endpoints de gerenciamento (que exigem instance/token no path). Por isso
// esta função NÃO envia nenhum header de autenticação "por garantia".
//
// Ponto de extensão futuro: se um teste real (WIRE-6, mensagem de áudio
// real chegando por uma instância com plano ativo) revelar que a Z-API
// exige algo que não estamos mandando, o erro aparece aqui como
// download_failed_status_401/403 — é aí que se adicionaria o header que a
// Z-API exigir, uma vez confirmado (não antes, por especulação).

export type DownloadMediaResult = { ok: true; base64: string } | { ok: false; error: string };

export type DownloadMediaOptions = {
  maxBytes?: number;
  timeoutMs?: number;
};

const DEFAULT_MAX_BYTES = 15_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const BASE64_CHUNK_SIZE = 8192;

// Mesmo espírito de composeSignal em orchestrator/repository.ts: timeout
// real via AbortController, cleanup garantido no finally do caller.
function composeDownloadSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(t),
  };
}

// String.fromCharCode(...new Uint8Array(buffer)) estoura call stack em
// arquivos maiores (spread de array grande como argumentos). Processa em
// blocos pequenos, concatenando, só então btoa no final.
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function downloadWhatsappMedia(
  mediaUrl: string,
  options: DownloadMediaOptions = {},
): Promise<DownloadMediaResult> {
  if (typeof mediaUrl !== "string" || mediaUrl.length === 0 || !mediaUrl.startsWith("https://")) {
    return { ok: false, error: "invalid_media_url" };
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, cleanup } = composeDownloadSignal(timeoutMs);

  try {
    const response = await fetch(mediaUrl, { signal });

    if (!response.ok) {
      // Nunca logar a mediaUrl completa (pode conter token/assinatura) —
      // só o status, que já basta pra diagnosticar (ver nota de header no
      // topo do arquivo se vier a ser 401/403).
      return { ok: false, error: `download_failed_status_${response.status}` };
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const declaredLength = Number(contentLengthHeader);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        return { ok: false, error: "media_too_large" };
      }
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > maxBytes) {
      return { ok: false, error: "media_too_large" };
    }

    return { ok: true, base64: arrayBufferToBase64(buffer) };
  } catch {
    // Categoria genérica de propósito — nunca vazamos a mensagem bruta da
    // exceção (pode conter a mediaUrl, ex: alguns runtimes embutem a URL
    // em erros de rede) nem lançamos pro caller.
    console.error("[download-media] falha inesperada ao baixar/decodificar mídia");
    return { ok: false, error: "download_failed" };
  } finally {
    cleanup();
  }
}
