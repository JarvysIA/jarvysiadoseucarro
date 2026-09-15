/**
 * RLS-Regression-Tests — C3: trigger proteger_colunas_privilegiadas_veiculo
 * (Security-Audit-Fixes, PR #107) congela status/history_locked (entre
 * outras) contra UPDATE direto de não-privilegiados, revertendo
 * silenciosamente pro valor OLD — sem erro de RLS, porque a policy de
 * UPDATE em veiculos ("Users can update their own vehicles") só valida
 * ownership (auth.uid()=user_id), nunca o CONTEÚDO da coluna; quem barra
 * o conteúdo é o trigger, não a RLS. Por isso o teste de regressão espera
 * "UPDATE não dá erro, mas o valor não muda" — diferente de C1/A3, que
 * esperam erro de RLS de verdade.
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

const VEHICLE_ID = "33333333-3333-4333-8333-000000003101";

type VeiculoRow = { status: string; history_locked: boolean; km_atual: number | null };

async function fetchVehicle(session: Session): Promise<VeiculoRow> {
  const r = await session.query<VeiculoRow>(
    `SELECT status, history_locked, km_atual FROM public.veiculos WHERE id = $1`,
    [VEHICLE_ID],
  );
  const row = r.rows[0];
  if (!row) throw new Error("veículo de teste não encontrado");
  return row;
}

// Usa asServiceRole (não uma UPDATE "crua") de propósito: uma UPDATE
// direta nesta sessão (superuser, sem GUC de privilégio) também passaria
// pelo trigger e seria revertida pro valor ATUAL — o que mascararia bugs
// de ordenação entre testes (o reset só "funcionaria por acidente" se o
// valor alvo já coincidisse com o estado corrente). asServiceRole garante
// que o reset realmente acontece, sempre, independente da ordem.
async function resetVehicle(session: Session): Promise<void> {
  await asServiceRole(session, async () => {
    await session.query(
      `UPDATE public.veiculos SET status = 'archived', history_locked = true, km_atual = 1000
       WHERE id = $1`,
      [VEHICLE_ID],
    );
  });
}

async function cleanupAll(session: Session): Promise<void> {
  await session.query("SET LOCAL search_path = public");
  await session.query(`DELETE FROM public.veiculos WHERE id = $1`, [VEHICLE_ID]);
  await cleanupUsers(session);
}

describeIfDb("RLS-Regression C3 — veiculos UPDATE (proteger_colunas_privilegiadas_veiculo)", () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession("rls-c3-setup");
    await session.begin();
    await cleanupAll(session);
    await session.commit();
    await session.begin();
    await seedUsers(session);
    // status='archived', history_locked=true — estado inicial DIFERENTE
    // do valor que a tentativa maliciosa vai tentar setar (status='ativo',
    // history_locked=false), pra que a reversão seja observável.
    await session.query(
      `INSERT INTO public.veiculos (id, user_id, placa, status, history_locked, km_atual)
       VALUES ($1, $2, 'C3RLS01', 'archived', true, 1000)
       ON CONFLICT (id) DO NOTHING`,
      [VEHICLE_ID, OWNER_ID],
    );
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

  test("controle: como dono comum, UPDATE km_atual funciona", async () => {
    await asUser(session, OWNER_ID, async () => {
      await session.query(
        `UPDATE public.veiculos SET km_atual = 12345 WHERE id = $1`,
        [VEHICLE_ID],
      );
    });

    const row = await fetchVehicle(session);
    expect(row.km_atual).toBe(12345);
  });

  test("regressão: como dono comum, UPDATE tentando destravar/ativar é revertido silenciosamente (sem erro)", async () => {
    await resetVehicle(session);
    const before = await fetchVehicle(session);
    expect(before.status).toBe("archived");
    expect(before.history_locked).toBe(true);

    let threw = false;
    try {
      await asUser(session, OWNER_ID, async () => {
        await session.query(
          `UPDATE public.veiculos SET status = 'ativo', history_locked = false WHERE id = $1`,
          [VEHICLE_ID],
        );
      });
    } catch {
      threw = true;
    }

    // Comportamento ESPERADO do trigger: reverte, não dá erro de RLS.
    expect(threw).toBe(false);

    const after = await fetchVehicle(session);
    expect(after.status).toBe("archived");
    expect(after.history_locked).toBe(true);
  });

  test("controle: mesmo UPDATE via service_role consegue destravar/ativar de verdade", async () => {
    await resetVehicle(session);
    const before = await fetchVehicle(session);
    expect(before.status).toBe("archived");
    expect(before.history_locked).toBe(true);

    await asServiceRole(session, async () => {
      await session.query(
        `UPDATE public.veiculos SET status = 'ativo', history_locked = false WHERE id = $1`,
        [VEHICLE_ID],
      );
    });

    const after = await fetchVehicle(session);
    expect(after.status).toBe("ativo");
    expect(after.history_locked).toBe(false);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[RLS-Regression C3] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
