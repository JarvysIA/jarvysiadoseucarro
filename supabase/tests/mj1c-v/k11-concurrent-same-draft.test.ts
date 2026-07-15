/**
 * MJ1C-V — Cenário K11: concorrência real no mesmo draft_id. Duas sessões
 * físicas independentes chamam a RPC com os MESMOS parâmetros ao mesmo
 * tempo. A defesa esperada é o pg_advisory_xact_lock que a própria função
 * adquire logo no início (hashtextextended sobre draft_id||'|km_update').
 *
 * Sessão A abre transação, chama a RPC, NÃO commita ainda. Sessão B chama
 * a RPC com os mesmos parâmetros e deve BLOQUEAR de verdade no advisory
 * lock. Provamos o bloqueio via polling em pg_stat_activity
 * (wait_event_type='Lock') no backendPid de B, igual ao padrão do
 * mj1b-v/o4-apply-cas-lock.test.ts. Só então A commita; B destrava e
 * devolve 'replayed'.
 *
 * Invariantes: veiculos.km_atual = 500 (uma única escrita), exatamente
 * 1 linha em whatsapp_action_executions.
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
  setVehicleKm,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;
const ORCH_VERSION = "mj1cv-k11-v1";
const POLL_INTERVAL_MS = 25;
const POLL_TIMEOUT_MS = 5_000;

type ExecResult = {
  kind: string;
  actionExecutionId?: string;
  previousKm?: number | null;
  newKm?: number | null;
};

async function waitFor(
  probe: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`timeout aguardando: ${label}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function waitingOnRowLock(ctl: Session, pid: number): Promise<boolean> {
  const r = await ctl.query<{ n: string }>(
    `select count(*)::text as n
       from pg_stat_activity
      where pid = $1 and wait_event_type = 'Lock'`,
    [pid],
  );
  return Number(r.rows[0]?.n ?? "0") > 0;
}

describeIfDb("MJ1C-V K11 — concorrência real no mesmo draft_id", () => {
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
      if (residue !== 0) {
        throw new Error(`resíduo sintético != 0 após cleanup: ${residue}`);
      }
    } finally {
      await a?.close();
      await b?.close();
      await ctl?.close();
      await setup?.close();
    }
  });

  test("B bloqueia no advisory lock e depois replaya", async () => {
    await setVehicleKm(setup, SYNTH_VEHICLE_ID, null);

    const draftId = crypto.randomUUID();
    const stateId = await seedConversationState(setup, {
      draftId,
      state: "awaiting_km_confirmation",
      draftPayload: {
        vehicleId: SYNTH_VEHICLE_ID,
        newKm: 500,
        expectedPreviousKm: null,
        isCorrection: false,
      },
      stateVersion: 1,
    });
    const msgId = await seedConfirmationMessage(setup, "K11 confirm");

    const params = [
      draftId, stateId, msgId, msgId, crypto.randomUUID(),
      SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
      null, 500, false, false, null, 1, ORCH_VERSION,
    ];

    // A: abre transação, chama a RPC (adquire advisory lock por draft_id),
    // NÃO commita ainda.
    await a.begin();
    const rA = await a.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      params,
    );
    const resA = rA.rows[0]?.execute_whatsapp_km_update;
    expect(resA?.kind).toBe("applied");
    expect(resA?.newKm).toBe(500);

    // B: tenta com os mesmos parâmetros — bloqueia no advisory lock.
    const pB = b.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      params,
    );

    await waitFor(
      () => waitingOnRowLock(ctl, b.backendPid),
      POLL_TIMEOUT_MS,
      "B bloquear no advisory lock por draft_id (segurado por A)",
    );

    // A commita — libera o advisory lock.
    await a.commit();

    const resB = (await pB).rows[0]?.execute_whatsapp_km_update;
    expect(resB?.kind).toBe("replayed");
    expect(resB?.newKm).toBe(500);
    expect(resB?.actionExecutionId).toBe(resA?.actionExecutionId as string);

    const veh = await ctl.query<{ km_atual: number | null }>(
      `select km_atual from public.veiculos where id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(veh.rows[0]?.km_atual).toBe(500);

    const exec = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_action_executions
        where draft_id = $1 and action_type = 'km_update'`,
      [draftId],
    );
    expect(Number(exec.rows[0]?.n ?? "0")).toBe(1);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1C-V K11] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
