/**
 * MJ2A-V E12 — Concorrência real: duas sessões pg físicas independentes
 * (PIDs distintos), ambas com transação já aberta, chamam a RPC com o
 * mesmo draft_id via Promise.all.
 *
 * A trava que resolve a corrida é o pg_advisory_xact_lock derivado de
 * hashtextextended(draft_id || '|expense_create'), adquirido logo no
 * início da RPC — ele serializa as duas transações ANTES de qualquer
 * uma chegar no INSERT ou na leitura de whatsapp_action_executions.
 *
 * Espera: uma retorna 'applied', a outra 'replayed'. Uma única linha em
 * despesas e uma única em whatsapp_action_executions.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  SYNTH_CONTACT_ID,
  SYNTH_USER_ID,
  SYNTH_VEHICLE_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  seedBaseFixtures,
  seedConfirmationMessage,
  seedConversationState,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;
const ORCH = "mj2av-e12-v1";

type Result = {
  kind: string;
  actionExecutionId?: string;
  despesaId?: string;
};

describeIfDb("MJ2A-V E12 — concorrência real no mesmo draft_id", () => {
  let setup: Session;
  let ctl: Session;
  let a: Session;
  let b: Session;

  beforeAll(async () => {
    setup = await openSession("setup");
    ctl = await openSession("ctl");
    a = await openSession("A");
    b = await openSession("B");
    if (a.backendPid === b.backendPid) {
      throw new Error("PIDs iguais — sessões não são físicas independentes");
    }
    await setup.begin();
    await cleanupBaseFixtures(setup);
    await setup.commit();
    await setup.begin();
    await seedBaseFixtures(setup);
    await setup.commit();
  });

  afterAll(async () => {
    try {
      await setup.begin();
      await cleanupBaseFixtures(setup);
      await setup.commit();
      const residue = await countSyntheticResidue(setup);
      if (residue !== 0) throw new Error(`resíduo != 0: ${residue}`);
    } finally {
      await a?.close();
      await b?.close();
      await ctl?.close();
      await setup?.close();
    }
  });

  test("advisory lock serializa: uma applied, outra replayed", async () => {
    const draftId = crypto.randomUUID();
    const stateId = await seedConversationState(setup, {
      draftId,
      state: "awaiting_expense_confirmation",
      draftPayload: {
        phase: "awaiting_confirmation",
        categoria: "Combustível",
        valor: 80,
        vehicleId: SYNTH_VEHICLE_ID,
        requestMessageId: draftId,
      },
      stateVersion: 1,
    });
    const msgId = await seedConfirmationMessage(setup, "E12");

    const params = [
      draftId, stateId, msgId, msgId, crypto.randomUUID(),
      SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
      "Combustível", 80, null, 1, ORCH,
    ];

    // Abre transação em ambas ANTES do Promise.all — concorrência de
    // duas conexões físicas, não Promise.all de queries na mesma conexão.
    await a.begin();
    await b.begin();

    const call = (s: Session) =>
      s.query<{ execute_whatsapp_expense_create: Result }>(
        `select public.execute_whatsapp_expense_create(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
         ) as execute_whatsapp_expense_create`,
        params,
      );

    const [rA, rB] = await Promise.all([call(a), call(b)]);
    await a.commit();
    await b.commit();

    const resA = rA.rows[0]?.execute_whatsapp_expense_create;
    const resB = rB.rows[0]?.execute_whatsapp_expense_create;
    const kinds = [resA?.kind, resB?.kind].sort();
    expect(kinds).toEqual(["applied", "replayed"]);

    const applied = resA?.kind === "applied" ? resA : resB;
    const replayed = resA?.kind === "replayed" ? resA : resB;
    expect(replayed?.despesaId).toBe(applied?.despesaId as string);
    expect(replayed?.actionExecutionId).toBe(
      applied?.actionExecutionId as string,
    );

    const desp = await ctl.query<{ n: string }>(
      `select count(*)::text as n from public.despesas
        where vehicle_id = $1 and user_id = $2`,
      [SYNTH_VEHICLE_ID, SYNTH_USER_ID],
    );
    expect(Number(desp.rows[0]?.n ?? "0")).toBe(1);

    const exec = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_action_executions
        where draft_id = $1 and action_type = 'expense_create'`,
      [draftId],
    );
    expect(Number(exec.rows[0]?.n ?? "0")).toBe(1);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ2A-V E12] skipped: TEST_DATABASE_URL ausente");
}
