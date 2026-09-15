/**
 * RLS-Regression-Tests — C4: a policy de SELECT em despesas ("Users
 * select despesas of owned vehicle", Security-Audit-Fixes PR #107) passou
 * a exigir `v.claimed_at IS NULL OR despesas.created_at >= v.claimed_at`
 * — fecha o vazamento de histórico pré-claim pro novo dono de um veículo
 * resgatado.
 *
 * Setup: claimed_at é uma das colunas congeladas pelo trigger C3
 * (proteger_colunas_privilegiadas_veiculo) — um INSERT não-privilegiado
 * força claimed_at=NULL, então o veículo "claimed" deste teste precisa
 * ser criado (claimed_at nasce NULL, forçado) e DEPOIS ter claimed_at
 * setado via asServiceRole (mesmo caminho real de
 * claimArchivedVehicleFn), não via INSERT direto.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  OWNER_ID,
  asServiceRole,
  asUser,
  cleanupUsers,
  seedUsers,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

const VEHICLE_CLAIMED_ID = "33333333-3333-4333-8333-000000004101";
const VEHICLE_UNCLAIMED_ID = "33333333-3333-4333-8333-000000004102";
const DESPESA_PRE_CLAIM_ID = "33333333-3333-4333-8333-000000004201";
const DESPESA_POST_CLAIM_ID = "33333333-3333-4333-8333-000000004202";
const DESPESA_UNCLAIMED_A_ID = "33333333-3333-4333-8333-000000004203";
const DESPESA_UNCLAIMED_B_ID = "33333333-3333-4333-8333-000000004204";

const CLAIMED_AT = "2026-06-01T00:00:00.000Z";
const PRE_CLAIM_CREATED_AT = "2020-01-01T00:00:00.000Z";
const POST_CLAIM_CREATED_AT = "2027-01-01T00:00:00.000Z";

const VEHICLE_IDS = [VEHICLE_CLAIMED_ID, VEHICLE_UNCLAIMED_ID];
const DESPESA_IDS = [
  DESPESA_PRE_CLAIM_ID,
  DESPESA_POST_CLAIM_ID,
  DESPESA_UNCLAIMED_A_ID,
  DESPESA_UNCLAIMED_B_ID,
];

async function cleanupAll(session: Session): Promise<void> {
  await session.query("SET LOCAL search_path = public");
  await session.query(`DELETE FROM public.despesas WHERE id = ANY($1::uuid[])`, [DESPESA_IDS]);
  await session.query(`DELETE FROM public.veiculos WHERE id = ANY($1::uuid[])`, [VEHICLE_IDS]);
  await cleanupUsers(session);
}

describeIfDb("RLS-Regression C4 — despesas SELECT (claimed_at)", () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession("rls-c4-setup");
    await session.begin();
    await cleanupAll(session);
    await session.commit();

    await session.begin();
    await seedUsers(session);
    await session.query(
      `INSERT INTO public.veiculos (id, user_id, placa, status)
       VALUES ($1, $2, 'C4RLS01', 'ativo')
       ON CONFLICT (id) DO NOTHING`,
      [VEHICLE_CLAIMED_ID, OWNER_ID],
    );
    await session.query(
      `INSERT INTO public.veiculos (id, user_id, placa, status)
       VALUES ($1, $2, 'C4RLS02', 'ativo')
       ON CONFLICT (id) DO NOTHING`,
      [VEHICLE_UNCLAIMED_ID, OWNER_ID],
    );
    await session.query(
      `INSERT INTO public.despesas (id, user_id, vehicle_id, categoria, valor, descricao, created_at)
       VALUES ($1, $2, $3, 'Combustível', 50, 'pré-claim', $4)`,
      [DESPESA_PRE_CLAIM_ID, OWNER_ID, VEHICLE_CLAIMED_ID, PRE_CLAIM_CREATED_AT],
    );
    await session.query(
      `INSERT INTO public.despesas (id, user_id, vehicle_id, categoria, valor, descricao, created_at)
       VALUES ($1, $2, $3, 'Combustível', 50, 'pós-claim', $4)`,
      [DESPESA_POST_CLAIM_ID, OWNER_ID, VEHICLE_CLAIMED_ID, POST_CLAIM_CREATED_AT],
    );
    await session.query(
      `INSERT INTO public.despesas (id, user_id, vehicle_id, categoria, valor, descricao)
       VALUES ($1, $2, $3, 'Combustível', 50, 'unclaimed A')`,
      [DESPESA_UNCLAIMED_A_ID, OWNER_ID, VEHICLE_UNCLAIMED_ID],
    );
    await session.query(
      `INSERT INTO public.despesas (id, user_id, vehicle_id, categoria, valor, descricao)
       VALUES ($1, $2, $3, 'Combustível', 50, 'unclaimed B')`,
      [DESPESA_UNCLAIMED_B_ID, OWNER_ID, VEHICLE_UNCLAIMED_ID],
    );
    await session.commit();

    // claimed_at é congelada pelo trigger C3 — precisa ser setada via
    // caminho privilegiado (mesmo que claimArchivedVehicleFn usa), não
    // via INSERT direto (que a força pra NULL).
    await asServiceRole(session, async () => {
      await session.query(
        `UPDATE public.veiculos SET claimed_at = $2 WHERE id = $1`,
        [VEHICLE_CLAIMED_ID, CLAIMED_AT],
      );
    });
  });

  afterAll(async () => {
    try {
      await session.begin();
      await cleanupAll(session);
      await session.commit();
    } finally {
      await session?.close();
    }
  });

  test("regressão: dono do veículo com claimed_at só vê despesas posteriores ao claim", async () => {
    let ids: string[] = [];
    await asUser(session, OWNER_ID, async () => {
      const r = await session.query<{ id: string }>(
        `SELECT id FROM public.despesas WHERE vehicle_id = $1`,
        [VEHICLE_CLAIMED_ID],
      );
      ids = r.rows.map((row) => row.id);
    });

    expect(ids.length).toBe(1);
    expect(ids[0]).toBe(DESPESA_POST_CLAIM_ID);
  });

  test("controle: veículo sem claimed_at (NULL) — dono vê todas as despesas", async () => {
    let ids: string[] = [];
    await asUser(session, OWNER_ID, async () => {
      const r = await session.query<{ id: string }>(
        `SELECT id FROM public.despesas WHERE vehicle_id = $1 ORDER BY descricao`,
        [VEHICLE_UNCLAIMED_ID],
      );
      ids = r.rows.map((row) => row.id);
    });

    expect(ids.length).toBe(2);
    expect(ids).toContain(DESPESA_UNCLAIMED_A_ID);
    expect(ids).toContain(DESPESA_UNCLAIMED_B_ID);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[RLS-Regression C4] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
