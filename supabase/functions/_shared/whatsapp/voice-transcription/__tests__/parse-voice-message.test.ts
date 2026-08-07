import { afterEach, describe, expect, mock, test } from "bun:test";
import { parseVoiceMessage } from "../parse-voice-message.ts";

const ORIGINAL_DENO = (globalThis as unknown as { Deno?: unknown }).Deno;
const ORIGINAL_FETCH = globalThis.fetch;

function setDenoEnv(vars: Record<string, string | undefined>): void {
  (globalThis as unknown as { Deno?: unknown }).Deno = {
    env: { get: (name: string) => vars[name] },
  };
}

afterEach(() => {
  (globalThis as unknown as { Deno?: unknown }).Deno = ORIGINAL_DENO;
  globalThis.fetch = ORIGINAL_FETCH;
});

const VALID_KEY = "test-lovable-key";
const SMALL_AUDIO = "AAAA";

function mockFetchResponse(status: number, body: unknown): void {
  globalThis.fetch = mock(async () =>
    typeof body === "string"
      ? new Response(body, { status })
      : new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe("parseVoiceMessage", () => {
  test("audioBase64 vazio → ok false, erro obrigatório, sem chamar fetch", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await parseVoiceMessage({ audioBase64: "" });

    expect(result).toEqual({ ok: false, error: "audioBase64 é obrigatório" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("audioBase64 maior que 12_000_000 caracteres → ok false, erro de tamanho, sem chamar fetch", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const huge = "a".repeat(12_000_001);
    const result = await parseVoiceMessage({ audioBase64: huge });

    expect(result).toEqual({ ok: false, error: "Áudio muito grande (máx ~9MB)." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("LOVABLE_API_KEY ausente do ambiente Deno → ok false, erro claro, sem chamar fetch", async () => {
    setDenoEnv({});
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await parseVoiceMessage({ audioBase64: SMALL_AUDIO });

    expect(result).toEqual({
      ok: false,
      error: "LOVABLE_API_KEY não configurada no ambiente Deno.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("audioBase64 com caracteres inválidos de base64 → ok false, erro de decodificação, sem chamar fetch", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await parseVoiceMessage({ audioBase64: "not-valid-base64!!!" });

    expect(result).toEqual({ ok: false, error: "audioBase64 inválido (não decodifica)." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetch 200 com texto transcrito → ok true, transcript igual ao texto (trimmed)", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, {
      text: "Troquei o óleo por duzentos reais",
      usage: { seconds: 4 },
    });

    const result = await parseVoiceMessage({ audioBase64: SMALL_AUDIO });

    expect(result).toEqual({ ok: true, transcript: "Troquei o óleo por duzentos reais" });
  });

  test("fetch 200 com text vazio → ok false, erro de fala não identificada", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, { text: "", usage: {} });

    const result = await parseVoiceMessage({ audioBase64: SMALL_AUDIO });

    expect(result).toEqual({
      ok: false,
      error: "Não consegui identificar fala no áudio. Tente gravar de novo.",
    });
  });

  test("fetch 200 com text só espaços → mesmo tratamento (trim antes de checar vazio)", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, { text: "   ", usage: {} });

    const result = await parseVoiceMessage({ audioBase64: SMALL_AUDIO });

    expect(result).toEqual({
      ok: false,
      error: "Não consegui identificar fala no áudio. Tente gravar de novo.",
    });
  });

  test("fetch 429 → ok false, erro de rate limit", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(429, "rate limited");

    const result = await parseVoiceMessage({ audioBase64: SMALL_AUDIO });

    expect(result).toEqual({
      ok: false,
      error: "Muitas requisições. Tente novamente em alguns segundos.",
    });
  });

  test("fetch 402 → ok false, erro de créditos esgotados", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(402, "payment required");

    const result = await parseVoiceMessage({ audioBase64: SMALL_AUDIO });

    expect(result).toEqual({
      ok: false,
      error: "Créditos de IA esgotados. Adicione créditos na workspace.",
    });
  });

  test("fetch 200 com corpo que não é JSON válido → ok false, erro de resposta inválida, sem lançar exceção", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, "isto não é um JSON, é só um texto solto.");

    const result = await parseVoiceMessage({ audioBase64: SMALL_AUDIO });

    expect(result).toEqual({
      ok: false,
      error: "Resposta inválida do serviço de transcrição.",
    });
  });

  test("body enviado é FormData, sem Content-Type manual nos headers", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(
      async () => new Response(JSON.stringify({ text: "ok", usage: {} }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await parseVoiceMessage({ audioBase64: SMALL_AUDIO });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe("https://ai.gateway.lovable.dev/v1/audio/transcriptions");
    expect(init.body).toBeInstanceOf(FormData);
    const headers = init.headers as Record<string, string> | undefined;
    expect(headers && "Content-Type" in headers).toBe(false);
    expect(headers && "content-type" in headers).toBe(false);
  });
});
