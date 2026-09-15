/**
 * RLS-Regression-Tests — C1: a policy de INSERT em pagamentos_pix ("Users
 * can insert own payments") foi removida por completo (Security-Audit-
 * Fixes, PR #107) — não existe mais NENHUM caminho de INSERT direto para
 * authenticated nessa tabela, nem mesmo com user_id=próprio e valores
 * "razoáveis". O GRANT INSERT pra authenticated continua de pé (é só
 * privilégio de tabela, não RLS), então o teste precisa provar que é a
 * ausência de policy — não a falta de GRANT — que bloqueia.
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

const VEHICLE_ID = "33333333-3333-4333-8333-000000001101";
const PAYMENT_SERVICE_ROLE_ID = "33333333-3333-4333-8333-000000001102";

async function seedVehicle(session: Session): Promise<void> {
  await session.query("SET LOCAL search_path = public");
  await session.query(
    `INSERT INTO public.veiculos (id, user_id, placa, status)
     VALUES ($1, $2, 'C1RLS01', 'ativo')
     ON CONFLICT (id) DO NOTHING`,
    [VEHICLE_ID, OWNER_ID],
  );
}

async function cleanupAll(session: Session): Promise<void> {
  await session.query("SET LOCAL search_path = public");
  await session.query(`DELETE FROM public.pagamentos_pix WHERE veiculo_id = $1`, [VEHICLE_ID]);
  await session.query(`DELETE FROM public.veiculos WHERE id = $1`, [VEHICLE_ID]);
  await cleanupUsers(session);
}

describeIfDb("RLS-Regression C1 — pagamentos_pix INSERT (policy removida)", () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession("rls-c1-setup");
    await session.begin();
    await cleanupAll(session);
    await session.commit();
    await session.begin();
    await seedUsers(session);
    await seedVehicle(session);
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

  test("controle: INSERT via service_role funciona", async () => {
    await asServiceRole(session, async () => {
      await session.query(
        `INSERT INTO public.pagamentos_pix (id, user_id, veiculo_id, valor, status, tipo_produto)
         VALUES ($1, $2, $3, 29.9, 'pendente', 'ativacao')`,
        [PAYMENT_SERVICE_ROLE_ID, OWNER_ID, VEHICLE_ID],
      );
    });

    const check = await session.query<{ id: string }>(
      `SELECT id FROM public.pagamentos_pix WHERE id = $1`,
      [PAYMENT_SERVICE_ROLE_ID],
    );
    expect(check.rows.length).toBe(1);
  });

  test("regressão: INSERT via authenticated (mesmo com user_id próprio) é rejeitado", async () => {
    let threw = false;
    let message = "";
    try {
      await asUser(session, OWNER_ID, async () => {
        await session.query(
          `INSERT INTO public.pagamentos_pix (user_id, veiculo_id, valor, status, tipo_produto)
           VALUES ($1, $2, 29.9, 'pendente', 'ativacao')`,
          [OWNER_ID, VEHICLE_ID],
        );
      });
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    expect(threw).toBe(true);
    expect(message).toContain("row-level security");
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[RLS-Regression C1] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
