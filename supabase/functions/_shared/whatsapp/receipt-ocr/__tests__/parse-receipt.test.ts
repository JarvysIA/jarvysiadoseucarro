import { afterEach, describe, expect, mock, test } from "bun:test";
import { parseReceiptImage } from "../parse-receipt.ts";

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
const SMALL_IMAGE = "aGVsbG8=";

function mockFetchResponse(status: number, body: unknown): void {
  globalThis.fetch = mock(async () =>
    typeof body === "string"
      ? new Response(body, { status })
      : new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe("parseReceiptImage", () => {
  test("imageBase64 vazio → ok false, erro obrigatório, sem chamar fetch", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await parseReceiptImage({ imageBase64: "" });

    expect(result).toEqual({ ok: false, error: "imageBase64 é obrigatório" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("imageBase64 maior que 12_000_000 caracteres → ok false, erro de tamanho, sem chamar fetch", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const huge = "a".repeat(12_000_001);
    const result = await parseReceiptImage({ imageBase64: huge });

    expect(result).toEqual({ ok: false, error: "Imagem muito grande (máx ~9MB)." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("LOVABLE_API_KEY ausente do ambiente Deno → ok false, erro claro, sem chamar fetch", async () => {
    setDenoEnv({});
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await parseReceiptImage({ imageBase64: SMALL_IMAGE });

    expect(result).toEqual({
      ok: false,
      error: "LOVABLE_API_KEY não configurada no ambiente Deno.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetch 200 com JSON válido (2 itens, categoria Revisão) → ok true, receipt normalizado", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const payload = {
      data_servico: "2026-08-01",
      km_registrada: 45000,
      valor_total: 350.5,
      categoria: "Revisão",
      itens_identificados: [
        { descricao: "Óleo 5W30", categoria: "oleo", valor: 200 },
        { descricao: "Filtro de óleo", categoria: "filtros", valor: 150.5 },
      ],
    };
    mockFetchResponse(200, {
      choices: [{ message: { content: JSON.stringify(payload) } }],
    });

    const result = await parseReceiptImage({ imageBase64: SMALL_IMAGE });

    expect(result).toEqual({
      ok: true,
      receipt: {
        data_servico: "2026-08-01",
        km_registrada: 45000,
        valor_total: 350.5,
        categoria: "Revisão",
        itens_identificados: [
          { descricao: "Óleo 5W30", categoria: "oleo", valor: 200 },
          { descricao: "Filtro de óleo", categoria: "filtros", valor: 150.5 },
        ],
      },
    });
  });

  test("fetch 429 → ok false, erro de rate limit", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(429, "rate limited");

    const result = await parseReceiptImage({ imageBase64: SMALL_IMAGE });

    expect(result).toEqual({
      ok: false,
      error: "Muitas requisições. Tente novamente em alguns segundos.",
    });
  });

  test("fetch 402 → ok false, erro de créditos esgotados", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(402, "payment required");

    const result = await parseReceiptImage({ imageBase64: SMALL_IMAGE });

    expect(result).toEqual({
      ok: false,
      error: "Créditos de IA esgotados. Adicione créditos na workspace.",
    });
  });

  test("fetch 200 com conteúdo que não é JSON válido → ok false, erro de JSON inválido, sem lançar exceção", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, {
      choices: [{ message: { content: "isto não é um JSON, é só um texto solto." } }],
    });

    const result = await parseReceiptImage({ imageBase64: SMALL_IMAGE });

    expect(result).toEqual({
      ok: false,
      error: "A IA não retornou um JSON válido. Tente outra foto.",
    });
  });

  test("categoria fora das 8 válidas (ex: Lixo) → normaliza para Manutenção", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const payload = {
      data_servico: null,
      km_registrada: null,
      valor_total: 100,
      categoria: "Lixo",
      itens_identificados: [],
    };
    mockFetchResponse(200, {
      choices: [{ message: { content: JSON.stringify(payload) } }],
    });

    const result = await parseReceiptImage({ imageBase64: SMALL_IMAGE });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.categoria).toBe("Manutenção");
    }
  });

  test("item de itens_identificados com categoria inválida (ex: roda) → normaliza para outro", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const payload = {
      data_servico: null,
      km_registrada: null,
      valor_total: 80,
      categoria: "Manutenção",
      itens_identificados: [{ descricao: "Roda liga leve", categoria: "roda", valor: 80 }],
    };
    mockFetchResponse(200, {
      choices: [{ message: { content: JSON.stringify(payload) } }],
    });

    const result = await parseReceiptImage({ imageBase64: SMALL_IMAGE });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.itens_identificados).toEqual([
        { descricao: "Roda liga leve", categoria: "outro", valor: 80 },
      ]);
    }
  });
});
