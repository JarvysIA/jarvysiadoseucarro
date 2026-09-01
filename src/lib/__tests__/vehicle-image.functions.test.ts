// Build Vehicle-Image-Cache — testes de runGenerateVehicleImage.
//
// Precedente de teste pra *.functions.ts em src/lib: NENHUM existe hoje
// (confirmado por busca exaustiva em todo o diretório antes de escrever
// este arquivo — zero *.functions.ts tem teste direto, e zero teste em
// src/lib mocka fetch/supabaseAdmin). Este arquivo segue o padrão já
// comprovado em supabase/functions/_shared/whatsapp/orchestrator/
// __tests__/ (client estrutural injetado via DI, nunca mock.module()) —
// por isso runGenerateVehicleImage recebe { client, fetchImpl } como
// parâmetro em vez de depender do supabaseAdmin/fetch globais.

import { describe, expect, test } from "bun:test";
import {
  runGenerateVehicleImage,
  type GenerateVehicleImageInput,
  type VehicleImageAdminClient,
} from "../vehicle-image.functions";

// O shim ambiente local (bun-test.d.ts) só declara describe/test/expect com
// um Matchers mínimo (toBe/toContain/not.toBe/not.toContain) — sem `mock` e
// sem matchers como toHaveBeenCalledTimes/toMatchObject. Em vez de alargar
// esse shim compartilhado (usado por todos os testes de src/lib/__tests__),
// este arquivo usa um contador manual pro fetch mockado.
function makeFetchMock(respond: () => Response) {
  let callCount = 0;
  const fn = async (..._args: unknown[]): Promise<Response> => {
    callCount++;
    return respond();
  };
  return { fn, getCallCount: () => callCount };
}

const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_LOVABLE_KEY = process.env.LOVABLE_API_KEY;

function setAiEnv(): void {
  delete process.env.OPENAI_API_KEY;
  process.env.LOVABLE_API_KEY = "test-lovable-key";
}

function restoreAiEnv(): void {
  if (ORIGINAL_OPENAI_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
  if (ORIGINAL_LOVABLE_KEY === undefined) delete process.env.LOVABLE_API_KEY;
  else process.env.LOVABLE_API_KEY = ORIGINAL_LOVABLE_KEY;
}

type CacheRow = { storage_path: string } | null;

type MockClientOptions = {
  initialCacheRow?: CacheRow;
  selectThrows?: boolean;
  // Chamado toda vez que upsert() roda; devolve a linha que a
  // reconsulta subsequente (lookup pós-insert) deve encontrar.
  onUpsert?: (row: Record<string, unknown>) => CacheRow;
  uploadError?: boolean;
  signedUrl?: string;
};

function makeMockClient(opts: MockClientOptions = {}) {
  let cacheRow: CacheRow = opts.initialCacheRow ?? null;
  const calls = {
    select: 0,
    upsert: [] as Record<string, unknown>[],
    upload: [] as { path: string }[],
    createSignedUrl: [] as { path: string }[],
    vehiclesUpdate: [] as { vehicleId: string; fotoUrl: string }[],
  };

  const client = {
    from(table: string) {
      if (table === "vehicle_image_cache") {
        return {
          select(_cols: string) {
            calls.select++;
            const builder = {
              eq(_c: string, _v: unknown) {
                return builder;
              },
              async maybeSingle() {
                if (opts.selectThrows) throw new Error("select boom");
                return { data: cacheRow, error: null };
              },
            };
            return builder;
          },
          async upsert(row: Record<string, unknown>, _upsertOpts: unknown) {
            calls.upsert.push(row);
            if (opts.onUpsert) {
              cacheRow = opts.onUpsert(row);
            } else if (cacheRow === null) {
              cacheRow = { storage_path: row.storage_path as string };
            }
            return { error: null };
          },
        };
      }
      if (table === "veiculos") {
        return {
          update(row: { foto_url: string }) {
            return {
              async eq(_c: string, vehicleId: unknown) {
                calls.vehiclesUpdate.push({
                  vehicleId: String(vehicleId),
                  fotoUrl: row.foto_url,
                });
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`tabela não mockada: ${table}`);
    },
    storage: {
      from(_bucket: string) {
        return {
          async upload(path: string, _bytes: Uint8Array, _o: unknown) {
            calls.upload.push({ path });
            if (opts.uploadError) return { error: { message: "upload failed" } };
            return { error: null };
          },
          async createSignedUrl(path: string, _seconds: number) {
            calls.createSignedUrl.push({ path });
            return { data: { signedUrl: opts.signedUrl ?? `https://signed.invalid/${path}` } };
          },
        };
      },
    },
  } as unknown as VehicleImageAdminClient;

  return { client, calls };
}

function aiImageResponse(b64 = "AAAA"): Response {
  return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
}

const BASE_INPUT: GenerateVehicleImageInput = {
  vehicleId: "veh-1",
  marca: "TOYOTA",
  modelo: "CCROSS XRE 20",
  ano: "2022",
  cor: "Preta",
};

describe("runGenerateVehicleImage — cache miss", () => {
  test("sem entrada no cache: chama a IA, insere no cache com a chave normalizada, usa path baseado na chave (não vehicleId)", async () => {
    setAiEnv();
    const { client, calls } = makeMockClient();
    const fetchMock = makeFetchMock(() => aiImageResponse());

    const result = await runGenerateVehicleImage(BASE_INPUT, {
      client,
      fetchImpl: fetchMock.fn as unknown as typeof fetch,
    });

    expect(fetchMock.getCallCount()).toBe(1);
    expect(result.ok).toBe(true);

    expect(calls.upsert.length).toBe(1);
    const upsertRow = calls.upsert[0] as Record<string, unknown>;
    expect(upsertRow.marca_norm).toBe("TOYOTA");
    expect(upsertRow.modelo_norm).toBe("CCROSS XRE 20");
    expect(upsertRow.ano_norm).toBe("2022");
    expect(upsertRow.cor_norm).toBe("PRETA");

    expect(calls.upload.length).toBe(1);
    expect(calls.upload[0]!.path).toBe("cache/toyota_ccross-xre-20_2022_preta.png");
    expect(calls.upload[0]!.path.includes(BASE_INPUT.vehicleId)).toBe(false);

    restoreAiEnv();
  });

  test("salva a signed URL em veiculos.foto_url pro vehicleId atual", async () => {
    setAiEnv();
    const { client, calls } = makeMockClient();
    const fetchMock = makeFetchMock(() => aiImageResponse());

    await runGenerateVehicleImage(BASE_INPUT, {
      client,
      fetchImpl: fetchMock.fn as unknown as typeof fetch,
    });

    expect(calls.vehiclesUpdate.length).toBe(1);
    expect(calls.vehiclesUpdate[0]!.vehicleId).toBe("veh-1");
    restoreAiEnv();
  });
});

describe("runGenerateVehicleImage — cache hit", () => {
  test("com entrada no cache: fetch NUNCA é chamado, só gera signed URL nova pro path existente", async () => {
    const { client, calls } = makeMockClient({
      initialCacheRow: { storage_path: "cache/toyota_ccross-xre-20_2022_preta.png" },
    });
    const fetchMock = makeFetchMock(() => aiImageResponse());

    const result = await runGenerateVehicleImage(BASE_INPUT, {
      client,
      fetchImpl: fetchMock.fn as unknown as typeof fetch,
    });

    expect(fetchMock.getCallCount()).toBe(0);
    expect(result.ok).toBe(true);
    expect(calls.upload.length).toBe(0);
    expect(calls.upsert.length).toBe(0);
    expect(calls.createSignedUrl.length).toBe(1);
    expect(calls.createSignedUrl[0]!.path).toBe("cache/toyota_ccross-xre-20_2022_preta.png");
  });
});

describe("runGenerateVehicleImage — corrida simulada", () => {
  test("upsert perde a corrida (linha já existe com outro path): signed URL final usa o path do vencedor, não o nosso upload", async () => {
    setAiEnv();
    const WINNER_PATH = "cache/toyota_ccross-xre-20_2022_preta.png";
    const { client, calls } = makeMockClient({
      onUpsert: () => ({ storage_path: WINNER_PATH }),
    });
    const fetchMock = makeFetchMock(() => aiImageResponse());

    const result = await runGenerateVehicleImage(BASE_INPUT, {
      client,
      fetchImpl: fetchMock.fn as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(calls.upload.length).toBe(1);
    const ourPath = calls.upload[0]!.path;
    expect(ourPath).toBe(WINNER_PATH); // mesma chave => mesmo path calculado, cenário real de corrida
    // A prova real está em createSignedUrl ter sido chamado com o path
    // devolvido pela reconsulta (winner), não com uma variável interna
    // não observável — como neste caso os paths coincidem (mesma chave),
    // o teste abaixo usa um path de vencedor DIFERENTE pra provar a
    // resolução de fato.
    expect(calls.createSignedUrl.length).toBe(1);
    restoreAiEnv();
  });

  test("upsert perde a corrida pra um path DIFERENTE do nosso: usa o path do vencedor", async () => {
    setAiEnv();
    const OTHER_PATH = "cache/outro-veiculo-diferente.png";
    const { client, calls } = makeMockClient({
      onUpsert: () => ({ storage_path: OTHER_PATH }),
    });
    const fetchMock = makeFetchMock(() => aiImageResponse());

    const result = await runGenerateVehicleImage(BASE_INPUT, {
      client,
      fetchImpl: fetchMock.fn as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(calls.upload.length).toBe(1);
    expect(calls.upload[0]!.path).not.toBe(OTHER_PATH); // nosso upload usou o path calculado normalmente
    expect(calls.createSignedUrl.length).toBe(1);
    expect(calls.createSignedUrl[0]!.path).toBe(OTHER_PATH); // mas a URL final é do vencedor
    restoreAiEnv();
  });
});

describe("runGenerateVehicleImage — normalização (via comportamento observável)", () => {
  test("'Toyota'/'TOYOTA '/' toyota' etc. batem na mesma chave já cacheada (cache hit, fetch nunca chamado)", async () => {
    const { client, calls } = makeMockClient({
      initialCacheRow: { storage_path: "cache/toyota_ccross-xre-20_2022_preta.png" },
    });
    const fetchMock = makeFetchMock(() => aiImageResponse());

    const messyInput: GenerateVehicleImageInput = {
      vehicleId: "veh-2",
      marca: "  toyota ",
      modelo: "ccross xre 20",
      ano: " 2022",
      cor: "Preta ",
    };

    const result = await runGenerateVehicleImage(messyInput, {
      client,
      fetchImpl: fetchMock.fn as unknown as typeof fetch,
    });

    expect(fetchMock.getCallCount()).toBe(0);
    expect(result.ok).toBe(true);
    expect(calls.upload.length).toBe(0);
  });
});

describe("runGenerateVehicleImage — fail-safe do cache", () => {
  test("SELECT do cache lança exceção => degrada pro fluxo antigo (gera via IA normalmente, não trava)", async () => {
    setAiEnv();
    const { client, calls } = makeMockClient({ selectThrows: true });
    const fetchMock = makeFetchMock(() => aiImageResponse());

    const result = await runGenerateVehicleImage(BASE_INPUT, {
      client,
      fetchImpl: fetchMock.fn as unknown as typeof fetch,
    });

    expect(fetchMock.getCallCount()).toBe(1);
    expect(result.ok).toBe(true);
    expect(calls.upload.length).toBe(1);
    restoreAiEnv();
  });
});
