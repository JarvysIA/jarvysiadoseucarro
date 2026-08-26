// Testes de createTranscribeAudioMessage (WIRE-4). Runner: bun test.
//
// Não usa mock.module(): entrypoint.test.ts já documenta que mock.module()
// vaza entre arquivos de teste no mesmo processo bun test, quebrando testes
// de arquivos não relacionados (12 testes de dr-jarvys-adapter.test.ts
// quebraram numa tentativa anterior). Em vez disso, mocka globalThis.fetch
// diretamente (mesmo padrão comprovado de dr-jarvys-adapter.test.ts e
// parse-voice-message.test.ts, com afterEach restaurando o original) — como
// downloadWhatsappMedia e parseVoiceMessage só fazem fetch por baixo, isso
// exercita o pipeline real de ponta a ponta sem tocar em mock.module.

import { afterEach, describe, expect, mock, test } from "bun:test";
import { createTranscribeAudioMessage } from "../audio-transcription-deps.ts";
import type {
  RpcInvoker,
  SupabaseFromBuilder,
  SupabaseLike,
  SupabaseMaybeSingleResult,
} from "../repository.ts";

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
const MEDIA_URL = "https://media.z-api.invalid/download/abc123";
const TRANSCRIPTION_ENDPOINT = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const MESSAGE_ID = "msg-audio-1";

// ------------------------------------------------------------
// Mock do client Supabase — mesmo builder mínimo de repository.ts
// (.from(table).select(cols).eq(col, val).maybeSingle()), local a este
// arquivo (não exportado em lugar nenhum pra reuso).
// ------------------------------------------------------------

type MessageRow = { media_url?: string | null; media_mime_type?: string | null } | null;

function makeClient(
  row: MessageRow,
  opts: { queryError?: boolean; throwOnFrom?: boolean } = {},
): SupabaseLike {
  return {
    rpc: (async () => ({ data: null, error: null })) as RpcInvoker,
    from: (_table: string): SupabaseFromBuilder => {
      if (opts.throwOnFrom) {
        throw new Error("client.from explodiu de forma inesperada");
      }
      return {
        select: (_cols: string) => {
          const builder = {
            eq(_column: string, _value: unknown) {
              return builder;
            },
            async maybeSingle(): Promise<SupabaseMaybeSingleResult> {
              if (opts.queryError) {
                return { data: null, error: { message: "boom", code: null } };
              }
              return { data: row as Record<string, unknown> | null, error: null };
            },
          };
          return builder as unknown as ReturnType<SupabaseFromBuilder["select"]>;
        },
      };
    },
  };
}

// ------------------------------------------------------------
// Router de fetch: distingue a chamada de download (media_url) da chamada
// de transcrição (endpoint fixo do Lovable AI Gateway).
// ------------------------------------------------------------

function mockFetchRouter(handlers: {
  media?: () => Promise<Response> | Response;
  transcription?: () => Promise<Response> | Response;
}): ReturnType<typeof mock> {
  const fetchMock = mock(async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    if (url === TRANSCRIPTION_ENDPOINT) {
      if (!handlers.transcription) throw new Error("transcription fetch não mockado neste teste");
      return handlers.transcription();
    }
    if (!handlers.media) throw new Error("media fetch não mockado neste teste");
    return handlers.media();
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function audioBytes(): Uint8Array {
  return new Uint8Array([1, 2, 3, 4, 5]);
}

function transcriptionResponse(text: string): Response {
  return new Response(JSON.stringify({ text }), { status: 200 });
}

describe("createTranscribeAudioMessage", () => {
  // 1. Sucesso ponta a ponta
  test("sucesso: busca a linha, baixa a mídia, transcreve, devolve ok+text", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchRouter({
      media: () => new Response(audioBytes().buffer, { status: 200 }),
      transcription: () => transcriptionResponse("quanto custa a revisão?"),
    });
    const client = makeClient({ media_url: MEDIA_URL, media_mime_type: "audio/ogg" });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({ kind: "ok", text: "quanto custa a revisão?" });
  });

  // 2. Mensagem não encontrada / sem media_url
  test("linha não encontrada (null) => permanent_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = makeClient(null);

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({ kind: "permanent_error", reason: "media_url_missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("linha existe mas media_url ausente => permanent_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = makeClient({ media_url: null, media_mime_type: "audio/ogg" });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({ kind: "permanent_error", reason: "media_url_missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("busca falha (res.error) => permanent_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = makeClient(null, { queryError: true });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({ kind: "permanent_error", reason: "message_lookup_failed" });
  });

  // 3. Erros de downloadWhatsappMedia mapeados corretamente
  test("download 404 => permanent_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchRouter({ media: () => new Response("not found", { status: 404 }) });
    const client = makeClient({ media_url: MEDIA_URL });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({ kind: "permanent_error", reason: "download_failed_status_404" });
  });

  test("download 500 => transient_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchRouter({ media: () => new Response("server error", { status: 500 }) });
    const client = makeClient({ media_url: MEDIA_URL });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({ kind: "transient_error", reason: "download_failed_status_500" });
  });

  test("download media_too_large => permanent_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchRouter({
      media: () =>
        new Response(audioBytes().buffer, {
          status: 200,
          headers: { "content-length": "999999999" },
        }),
    });
    const client = makeClient({ media_url: MEDIA_URL });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({ kind: "permanent_error", reason: "media_too_large" });
  });

  test("download genérico (mediaUrl inválida) => transient_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const fetchMock = mock(async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // media_url não-https força invalid_media_url dentro de downloadWhatsappMedia,
    // que é permanent — mas o objetivo deste caso é comprovar o branch
    // "download_failed" (rede) separadamente:
    const client = makeClient({ media_url: MEDIA_URL });
    globalThis.fetch = mock(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({ kind: "transient_error", reason: "download_failed" });
  });

  // 4. Erros de parseVoiceMessage mapeados corretamente (mesmas categorias
  // usadas como referência em dr-jarvys-adapter.test.ts / parse-voice-message.ts)
  test("transcrição 429 (rate limit) => transient_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchRouter({
      media: () => new Response(audioBytes().buffer, { status: 200 }),
      transcription: () => new Response("rate limited", { status: 429 }),
    });
    const client = makeClient({ media_url: MEDIA_URL });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({
      kind: "transient_error",
      reason: "Muitas requisições. Tente novamente em alguns segundos.",
    });
  });

  test("transcrição 402 (créditos esgotados) => transient_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchRouter({
      media: () => new Response(audioBytes().buffer, { status: 200 }),
      transcription: () => new Response("payment required", { status: 402 }),
    });
    const client = makeClient({ media_url: MEDIA_URL });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({
      kind: "transient_error",
      reason: "Créditos de IA esgotados. Adicione créditos na workspace.",
    });
  });

  test("LOVABLE_API_KEY ausente => transient_error", async () => {
    setDenoEnv({});
    mockFetchRouter({ media: () => new Response(audioBytes().buffer, { status: 200 }) });
    const client = makeClient({ media_url: MEDIA_URL });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({
      kind: "transient_error",
      reason: "LOVABLE_API_KEY não configurada no ambiente Deno.",
    });
  });

  test("gateway genérico (500 na transcrição) => transient_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchRouter({
      media: () => new Response(audioBytes().buffer, { status: 200 }),
      transcription: () => new Response("boom", { status: 500 }),
    });
    const client = makeClient({ media_url: MEDIA_URL });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({
      kind: "transient_error",
      reason: "Falha ao chamar o serviço de transcrição.",
    });
  });

  test("fala não identificada (texto vazio) => permanent_error", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    mockFetchRouter({
      media: () => new Response(audioBytes().buffer, { status: 200 }),
      transcription: () => transcriptionResponse(""),
    });
    const client = makeClient({ media_url: MEDIA_URL });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({
      kind: "permanent_error",
      reason: "Não consegui identificar fala no áudio. Tente gravar de novo.",
    });
  });

  // 5. Exceção imprevista => transient_error, nunca lança
  test("client.from lança exceção inesperada => transient_error, nunca lança", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const client = makeClient(null, { throwOnFrom: true });

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({ kind: "transient_error", reason: "unexpected_error" });
  });

  test("client sem .from => transient_error, nunca lança", async () => {
    setDenoEnv({ LOVABLE_API_KEY: VALID_KEY });
    const client: SupabaseLike = { rpc: (async () => ({ data: null, error: null })) as RpcInvoker };

    const transcribe = createTranscribeAudioMessage(client);
    const result = await transcribe(MESSAGE_ID);

    expect(result).toEqual({ kind: "transient_error", reason: "unexpected_error" });
  });
});
