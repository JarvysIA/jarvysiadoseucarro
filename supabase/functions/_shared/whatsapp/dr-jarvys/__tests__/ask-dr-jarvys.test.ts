import { afterEach, describe, expect, mock, test } from "bun:test";
import { askDrJarvys } from "../ask-dr-jarvys.ts";

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

function mockFetchResponse(status: number, body: unknown): ReturnType<typeof mock> {
  const fetchMock = mock(async () =>
    typeof body === "string"
      ? new Response(body, { status })
      : new Response(JSON.stringify(body), { status }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("askDrJarvys", () => {
  test("userText vazio → ok false, erro obrigatório, sem chamar fetch", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await askDrJarvys({ userText: "" });

    expect(result).toEqual({ ok: false, error: "userText é obrigatório" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("userText maior que 4000 caracteres → ok false, erro de tamanho, sem chamar fetch", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const huge = "a".repeat(4001);
    const result = await askDrJarvys({ userText: huge });

    expect(result).toEqual({ ok: false, error: "Mensagem muito longa." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("LOVABLE_API_KEY ausente do ambiente Deno → ok false, sem chamar fetch", async () => {
    setDenoEnv({});
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await askDrJarvys({ userText: "Meu carro está fazendo barulho" });

    expect(result).toEqual({
      ok: false,
      error: "LOVABLE_API_KEY não configurada no ambiente Deno.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetch 200, inScope true → ok true, inScope true, response igual ao texto", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              inScope: true,
              response: "Troca de óleo a cada 10 mil km é o padrão pra maioria dos motores.",
            }),
          },
        },
      ],
    });

    const result = await askDrJarvys({ userText: "de quanto em quanto tempo troco o óleo?" });

    expect(result).toEqual({
      ok: true,
      inScope: true,
      response: "Troca de óleo a cada 10 mil km é o padrão pra maioria dos motores.",
    });
  });

  test("fetch 200, inScope false, response null → ok true, inScope false, sem campo response", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, {
      choices: [{ message: { content: JSON.stringify({ inScope: false, response: null }) } }],
    });

    const result = await askDrJarvys({ userText: "qual a previsão do tempo amanhã?" });

    expect(result).toEqual({ ok: true, inScope: false });
    expect("response" in result).toBe(false);
  });

  test("fetch 200, inScope false, response preenchido por engano → texto descartado, mesmo resultado", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              inScope: false,
              response: "algo que a IA escreveu por engano",
            }),
          },
        },
      ],
    });

    const result = await askDrJarvys({ userText: "quem ganhou o jogo ontem?" });

    expect(result).toEqual({ ok: true, inScope: false });
    expect("response" in result).toBe(false);
  });

  test("contexto de veículo fornecido → mensagem enviada inclui os dados do veículo", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mockFetchResponse(200, {
      choices: [
        { message: { content: JSON.stringify({ inScope: true, response: "Depende do uso." }) } },
      ],
    });

    await askDrJarvys({
      userText: "quando devo trocar a correia?",
      vehicleContext: { brand: "Fiat", model: "Argo", year: 2022 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = body.messages.find((m) => m.role === "user");
    expect(userMessage?.content).toContain("Fiat");
    expect(userMessage?.content).toContain("Argo");
    expect(userMessage?.content).toContain("2022");
  });

  test("fetch 429 → ok false, erro de rate limit", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(429, "rate limited");

    const result = await askDrJarvys({ userText: "meu carro não liga" });

    expect(result).toEqual({
      ok: false,
      error: "Muitas requisições. Tente novamente em alguns segundos.",
    });
  });

  test("fetch 402 → ok false, erro de créditos esgotados", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(402, "payment required");

    const result = await askDrJarvys({ userText: "meu carro não liga" });

    expect(result).toEqual({
      ok: false,
      error: "Créditos de IA esgotados. Adicione créditos na workspace.",
    });
  });

  test("fetch 200 mas o conteúdo retornado pela IA não é JSON válido → ok false, erro de resposta inválida", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, {
      choices: [{ message: { content: "isto não é um JSON, é só um texto solto." } }],
    });

    const result = await askDrJarvys({ userText: "meu carro não liga" });

    expect(result).toEqual({ ok: false, error: "Resposta inválida do Dr. Jarvys." });
  });

  test("fetch 200 com JSON válido mas sem campo inScope → ok false, erro de resposta inválida", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, {
      choices: [{ message: { content: JSON.stringify({ response: "texto qualquer" }) } }],
    });

    const result = await askDrJarvys({ userText: "meu carro não liga" });

    expect(result).toEqual({ ok: false, error: "Resposta inválida do Dr. Jarvys." });
  });

  test("fetch 200 com inScope true mas response ausente/vazio → ok false, erro de resposta inválida", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, {
      choices: [{ message: { content: JSON.stringify({ inScope: true, response: "" }) } }],
    });

    const result = await askDrJarvys({ userText: "meu carro não liga" });

    expect(result).toEqual({ ok: false, error: "Resposta inválida do Dr. Jarvys." });
  });

  test("response da IA maior que 1500 caracteres → truncado corretamente no resultado", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const longResponse = "a".repeat(1600);
    mockFetchResponse(200, {
      choices: [
        { message: { content: JSON.stringify({ inScope: true, response: longResponse }) } },
      ],
    });

    const result = await askDrJarvys({ userText: "me fala tudo sobre motores" });

    expect(result.ok).toBe(true);
    if (result.ok && result.inScope) {
      expect(result.response.length).toBe(1500);
      expect(result.response).toBe("a".repeat(1500));
    }
  });
});
