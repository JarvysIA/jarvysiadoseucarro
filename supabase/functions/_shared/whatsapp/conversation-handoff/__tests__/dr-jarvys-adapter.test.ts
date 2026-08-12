import { afterEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_HANDOFF_CONTRACT_VERSION,
  validateConversationExecutionResult,
  type ConversationHandoffCommandV1,
} from "../contract.ts";
import { createAskDrJarvysInvoker } from "../dr-jarvys-adapter.ts";
import { OUT_OF_SCOPE_TEXT } from "../../dr-jarvys/ask-dr-jarvys.ts";

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

function mockFetchThrow(error: Error): ReturnType<typeof mock> {
  const fetchMock = mock(async () => {
    throw error;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function mockFetchNeverCalled(): ReturnType<typeof mock> {
  const fetchMock = mock(async () => {
    throw new Error("fetch não deveria ser chamado");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

function primaryCommandWith(originalText: string): ConversationHandoffCommandV1 {
  return {
    version: CONVERSATION_HANDOFF_CONTRACT_VERSION,
    kind: "conversation",
    segment: "primary",
    contactId: CONTACT_ID,
    userId: USER_ID,
    vehicleId: VEHICLE_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    originalText,
  };
}

function successAiResponse(inScope: boolean, response?: string): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(
            inScope ? { inScope: true, response } : { inScope: false, response: null },
          ),
        },
      },
    ],
  };
}

describe("Bloco A — mapeamento de sucesso", () => {
  it("1. inScope true → success com responseText igual à resposta da IA", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, successAiResponse(true, "Troque o óleo a cada 10 mil km."));
    const invoke = createAskDrJarvysInvoker();
    const result = await invoke(primaryCommandWith("de quanto em quanto tempo troco o óleo?"));
    expect(result).toEqual({ status: "success", responseText: "Troque o óleo a cada 10 mil km." });
  });

  it("2. inScope false → success com responseText === OUT_OF_SCOPE_TEXT exato", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, successAiResponse(false));
    const invoke = createAskDrJarvysInvoker();
    const result = await invoke(primaryCommandWith("qual a previsão do tempo amanhã?"));
    expect(result).toEqual({ status: "success", responseText: OUT_OF_SCOPE_TEXT });
  });

  it("3. vehicleContext fornecido → repassado para askDrJarvys sem alteração", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mockFetchResponse(200, successAiResponse(true, "Depende do uso."));
    const vehicleContext = { brand: "Fiat", model: "Argo", year: 2022 };
    const invoke = createAskDrJarvysInvoker(vehicleContext);

    await invoke(primaryCommandWith("quando devo trocar a correia?"));

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

  it("4. vehicleContext ausente → askDrJarvys chamado sem vehicleContext (undefined), sem erro", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mockFetchResponse(200, successAiResponse(true, "Ok."));
    const invoke = createAskDrJarvysInvoker();

    const result = await invoke(primaryCommandWith("meu carro não liga"));

    expect(result).toEqual({ status: "success", responseText: "Ok." });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = body.messages.find((m) => m.role === "user");
    // Sem vehicleContext, askDrJarvys não prefixa nenhuma linha de veículo —
    // a mensagem enviada é exatamente o userText, prova de que nada foi
    // inventado no lugar do parâmetro ausente.
    expect(userMessage?.content).toBe("meu carro não liga");
  });
});

describe("Bloco B — mapeamento de permanent_failure", () => {
  it('5. error "userText é obrigatório" → permanent_failure/invalid_request', async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mockFetchNeverCalled();
    const invoke = createAskDrJarvysInvoker();

    const result = await invoke(primaryCommandWith(""));

    expect(result).toEqual({ status: "permanent_failure", reason: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('6. error "Mensagem muito longa." → permanent_failure/invalid_request', async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mockFetchNeverCalled();
    const invoke = createAskDrJarvysInvoker();

    const result = await invoke(primaryCommandWith("a".repeat(4001)));

    expect(result).toEqual({ status: "permanent_failure", reason: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Bloco C — mapeamento de transient_failure", () => {
  it("7. error de rate limit (429) → transient_failure/temporarily_unavailable", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(429, "rate limited");
    const invoke = createAskDrJarvysInvoker();

    const result = await invoke(primaryCommandWith("meu carro não liga"));

    expect(result).toEqual({ status: "transient_failure", reason: "temporarily_unavailable" });
  });

  it("8. error de créditos esgotados (402) → transient_failure/temporarily_unavailable", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(402, "payment required");
    const invoke = createAskDrJarvysInvoker();

    const result = await invoke(primaryCommandWith("meu carro não liga"));

    expect(result).toEqual({ status: "transient_failure", reason: "temporarily_unavailable" });
  });

  it("9. error de LOVABLE_API_KEY ausente → transient_failure/temporarily_unavailable", async () => {
    setDenoEnv({});
    const fetchMock = mockFetchNeverCalled();
    const invoke = createAskDrJarvysInvoker();

    const result = await invoke(primaryCommandWith("meu carro não liga"));

    expect(result).toEqual({ status: "transient_failure", reason: "temporarily_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("10. error de gateway genérico (500) → transient_failure/temporarily_unavailable", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(500, "internal error");
    const invoke = createAskDrJarvysInvoker();

    const result = await invoke(primaryCommandWith("meu carro não liga"));

    expect(result).toEqual({ status: "transient_failure", reason: "temporarily_unavailable" });
  });

  it("11. error de resposta inválida da IA → transient_failure/temporarily_unavailable", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, { choices: [{ message: { content: "isto não é um JSON" } }] });
    const invoke = createAskDrJarvysInvoker();

    const result = await invoke(primaryCommandWith("meu carro não liga"));

    expect(result).toEqual({ status: "transient_failure", reason: "temporarily_unavailable" });
  });
});

// Compartilhado pelos testes 14 e 15 — cada função reproduz exatamente um
// dos 11 cenários mapeados dos Blocos A-C.
const ELEVEN_SCENARIOS: ReadonlyArray<() => Promise<unknown>> = [
  () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, successAiResponse(true, "resposta 1"));
    return createAskDrJarvysInvoker()(primaryCommandWith("pergunta 1"));
  },
  () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, successAiResponse(false));
    return createAskDrJarvysInvoker()(primaryCommandWith("pergunta 2"));
  },
  () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, successAiResponse(true, "resposta 3"));
    return createAskDrJarvysInvoker({ brand: "Fiat" })(primaryCommandWith("pergunta 3"));
  },
  () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, successAiResponse(true, "resposta 4"));
    return createAskDrJarvysInvoker()(primaryCommandWith("pergunta 4"));
  },
  () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchNeverCalled();
    return createAskDrJarvysInvoker()(primaryCommandWith(""));
  },
  () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchNeverCalled();
    return createAskDrJarvysInvoker()(primaryCommandWith("a".repeat(4001)));
  },
  () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(429, "rate limited");
    return createAskDrJarvysInvoker()(primaryCommandWith("pergunta 7"));
  },
  () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(402, "payment required");
    return createAskDrJarvysInvoker()(primaryCommandWith("pergunta 8"));
  },
  () => {
    setDenoEnv({});
    mockFetchNeverCalled();
    return createAskDrJarvysInvoker()(primaryCommandWith("pergunta 9"));
  },
  () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(500, "internal error");
    return createAskDrJarvysInvoker()(primaryCommandWith("pergunta 10"));
  },
  () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, { choices: [{ message: { content: "não é json" } }] });
    return createAskDrJarvysInvoker()(primaryCommandWith("pergunta 11"));
  },
];

describe("Bloco D — default seguro e não vazamento", () => {
  it("12. erro não reconhecido (exceção com mensagem inédita) → cai no default transient_failure", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchThrow(new Error("ECONNRESET: socket hang up — mensagem nunca vista antes"));
    const invoke = createAskDrJarvysInvoker();

    const result = await invoke(primaryCommandWith("meu carro não liga"));

    expect(result).toEqual({ status: "transient_failure", reason: "temporarily_unavailable" });
  });

  it("13. nenhum dos cenários do Bloco C vaza o texto de erro original do askDrJarvys no resultado", async () => {
    const knownErrorFragments = [
      "Muitas requisições",
      "Créditos de IA esgotados",
      "LOVABLE_API_KEY",
      "Falha ao consultar",
      "Resposta inválida",
    ];

    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(429, "rate limited");
    let result = await createAskDrJarvysInvoker()(primaryCommandWith("x"));
    let serialized = JSON.stringify(result);
    for (const fragment of knownErrorFragments) expect(serialized).not.toContain(fragment);

    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(402, "payment required");
    result = await createAskDrJarvysInvoker()(primaryCommandWith("x"));
    serialized = JSON.stringify(result);
    for (const fragment of knownErrorFragments) expect(serialized).not.toContain(fragment);

    setDenoEnv({});
    mockFetchNeverCalled();
    result = await createAskDrJarvysInvoker()(primaryCommandWith("x"));
    serialized = JSON.stringify(result);
    for (const fragment of knownErrorFragments) expect(serialized).not.toContain(fragment);

    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(500, "internal error");
    result = await createAskDrJarvysInvoker()(primaryCommandWith("x"));
    serialized = JSON.stringify(result);
    for (const fragment of knownErrorFragments) expect(serialized).not.toContain(fragment);

    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchResponse(200, { choices: [{ message: { content: "não é json" } }] });
    result = await createAskDrJarvysInvoker()(primaryCommandWith("x"));
    serialized = JSON.stringify(result);
    for (const fragment of knownErrorFragments) expect(serialized).not.toContain(fragment);
  });

  it("14. resultado de cada um dos 11 cenários dos Blocos A-C passa validateConversationExecutionResult sem falhar", async () => {
    for (const runScenario of ELEVEN_SCENARIOS) {
      const result = await runScenario();
      const validation = validateConversationExecutionResult(result);
      expect(validation.ok).toBe(true);
    }
  });

  it("15. o adapter nunca lança exceção não tratada em nenhum dos cenários mapeados", async () => {
    for (const runScenario of ELEVEN_SCENARIOS) {
      await expect(runScenario()).resolves.toBeDefined();
    }
  });
});

describe("Bloco E — isolamento e pureza", () => {
  const adapterSource = readFileSync(
    fileURLToPath(new URL("../dr-jarvys-adapter.ts", import.meta.url)),
    "utf8",
  );

  it("16. não importa Supabase/createClient", () => {
    expect(adapterSource).not.toMatch(/supabase-js|createClient/);
  });

  it("17. não faz fetch direto (a única network call é indireta, dentro de askDrJarvys)", () => {
    expect(adapterSource).not.toMatch(/fetch\(/);
  });

  it("18. não importa símbolos do contrato agregado (C2A), do executor, de core ou de orchestrator", () => {
    // A substring proibida é montada em runtime (nunca escrita por extenso
    // aqui, nem em comentário) para este próprio arquivo não ser confundido
    // com um consumidor real do contrato agregado por um grep repo-wide
    // baseado em texto.
    const forbiddenAggregateReference = ["execution", "-contract"].join("");
    expect(adapterSource).not.toContain(forbiddenAggregateReference);
    expect(adapterSource).not.toMatch(/executor\.ts|core\.ts|orchestrator\//);
  });

  it("19. não resolve vehicleId → vehicleContext (sem lógica de busca)", () => {
    expect(adapterSource).not.toMatch(/vehicleId/);
    expect(adapterSource).not.toMatch(/\.select\(|\.from\(|SELECT /i);
  });

  it("20. zero any/as any/as unknown as/@ts-ignore/@ts-nocheck no arquivo", () => {
    expect(adapterSource).not.toMatch(/\bany\b|as any|as unknown as|@ts-ignore|@ts-nocheck/);
  });
});
