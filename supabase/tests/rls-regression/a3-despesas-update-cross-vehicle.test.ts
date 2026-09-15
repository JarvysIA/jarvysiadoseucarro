/**
 * RLS-Regression-Tests — A3: a policy de UPDATE em despesas ("Users
 * update own despesas") passou a exigir, no WITH CHECK, que o NOVO
 * vehicle_id também pertença ao usuário (Fix-Despesas-Update-Ownership,
 * este mesmo build). Diferente de C3 (trigger reverte silenciosamente),
 * aqui é RLS pura — quando a linha alvo é encontrada pelo USING (despesa
 * já é do usuário) mas o resultado da UPDATE viola o WITH CHECK (novo
 * vehicle_id não pertence a ele), o Postgres lança ERRO de verdade ("new
 * row violates row-level security policy"), igual ao INSERT de C1 — não
 * é um "0 linhas afetadas" silencioso.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  OWNER_ID,
  VICTIM_ID,
  asUser,
  cleanupUsers,
  seedUsers,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

const VEHICLE_OWNER_1_ID = "33333333-3333-4333-8333-000000005101";
const VEHICLE_OWNER_2_ID = "33333333-3333-4333-8333-000000005102";
const VEHICLE_VICTIM_ID = "44444444-4444-4444-8444-000000005103";

const DESPESA_MOVE_OWN_ID = "33333333-3333-4333-8333-000000005201";
const DESPESA_MOVE_CROSS_ID = "33333333-3333-4333-8333-000000005202";
const DESPESA_EDIT_ONLY_ID = "33333333-3333-4333-8333-000000005203";

const VEHICLE_IDS = [VEHICLE_OWNER_1_ID, VEHICLE_OWNER_2_ID, VEHICLE_VICTIM_ID];
const DESPESA_IDS = [DESPESA_MOVE_OWN_ID, DESPESA_MOVE_CROSS_ID, DESPESA_EDIT_ONLY_ID];

async function cleanupAll(session: Session): Promise<void> {
  await session.query("SET LOCAL search_path = public");
  await session.query(`DELETE FROM public.despesas WHERE id = ANY($1::uuid[])`, [DESPESA_IDS]);
  await session.query(`DELETE FROM public.veiculos WHERE id = ANY($1::uuid[])`, [VEHICLE_IDS]);
  await cleanupUsers(session);
}

describeIfDb("RLS-Regression A3 — despesas UPDATE (cross-vehicle ownership)", () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession("rls-a3-setup");
    await session.begin();
    await cleanupAll(session);
    await session.commit();

    await session.begin();
    await seedUsers(session);
    await session.query(
      `INSERT INTO public.veiculos (id, user_id, placa, status)
       VALUES ($1, $2, 'A3RLS01', 'ativo')`,
      [VEHICLE_OWNER_1_ID, OWNER_ID],
    );
    await session.query(
      `INSERT INTO public.veiculos (id, user_id, placa, status)
       VALUES ($1, $2, 'A3RLS02', 'ativo')`,
      [VEHICLE_OWNER_2_ID, OWNER_ID],
    );
    await session.query(
      `INSERT INTO public.veiculos (id, user_id, placa, status)
       VALUES ($1, $2, 'A3RLS03', 'ativo')`,
      [VEHICLE_VICTIM_ID, VICTIM_ID],
    );
    for (const [id, descricao] of [
      [DESPESA_MOVE_OWN_ID, "mover entre próprios"],
      [DESPESA_MOVE_CROSS_ID, "tentativa cross-user"],
      [DESPESA_EDIT_ONLY_ID, "editar outro campo"],
    ] as const) {
      await session.query(
        `INSERT INTO public.despesas (id, user_id, vehicle_id, categoria, valor, descricao)
         VALUES ($1, $2, $3, 'Combustível', 50, $4)`,
        [id, OWNER_ID, VEHICLE_OWNER_1_ID, descricao],
      );
    }
    await session.commit();
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

  test("controle: mover despesa entre 2 veículos do MESMO dono funciona", async () => {
    await asUser(session, OWNER_ID, async () => {
      await session.query(
        `UPDATE public.despesas SET vehicle_id = $2 WHERE id = $1`,
        [DESPESA_MOVE_OWN_ID, VEHICLE_OWNER_2_ID],
      );
    });

    const check = await session.query<{ vehicle_id: string }>(
      `SELECT vehicle_id FROM public.despesas WHERE id = $1`,
      [DESPESA_MOVE_OWN_ID],
    );
    expect(check.rows[0]?.vehicle_id).toBe(VEHICLE_OWNER_2_ID);
  });

  test("regressão: mover despesa pro veículo de OUTRO usuário é rejeitado", async () => {
    let threw = false;
    let message = "";
    try {
      await asUser(session, OWNER_ID, async () => {
        await session.query(
          `UPDATE public.despesas SET vehicle_id = $2 WHERE id = $1`,
          [DESPESA_MOVE_CROSS_ID, VEHICLE_VICTIM_ID],
        );
      });
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    expect(threw).toBe(true);
    expect(message).toContain("row-level security");

    const check = await session.query<{ vehicle_id: string }>(
      `SELECT vehicle_id FROM public.despesas WHERE id = $1`,
      [DESPESA_MOVE_CROSS_ID],
    );
    expect(check.rows[0]?.vehicle_id).toBe(VEHICLE_OWNER_1_ID);
  });

  test("controle: editar outro campo sem tocar vehicle_id funciona normalmente", async () => {
    await asUser(session, OWNER_ID, async () => {
      await session.query(
        `UPDATE public.despesas SET descricao = 'editado' WHERE id = $1`,
        [DESPESA_EDIT_ONLY_ID],
      );
    });

    const check = await session.query<{ descricao: string; vehicle_id: string }>(
      `SELECT descricao, vehicle_id FROM public.despesas WHERE id = $1`,
      [DESPESA_EDIT_ONLY_ID],
    );
    expect(check.rows[0]?.descricao).toBe("editado");
    expect(check.rows[0]?.vehicle_id).toBe(VEHICLE_OWNER_1_ID);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[RLS-Regression A3] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
