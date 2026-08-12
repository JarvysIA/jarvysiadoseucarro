import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveConversationHandoffAuthorization } from "../dr-jarvys-authorization.ts";
import type {
  RpcInvoker,
  SupabaseFromBuilder,
  SupabaseLike,
  SupabaseMaybeSingleResult,
  SupabaseSelectResult,
} from "../../orchestrator/repository.ts";

// Mesmo padrão de mock estrutural usado em orchestrator/__tests__/repository.test.ts
// (makeFromMock/makeCtxClient), redeclarado aqui para não depender daquele
// arquivo de teste. Implementa SupabaseSelectBuilder via classe (PromiseLike +
// eq + maybeSingle) para nunca precisar de `as unknown as`.
type TableRows = Record<string, Record<string, unknown>[]>;

class MockSelectBuilder implements PromiseLike<SupabaseSelectResult> {
  private readonly filters: Array<[string, unknown]> = [];

  constructor(
    private readonly runSelect: (filters: readonly [string, unknown][]) => SupabaseSelectResult,
  ) {}

  eq(column: string, value: unknown): MockSelectBuilder {
    this.filters.push([column, value]);
    return this;
  }

  async maybeSingle(): Promise<SupabaseMaybeSingleResult> {
    const result = this.runSelect(this.filters);
    if (result.error) return { data: null, error: result.error };
    return { data: result.data?.[0] ?? null, error: null };
  }

  then<TResult1 = SupabaseSelectResult, TResult2 = never>(
    onfulfilled?: ((value: SupabaseSelectResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.runSelect(this.filters)).then(onfulfilled, onrejected);
  }
}

function makeFromMock(
  rows: TableRows,
  opts: { errorOn?: string; errorPayload?: { message: string; code?: string } } = {},
): (table: string) => SupabaseFromBuilder {
  return (table: string) => ({
    select: () =>
      new MockSelectBuilder((filters) => {
        if (opts.errorOn === table) {
          return {
            data: null,
            error: {
              message: opts.errorPayload?.message ?? "boom",
              code: opts.errorPayload?.code ?? null,
            },
          };
        }
        const matched = (rows[table] ?? []).filter((row) =>
          filters.every(([column, value]) => row[column] === value),
        );
        return { data: matched, error: null };
      }),
  });
}

function makeTestClient(
  rows: TableRows,
  opts?: { errorOn?: string; errorPayload?: { message: string; code?: string } },
): SupabaseLike {
  const rpc: RpcInvoker = async () => ({ data: null, error: null });
  return { rpc, from: makeFromMock(rows, opts) };
}

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const VEHICLE_ID = "vehicle-1";
const OTHER_VEHICLE_ID = "vehicle-2";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

const VIP_PROFILE = { id: USER_ID, status_usuario: "vip", trial_inicio: null };
const ATIVO_PROFILE = { id: USER_ID, status_usuario: "ativo", trial_inicio: null };
const TRIAL_RECENT_PROFILE = {
  id: USER_ID,
  status_usuario: "trial",
  trial_inicio: isoDaysAgo(5),
};
const TRIAL_EXPIRED_PROFILE = {
  id: USER_ID,
  status_usuario: "trial",
  trial_inicio: isoDaysAgo(40),
};

describe("Bloco A — vehicleId presente, autorizado", () => {
  it("1. veículo encontrado, perfil vip → authorized:true com vehicleContext correto", async () => {
    const client = makeTestClient({
      profiles: [VIP_PROFILE],
      pagamentos_pix: [],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: USER_ID,
          marca: "Fiat",
          modelo: "Argo",
          ano: "2022",
          status: "ativo",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({
      authorized: true,
      vehicleContext: { brand: "Fiat", model: "Argo", year: "2022" },
    });
  });

  it("2. veículo encontrado, perfil ativo com ativação paga → authorized:true", async () => {
    const client = makeTestClient({
      profiles: [ATIVO_PROFILE],
      pagamentos_pix: [
        { veiculo_id: VEHICLE_ID, status: "pago", tipo_produto: "ativacao", user_id: USER_ID },
      ],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: USER_ID,
          marca: "Fiat",
          modelo: "Argo",
          ano: "2022",
          status: "ativo",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result.authorized).toBe(true);
  });

  it("3. veículo encontrado, perfil trial dentro dos 30 dias → authorized:true", async () => {
    const client = makeTestClient({
      profiles: [TRIAL_RECENT_PROFILE],
      pagamentos_pix: [],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: USER_ID,
          marca: "VW",
          modelo: "Gol",
          ano: "2020",
          status: "ativo",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result.authorized).toBe(true);
  });
});

describe("Bloco B — vehicleId presente, negado", () => {
  it("4. veículo não encontrado (query vazia) → vehicle_required", async () => {
    const client = makeTestClient({ profiles: [VIP_PROFILE], pagamentos_pix: [], veiculos: [] });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "vehicle_required" });
  });

  it("5. veículo pertence a outro user_id → vehicle_required (query filtrada retorna vazio)", async () => {
    const client = makeTestClient({
      profiles: [VIP_PROFILE],
      pagamentos_pix: [],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: OTHER_USER_ID,
          marca: "Fiat",
          modelo: "Argo",
          ano: "2022",
          status: "ativo",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "vehicle_required" });
  });

  it("6. veículo encontrado com status archived → authorization_required", async () => {
    const client = makeTestClient({
      profiles: [VIP_PROFILE],
      pagamentos_pix: [],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: USER_ID,
          marca: "Fiat",
          modelo: "Argo",
          ano: "2022",
          status: "archived",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });

  it("7. veículo encontrado, perfil ativo sem ativação paga → authorization_required", async () => {
    const client = makeTestClient({
      profiles: [ATIVO_PROFILE],
      pagamentos_pix: [],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: USER_ID,
          marca: "Fiat",
          modelo: "Argo",
          ano: "2022",
          status: "ativo",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });

  it("8. veículo encontrado, perfil trial expirado (>30 dias) → authorization_required", async () => {
    const client = makeTestClient({
      profiles: [TRIAL_EXPIRED_PROFILE],
      pagamentos_pix: [],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: USER_ID,
          marca: "Fiat",
          modelo: "Argo",
          ano: "2022",
          status: "ativo",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });
});

describe("Bloco C — vehicleId ausente, múltiplos veículos", () => {
  it("9. um veículo full entre vários → authorized:true, sem vehicleContext", async () => {
    const client = makeTestClient({
      profiles: [ATIVO_PROFILE],
      pagamentos_pix: [
        { veiculo_id: VEHICLE_ID, status: "pago", tipo_produto: "ativacao", user_id: USER_ID },
      ],
      veiculos: [
        { id: VEHICLE_ID, user_id: USER_ID, status: "ativo" }, // full (tem ativação paga)
        { id: OTHER_VEHICLE_ID, user_id: USER_ID, status: "ativo" }, // passive_with_km (sem ativação)
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, null);

    expect(result).toEqual({ authorized: true });
    expect(Object.hasOwn(result, "vehicleContext")).toBe(false);
  });

  it("10. só veículos passive_with_km → authorization_required", async () => {
    const client = makeTestClient({
      profiles: [ATIVO_PROFILE],
      pagamentos_pix: [],
      veiculos: [{ id: VEHICLE_ID, user_id: USER_ID, status: "ativo" }],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, null);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });

  it("11. só veículos denied (status não reconhecido) → authorization_required", async () => {
    const client = makeTestClient({
      profiles: [VIP_PROFILE],
      pagamentos_pix: [],
      veiculos: [{ id: VEHICLE_ID, user_id: USER_ID, status: "totalmente_desconhecido" }],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, null);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });

  it("12. usuário sem nenhum veículo (lista vazia) → authorization_required", async () => {
    const client = makeTestClient({ profiles: [VIP_PROFILE], pagamentos_pix: [], veiculos: [] });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, null);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });

  it("13. usuário só tem veículo archived (excluído da busca) → authorization_required", async () => {
    const client = makeTestClient({
      profiles: [VIP_PROFILE],
      pagamentos_pix: [],
      veiculos: [{ id: VEHICLE_ID, user_id: USER_ID, status: "archived" }],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, null);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });
});

describe("Bloco D — fail-closed em erro/dado inválido", () => {
  it("14. erro na query de profiles → authorization_required, sem vazar detalhe do erro", async () => {
    const client = makeTestClient(
      { profiles: [], pagamentos_pix: [], veiculos: [] },
      {
        errorOn: "profiles",
        errorPayload: { message: "SEGREDO-SQL-detalhe-interno", code: "42P01" },
      },
    );

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SEGREDO-SQL-detalhe-interno");
    expect(serialized).not.toContain("42P01");
  });

  it("15. profiles não encontrado → authorization_required", async () => {
    const client = makeTestClient({ profiles: [], pagamentos_pix: [], veiculos: [] });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });

  it("16. profiles com status_usuario de tipo inválido → authorization_required (guard estrutural)", async () => {
    const client = makeTestClient({
      profiles: [{ id: USER_ID, status_usuario: 123, trial_inicio: null }],
      pagamentos_pix: [],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: USER_ID,
          marca: "Fiat",
          modelo: "Argo",
          ano: "2022",
          status: "ativo",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });

  it("17. erro na query de pagamentos_pix → authorization_required", async () => {
    const client = makeTestClient(
      {
        profiles: [ATIVO_PROFILE],
        pagamentos_pix: [],
        veiculos: [
          {
            id: VEHICLE_ID,
            user_id: USER_ID,
            marca: "Fiat",
            modelo: "Argo",
            ano: "2022",
            status: "ativo",
          },
        ],
      },
      { errorOn: "pagamentos_pix" },
    );

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });

  it("18. linha de pagamentos_pix inválida (veiculo_id ausente) → authorization_required", async () => {
    const client = makeTestClient({
      profiles: [ATIVO_PROFILE],
      pagamentos_pix: [{ status: "pago", tipo_produto: "ativacao", user_id: USER_ID }],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: USER_ID,
          marca: "Fiat",
          modelo: "Argo",
          ano: "2022",
          status: "ativo",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "authorization_required" });
  });

  it("19. erro na query de veiculos (vehicleId presente) → vehicle_required", async () => {
    const client = makeTestClient(
      { profiles: [VIP_PROFILE], pagamentos_pix: [], veiculos: [] },
      { errorOn: "veiculos" },
    );

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ authorized: false, reason: "vehicle_required" });
  });
});

describe("Bloco E — vehicleContext e omissão de campos", () => {
  it("20. veículo com marca/modelo/ano preenchidos → vehicleContext com os 3 campos", async () => {
    const client = makeTestClient({
      profiles: [VIP_PROFILE],
      pagamentos_pix: [],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: USER_ID,
          marca: "Toyota",
          modelo: "Corolla",
          ano: "2023",
          status: "ativo",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({
      authorized: true,
      vehicleContext: { brand: "Toyota", model: "Corolla", year: "2023" },
    });
  });

  it('21. veículo com ano NULL → vehicleContext sem a chave "year"', async () => {
    const client = makeTestClient({
      profiles: [VIP_PROFILE],
      pagamentos_pix: [],
      veiculos: [
        {
          id: VEHICLE_ID,
          user_id: USER_ID,
          marca: "Toyota",
          modelo: "Corolla",
          ano: null,
          status: "ativo",
        },
      ],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, VEHICLE_ID);

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.vehicleContext).toEqual({ brand: "Toyota", model: "Corolla" });
      expect(Object.hasOwn(result.vehicleContext ?? {}, "year")).toBe(false);
    }
  });

  it("22. vehicleId null autorizado → resultado não contém a chave vehicleContext", async () => {
    const client = makeTestClient({
      profiles: [VIP_PROFILE],
      pagamentos_pix: [],
      veiculos: [{ id: VEHICLE_ID, user_id: USER_ID, status: "ativo" }],
    });

    const result = await resolveConversationHandoffAuthorization(client, USER_ID, null);

    expect(result).toEqual({ authorized: true });
    expect(Object.hasOwn(result, "vehicleContext")).toBe(false);
  });
});

describe("Bloco F — reaproveitamento e pureza", () => {
  const authorizationSource = readFileSync(
    fileURLToPath(new URL("../dr-jarvys-authorization.ts", import.meta.url)),
    "utf8",
  );

  it("23. importa computeWhatsappVehicleAccessMode de ../plan/vehicle-access-mode.ts e não reimplementa as constantes", () => {
    expect(authorizationSource).toContain('from "../plan/vehicle-access-mode.ts"');
    expect(authorizationSource).toContain("computeWhatsappVehicleAccessMode");
    expect(authorizationSource).not.toMatch(
      /RECOGNIZED_PROFILE_STATUSES|RECOGNIZED_VEHICLE_STATUSES/,
    );
  });

  it("24. nenhuma escrita no banco: zero .insert(/.update(/.delete(/.upsert( no arquivo", () => {
    expect(authorizationSource).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("25. zero any/as any/as unknown as/@ts-ignore/@ts-nocheck no arquivo", () => {
    expect(authorizationSource).not.toMatch(/\bany\b|as any|as unknown as|@ts-ignore|@ts-nocheck/);
  });
});
