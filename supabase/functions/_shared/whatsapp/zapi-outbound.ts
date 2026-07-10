// Adapter Z-API outbound (Build 5.6B).
// Envia texto real pela Z-API. NÃO loga URL final, token, body ou telefone completo.
// Contrato provider-agnostic: apenas monta request, chama API e normaliza resposta.

export type ZapiSendTextInput = {
  apiBaseUrl: string;
  instanceId: string;
  instanceToken: string;
  clientToken: string;
  phoneE164: string;
  textBody: string;
  timeoutMs?: number;
  clientReference?: string | null;
};

export type ZapiSendTextResult = {
  ok: boolean;
  providerMessageId?: string;
  statusCode?: number;
  retryable: boolean;
  errorCode?: string;
  errorMessage?: string;
  timeoutAmbiguous?: boolean;
};

const DEFAULT_TIMEOUT_MS = 8000;

// Extrai origem (protocolo + host) do valor cadastrado em ZAPI_API_URL,
// para nunca concatenar caminhos cegos caso o operador tenha colado a URL completa.
function extractOrigin(base: string): string | null {
  try {
    const u = new URL(base.trim());
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// Z-API espera telefone só com dígitos (código do país + DDD + número).
function phoneForZapi(e164: string): string {
  return e164.replace(/\D+/g, "");
}

function pickProviderMessageId(body: unknown): string | null {
  if (body == null || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const candidates = ["messageId", "zaapId", "id", "messageID", "message_id"];
  for (const k of candidates) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

export async function sendZapiText(input: ZapiSendTextInput): Promise<ZapiSendTextResult> {
  const origin = extractOrigin(input.apiBaseUrl);
  if (!origin) {
    return {
      ok: false,
      retryable: false,
      errorCode: "invalid_api_base_url",
      errorMessage: "ZAPI_API_URL inválida",
    };
  }

  if (!input.instanceId || !input.instanceToken || !input.clientToken) {
    return {
      ok: false,
      retryable: false,
      errorCode: "invalid_credentials",
      errorMessage: "missing_instance_or_token",
    };
  }

  const url = `${origin}/instances/${encodeURIComponent(input.instanceId)}/token/${encodeURIComponent(input.instanceToken)}/send-text`;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const body: Record<string, unknown> = {
    phone: phoneForZapi(input.phoneE164),
    message: input.textBody,
  };
  if (input.clientReference) body.clientMessageId = input.clientReference;

  let requestSent = false;
  try {
    requestSent = true;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": input.clientToken,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const statusCode = res.status;
    let parsed: unknown = null;
    try {
      const raw = await res.text();
      if (raw && raw.trim() !== "") parsed = JSON.parse(raw);
    } catch {
      // resposta não-JSON
    }

    if (statusCode >= 200 && statusCode < 300) {
      const pid = pickProviderMessageId(parsed);
      return {
        ok: true,
        providerMessageId: pid ?? undefined,
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 400) {
      return { ok: false, statusCode, retryable: false, errorCode: "invalid_payload" };
    }
    if (statusCode === 401 || statusCode === 403) {
      return { ok: false, statusCode, retryable: false, errorCode: "invalid_credentials" };
    }
    if (statusCode === 404) {
      return { ok: false, statusCode, retryable: false, errorCode: "instance_not_found" };
    }
    if (statusCode === 408) {
      return { ok: false, statusCode, retryable: true, errorCode: "timeout" };
    }
    if (statusCode === 429) {
      return { ok: false, statusCode, retryable: true, errorCode: "rate_limited" };
    }
    if (statusCode >= 500) {
      return { ok: false, statusCode, retryable: true, errorCode: "provider_unavailable" };
    }
    return {
      ok: false,
      statusCode,
      retryable: false,
      errorCode: "unexpected_status",
    };
  } catch (err) {
    const isAbort =
      err instanceof DOMException
        ? err.name === "AbortError"
        : (err as { name?: string } | null)?.name === "AbortError";
    if (isAbort && requestSent) {
      return {
        ok: false,
        retryable: false,
        timeoutAmbiguous: true,
        errorCode: "timeout_ambiguous",
        errorMessage: "timeout_ambiguous_manual_review",
      };
    }
    return {
      ok: false,
      retryable: true,
      errorCode: "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}
