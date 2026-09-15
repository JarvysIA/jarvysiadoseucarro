/**
 * Fix-Profile-Additional-Columns — testes de
 * protect_privileged_profile_columns() cobrindo a extensão desta build
 * (trial_inicio, asaas_customer_id). Mirror do mesmo padrão usado em
 * mj2b-v/f2-chain-rejected-retry.test.ts pra simular contexto privilegiado
 * (set_config('request.jwt.claims', ..., true) dentro de uma transação
 * explícita — a sessão de teste é um pg.Client direto, sem PostgREST, então
 * auth.role() só retorna 'service_role' se o GUC for setado manualmente).
 *
 * Sem simular nada, esta sessão de teste é exatamente o caso
 * "não-privilegiado" que o trigger deve barrar — não precisa de nenhum
 * truque extra pra testar o caminho bloqueado, só o caminho liberado.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  SYNTH_USER_ID,
  cleanupProfile,
  countSyntheticResidue,
  fetchPrivilegedColumns,
  seedProfile,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

/** Roda um UPDATE simulando uma chamada service_role real (ex: um fluxo
 * chamado via supabaseAdmin) — precisa de transação explícita porque
 * set_config(..., true) é local à transação corrente. */
async function updateAsServiceRole(
  session: Session,
  sql: string,
  params?: unknown[],
): Promise<void> {
  await session.begin();
  await session.query(
    `select set_config('request.jwt.claims', '{"role":"service_role"}', true)`,
  );
  await session.query(sql, params);
  await session.commit();
}

describeIfDb("Fix-Profile-Additional-Columns — protect_privileged_profile_columns", () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession("setup");
    await session.begin();
    await cleanupProfile(session);
    await session.commit();
    await session.begin();
    await seedProfile(session);
    await session.commit();
  });

  afterAll(async () => {
    try {
      await session.begin();
      await cleanupProfile(session);
      await session.commit();
      const residue = await countSyntheticResidue(session);
      if (residue !== 0) {
        throw new Error(`resíduo sintético != 0 após cleanup: ${residue}`);
      }
    } finally {
      await session?.close();
    }
  });

  test("trial_inicio: UPDATE não-privilegiado de NULL para timestamp passa normalmente", async () => {
    const before = await fetchPrivilegedColumns(session, SYNTH_USER_ID);
    expect(before.trial_inicio).toBeNull();

    const nowIso = new Date().toISOString();
    await session.query(
      `update public.profiles set trial_inicio = $2 where id = $1`,
      [SYNTH_USER_ID, nowIso],
    );

    const after = await fetchPrivilegedColumns(session, SYNTH_USER_ID);
    expect(after.trial_inicio).not.toBeNull();
  });

  test("trial_inicio: UPDATE não-privilegiado tentando resetar para NULL é revertido depois de já setado", async () => {
    // Precondição: garante trial_inicio já setado via caminho privilegiado
    // (independe do teste anterior — isolamento explícito).
    const fixedIso = "2026-01-01T00:00:00.000Z";
    await updateAsServiceRole(
      session,
      `update public.profiles set trial_inicio = $2 where id = $1`,
      [SYNTH_USER_ID, fixedIso],
    );
    const before = await fetchPrivilegedColumns(session, SYNTH_USER_ID);
    expect(before.trial_inicio).not.toBeNull();

    // Tentativa de reset via conexão não-privilegiada (sem request.jwt.claims).
    await session.query(
      `update public.profiles set trial_inicio = NULL where id = $1`,
      [SYNTH_USER_ID],
    );

    const after = await fetchPrivilegedColumns(session, SYNTH_USER_ID);
    expect(after.trial_inicio).not.toBeNull();
    expect(after.trial_inicio).toBe(before.trial_inicio);
  });

  test("trial_inicio: UPDATE via service_role consegue alterar mesmo já setado", async () => {
    const newIso = "2026-06-15T12:00:00.000Z";
    await updateAsServiceRole(
      session,
      `update public.profiles set trial_inicio = $2 where id = $1`,
      [SYNTH_USER_ID, newIso],
    );

    const after = await fetchPrivilegedColumns(session, SYNTH_USER_ID);
    expect(after.trial_inicio).toBe(newIso);
  });

  test("asaas_customer_id: UPDATE não-privilegiado tentando trocar o valor é revertido", async () => {
    // Precondição: valor legítimo setado via caminho privilegiado (mesma
    // classe de chamada que gerar-pix-asaas/index.ts faz com service_role).
    const legitId = "cus_legit_owner_123";
    await updateAsServiceRole(
      session,
      `update public.profiles set asaas_customer_id = $2 where id = $1`,
      [SYNTH_USER_ID, legitId],
    );
    const before = await fetchPrivilegedColumns(session, SYNTH_USER_ID);
    expect(before.asaas_customer_id).toBe(legitId);

    // Tentativa de troca via conexão não-privilegiada.
    await session.query(
      `update public.profiles set asaas_customer_id = $2 where id = $1`,
      [SYNTH_USER_ID, "cus_attacker_999"],
    );

    const after = await fetchPrivilegedColumns(session, SYNTH_USER_ID);
    expect(after.asaas_customer_id).toBe(legitId);
  });

  test("asaas_customer_id: UPDATE via service_role consegue alterar o valor", async () => {
    const newId = "cus_legit_owner_456";
    await updateAsServiceRole(
      session,
      `update public.profiles set asaas_customer_id = $2 where id = $1`,
      [SYNTH_USER_ID, newId],
    );

    const after = await fetchPrivilegedColumns(session, SYNTH_USER_ID);
    expect(after.asaas_customer_id).toBe(newId);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log(
    "[Fix-Profile-Additional-Columns] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)",
  );
}
