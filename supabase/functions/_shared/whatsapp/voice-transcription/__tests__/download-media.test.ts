import { afterEach, describe, expect, mock, test } from "bun:test";
import { downloadWhatsappMedia } from "../download-media.ts";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_ERROR = console.error;
const ORIGINAL_CONSOLE_LOG = console.log;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  console.error = ORIGINAL_CONSOLE_ERROR;
  console.log = ORIGINAL_CONSOLE_LOG;
});

const SECRET_URL = "https://media.z-api.io/v1/download?token=SUPER_SECRET_TOKEN_ABC123";

function mockFetchOnce(impl: (input: unknown, init?: RequestInit) => Promise<Response>): ReturnType<typeof mock> {
  const fetchMock = mock(impl);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function bytesOf(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

describe("downloadWhatsappMedia", () => {
  // 1. Sucesso
  test("fetch 200 com corpo pequeno → ok true, base64 decodifica de volta pros mesmos bytes", async () => {
    const original = bytesOf([1, 2, 3, 4, 5, 250, 251, 252, 253, 0, 255]);
    mockFetchOnce(async () => new Response(original.buffer, { status: 200 }));

    const result = await downloadWhatsappMedia("https://example.invalid/audio.ogg");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const decoded = base64ToBytes(result.base64);
      expect(Array.from(decoded)).toEqual(Array.from(original));
    }
  });

  // 2. mediaUrl inválida
  test("mediaUrl vazia → invalid_media_url, fetch nunca chamado", async () => {
    const fetchMock = mockFetchOnce(async () => {
      throw new Error("fetch não deveria ser chamado");
    });

    const result = await downloadWhatsappMedia("");

    expect(result).toEqual({ ok: false, error: "invalid_media_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("mediaUrl null → invalid_media_url, fetch nunca chamado", async () => {
    const fetchMock = mockFetchOnce(async () => {
      throw new Error("fetch não deveria ser chamado");
    });

    const result = await downloadWhatsappMedia(null as unknown as string);

    expect(result).toEqual({ ok: false, error: "invalid_media_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("mediaUrl não-https (http://) → invalid_media_url, fetch nunca chamado", async () => {
    const fetchMock = mockFetchOnce(async () => {
      throw new Error("fetch não deveria ser chamado");
    });

    const result = await downloadWhatsappMedia("http://example.invalid/audio.ogg");

    expect(result).toEqual({ ok: false, error: "invalid_media_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("mediaUrl sem protocolo → invalid_media_url, fetch nunca chamado", async () => {
    const fetchMock = mockFetchOnce(async () => {
      throw new Error("fetch não deveria ser chamado");
    });

    const result = await downloadWhatsappMedia("example.invalid/audio.ogg");

    expect(result).toEqual({ ok: false, error: "invalid_media_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 3. Status HTTP de erro
  test("fetch 404 → download_failed_status_404, sem lançar", async () => {
    mockFetchOnce(async () => new Response("not found", { status: 404 }));

    const result = await downloadWhatsappMedia("https://example.invalid/audio.ogg");

    expect(result).toEqual({ ok: false, error: "download_failed_status_404" });
  });

  test("fetch 401 → download_failed_status_401, sem lançar", async () => {
    mockFetchOnce(async () => new Response("unauthorized", { status: 401 }));

    const result = await downloadWhatsappMedia("https://example.invalid/audio.ogg");

    expect(result).toEqual({ ok: false, error: "download_failed_status_401" });
  });

  test("fetch 500 → download_failed_status_500, sem lançar", async () => {
    mockFetchOnce(async () => new Response("server error", { status: 500 }));

    const result = await downloadWhatsappMedia("https://example.invalid/audio.ogg");

    expect(result).toEqual({ ok: false, error: "download_failed_status_500" });
  });

  // 4. Corpo maior que maxBytes
  test("Content-Length declarado maior que maxBytes → media_too_large", async () => {
    const small = bytesOf([1, 2, 3]);
    mockFetchOnce(
      async () =>
        new Response(small.buffer, {
          status: 200,
          headers: { "content-length": "999999999" },
        }),
    );

    const result = await downloadWhatsappMedia("https://example.invalid/audio.ogg", {
      maxBytes: 1000,
    });

    expect(result).toEqual({ ok: false, error: "media_too_large" });
  });

  test("corpo real maior que maxBytes (sem Content-Length confiável) → media_too_large", async () => {
    const big = new Uint8Array(2000).fill(7);
    mockFetchOnce(async () => new Response(big.buffer, { status: 200 }));

    const result = await downloadWhatsappMedia("https://example.invalid/audio.ogg", {
      maxBytes: 1000,
    });

    expect(result).toEqual({ ok: false, error: "media_too_large" });
  });

  // 5. fetch rejeita (exceção de rede)
  test("fetch rejeita com erro de rede → capturado, ok false, nunca lança", async () => {
    mockFetchOnce(async () => {
      throw new TypeError("network error");
    });

    const result = await downloadWhatsappMedia("https://example.invalid/audio.ogg");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  // 6. Timeout — nunca trava o teste
  test("timeout (fetch nunca resolve) → ok false rápido, respeitando o AbortSignal", async () => {
    mockFetchOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }
        }),
    );

    const started = Date.now();
    const result = await downloadWhatsappMedia("https://example.invalid/audio.ogg", {
      timeoutMs: 50,
    });
    const elapsedMs = Date.now() - started;

    expect(result.ok).toBe(false);
    expect(elapsedMs).toBeLessThan(2000);
  });

  // 7. Determinismo
  test("mesma entrada, mesmo resultado", async () => {
    const original = bytesOf([9, 8, 7, 6, 5]);
    mockFetchOnce(async () => new Response(original.buffer, { status: 200 }));

    const r1 = await downloadWhatsappMedia("https://example.invalid/audio.ogg");

    mockFetchOnce(async () => new Response(original.buffer, { status: 200 }));
    const r2 = await downloadWhatsappMedia("https://example.invalid/audio.ogg");

    expect(r1).toEqual(r2);
  });

  // 8. Segurança estática/comportamental: nunca loga a URL completa nem o base64
  test("nenhum console.log/console.error inclui a mediaUrl completa ou o base64 resultante", async () => {
    const captured: string[] = [];
    console.error = ((...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(" "));
    }) as typeof console.error;
    console.log = ((...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(" "));
    }) as typeof console.log;

    // Caminho de erro (status): dispara o log de exceção genérica não, mas
    // exercita o branch de status para garantir que a URL não vaza aqui.
    mockFetchOnce(async () => new Response("forbidden", { status: 403 }));
    await downloadWhatsappMedia(SECRET_URL);

    // Caminho de exceção genérica: dispara o console.error interno.
    mockFetchOnce(async () => {
      throw new Error(`network failure while fetching ${SECRET_URL}`);
    });
    await downloadWhatsappMedia(SECRET_URL);

    // Caminho de sucesso: garante que o base64 resultante também não vaza.
    const original = bytesOf([1, 2, 3, 4]);
    mockFetchOnce(async () => new Response(original.buffer, { status: 200 }));
    const successResult = await downloadWhatsappMedia(SECRET_URL);
    expect(successResult.ok).toBe(true);
    const leakedBase64 = successResult.ok ? successResult.base64 : "__never__";

    for (const line of captured) {
      expect(line.includes(SECRET_URL)).toBe(false);
      expect(line.includes("SUPER_SECRET_TOKEN_ABC123")).toBe(false);
      expect(line.includes(leakedBase64)).toBe(false);
    }
  });
});
