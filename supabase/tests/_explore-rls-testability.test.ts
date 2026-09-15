/**
 * EXPLORATÓRIO / TEMPORÁRIO — RLS-Test-Harness.
 *
 * Prova de conceito: confirmar se `SET LOCAL ROLE authenticated` + GUC
 * `request.jwt.claim.sub` (a mesma combinação já usada manualmente dezenas
 * de vezes nesta sessão pra verificar RLS ao vivo) também funciona dentro
 * do harness de teste (supabase/tests/harness/db.ts), que conecta como
 * "postgres" (superuser) via TEST_DATABASE_URL.
 *
 * Por que isso NÃO é óbvio a partir dos testes já existentes: todos os
 * testes SQL desta sessão até agora (profile-privileged-columns, MJ2B-V
 * F2) testam TRIGGERS (auth.role()/auth.uid() como funções lidas de GUC —
 * `set_config(...)` sozinho já basta, porque triggers rodam pra qualquer
 * role, inclusive superuser). RLS é diferente: só é AVALIADA pelo Postgres
 * se o role EFETIVO da sessão (current_user, não o role de login) não for
 * superuser nem dono da tabela. `SET ROLE` troca esse role efetivo de
 * verdade — diferente de só setar uma GUC — e um superuser pode assumir
 * qualquer role sem GRANT explícito (semântica padrão do Postgres).
 *
 * Cenário escolhido: enforcement BÁSICO de ownership (policy "Users
 * update own despesas", `USING (auth.uid() = user_id)`) — não o guard
 * cross-vehicle específico do achado A3 (`WITH CHECK ... EXISTS (SELECT
 * 1 FROM veiculos ...)`), porque esse ainda não está mesclado em main no
 * momento desta investigação (PR #109 segue aberto). O enforcement básico
 * de ownership já está em produção desde a criação da tabela e é
 * suficiente pra provar (ou refutar) o mecanismo SET ROLE + GUC em si.
 *
 * IMPORTANTE: este sandbox não tem Postgres real (supabase CLI/docker
 * indisponíveis, mesma limitação já documentada nesta sessão). Este
 * arquivo é a prova de conceito ESCRITA da forma mais correta possível
 * com base no que já sabemos — só pode ser CONFIRMADA rodando de verdade
 * no CI. Não presuma o resultado a partir daqui.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "./harness/db";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

const USER_A = "11111111-1111-4111-8111-000000000001";
const USER_B = "22222222-2222-4222-8222-000000000001";
const VEHICLE_A = "11111111-1111-4111-8111-000000000002";
const VEHICLE_B = "22222222-2222-4222-8222-000000000002";
const DESPESA_A = "11111111-1111-4111-8111-000000000003";
const DESPESA_B = "22222222-2222-4222-8222-000000000003";

async function seed(session: Session): Promise<void> {
  await session.query("SET LOCAL search_path = public");

  for (const [id, email] of [
    [USER_A, "rls-explore-a@example.invalid"],
    [USER_B, "rls-explore-b@example.invalid"],
  ] as const) {
    await session.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, email],
    );
    await session.query(
      `INSERT INTO public.profiles (id, nome) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, "RLS Explore"],
    );
  }

  await session.query(
    `INSERT INTO public.veiculos (id, user_id, placa, status)
     VALUES ($1, $2, 'RLSEXPA', 'ativo')
     ON CONFLICT (id) DO NOTHING`,
    [VEHICLE_A, USER_A],
  );
  await session.query(
    `INSERT INTO public.veiculos (id, user_id, placa, status)
     VALUES ($1, $2, 'RLSEXPB', 'ativo')
     ON CONFLICT (id) DO NOTHING`,
    [VEHICLE_B, USER_B],
  );

  await session.query(
    `INSERT INTO public.despesas (id, user_id, vehicle_id, categoria, valor, descricao)
     VALUES ($1, $2, $3, 'Combustível', 50, 'seed A')
     ON CONFLICT (id) DO NOTHING`,
    [DESPESA_A, USER_A, VEHICLE_A],
  );
  await session.query(
    `INSERT INTO public.despesas (id, user_id, vehicle_id, categoria, valor, descricao)
     VALUES ($1, $2, $3, 'Combustível', 50, 'seed B')
     ON CONFLICT (id) DO NOTHING`,
    [DESPESA_B, USER_B, VEHICLE_B],
  );
}

async function cleanup(session: Session): Promise<void> {
  await session.query("SET LOCAL search_path = public");
  await session.query(`DELETE FROM public.despesas WHERE id IN ($1, $2)`, [DESPESA_A, DESPESA_B]);
  await session.query(`DELETE FROM public.veiculos WHERE id IN ($1, $2)`, [VEHICLE_A, VEHICLE_B]);
  await session.query(`DELETE FROM public.profiles WHERE id IN ($1, $2)`, [USER_A, USER_B]);
  await session.query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [USER_A, USER_B]);
}

describeIfDb("EXPLORATÓRIO — SET LOCAL ROLE authenticated + jwt.claim.sub sob RLS real", () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession("rls-explore-setup");
    await session.begin();
    await cleanup(session);
    await session.commit();
    await session.begin();
    await seed(session);
    await session.commit();
  });

  afterAll(async () => {
    try {
      await session.begin();
      await cleanup(session);
      await session.commit();
    } finally {
      await session?.close();
    }
  });

  test("controle positivo: como A, SELECT na própria despesa retorna 1 linha", async () => {
    await session.begin();
    await session.query(`SET LOCAL ROLE authenticated`);
    await session.query(`SET LOCAL request.jwt.claim.sub = '${USER_A}'`);
    const r = await session.query<{ id: string }>(
      `SELECT id FROM public.despesas WHERE id = $1`,
      [DESPESA_A],
    );
    await session.commit();
    expect(r.rows.length).toBe(1);
  });

  test("controle positivo: como A, UPDATE na própria despesa afeta 1 linha", async () => {
    await session.begin();
    await session.query(`SET LOCAL ROLE authenticated`);
    await session.query(`SET LOCAL request.jwt.claim.sub = '${USER_A}'`);
    const r = await session.query(
      `UPDATE public.despesas SET descricao = 'seed A editado' WHERE id = $1`,
      [DESPESA_A],
    );
    await session.commit();
    expect(r.rowCount).toBe(1);
  });

  test("RLS real: como A, SELECT na despesa de B retorna 0 linhas (filtrado silenciosamente)", async () => {
    await session.begin();
    await session.query(`SET LOCAL ROLE authenticated`);
    await session.query(`SET LOCAL request.jwt.claim.sub = '${USER_A}'`);
    const r = await session.query<{ id: string }>(
      `SELECT id FROM public.despesas WHERE id = $1`,
      [DESPESA_B],
    );
    await session.commit();
    expect(r.rows.length).toBe(0);
  });

  test("RLS real: como A, UPDATE na despesa de B afeta 0 linhas (bloqueado)", async () => {
    await session.begin();
    await session.query(`SET LOCAL ROLE authenticated`);
    await session.query(`SET LOCAL request.jwt.claim.sub = '${USER_A}'`);
    const r = await session.query(
      `UPDATE public.despesas SET descricao = 'ataque' WHERE id = $1`,
      [DESPESA_B],
    );
    await session.commit();
    expect(r.rowCount).toBe(0);

    // Confirma (via conexão superuser, fora do RLS) que o valor de B
    // realmente não mudou — 0 linhas afetadas não é suficiente sozinho
    // pra provar isso se a query também pudesse ter dado erro silencioso.
    const check = await session.query<{ descricao: string }>(
      `SELECT descricao FROM public.despesas WHERE id = $1`,
      [DESPESA_B],
    );
    expect(check.rows[0]?.descricao).toBe("seed B");
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log(
    "[RLS-Test-Harness explore] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)",
  );
}
