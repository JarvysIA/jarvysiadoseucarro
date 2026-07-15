/**
 * MJ1C-V — Cenário K4: km_conflict. Draft foi criado esperando km atual
 * 50000, mas alguém alterou o veículo para 60000 antes da confirmação
 * chegar. A RPC deve devolver 'conflicted'/km_conflict com currentKm=60000
 * e NÃO deve criar linha em whatsapp_action_executions (CAS perdeu antes
 * de registrar execução).
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
const ORCH_VERSION = "mj1cv-k4-v1";

type ExecResult = { kind: string; reason?: string; currentKm?: number | null };

describeIfDb("MJ1C-V K4 — km_conflict", () => {
  let setup: Session;

  beforeAll(async () => {
    setup = await openSession("setup");
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
      await setup?.close();
    }
  });

  test("km_atual real diverge do expected_previous_km -> km_conflict", async () => {
    await setVehicleKm(setup, SYNTH_VEHICLE_ID, 50000);

    const draftId = crypto.randomUUID();
    const stateId = await seedConversationState(setup, {
      draftId,
      state: "awaiting_km_confirmation",
      draftPayload: {
        vehicleId: SYNTH_VEHICLE_ID,
        newKm: 55000,
        expectedPreviousKm: 50000,
        isCorrection: false,
      },
      stateVersion: 2,
    });
    const msgId = await seedConfirmationMessage(setup, "K4 confirm");

    // Simula que o carro pulou pra 60000 entre draft e confirmação.
    await setVehicleKm(setup, SYNTH_VEHICLE_ID, 60000);

    const r = await setup.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      [
        draftId, stateId, msgId, msgId, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
        50000, 55000, false, false, null, 2, ORCH_VERSION,
      ],
    );
    const result = r.rows[0]?.execute_whatsapp_km_update;
    expect(result?.kind).toBe("conflicted");
    expect(result?.reason).toBe("km_conflict");
    expect(result?.currentKm).toBe(60000);

    const exec = await setup.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_action_executions
        where draft_id = $1 and action_type = 'km_update'`,
      [draftId],
    );
    expect(Number(exec.rows[0]?.n ?? "0")).toBe(0);

    const veh = await setup.query<{ km_atual: number | null }>(
      `select km_atual from public.veiculos where id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(veh.rows[0]?.km_atual).toBe(60000);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1C-V K4] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
