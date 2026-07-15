/**
 * MJ1C-V — Cenário K2: no_op. Veículo já tem km_atual = 30000 e o draft
 * pede exatamente 30000. A RPC não deve escrever no veículo, mas ainda
 * assim registra 1 linha em whatsapp_action_executions com outcome 'no_op'.
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
const ORCH_VERSION = "mj1cv-k2-v1";

type ExecResult = { kind: string; currentKm?: number; actionExecutionId?: string };

describeIfDb("MJ1C-V K2 — no_op", () => {
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

  test("km igual ao atual -> no_op, veículo inalterado, exec registrada", async () => {
    await setVehicleKm(setup, SYNTH_VEHICLE_ID, 30000);

    const draftId = crypto.randomUUID();
    const stateId = await seedConversationState(setup, {
      draftId,
      state: "awaiting_km_confirmation",
      draftPayload: {
        vehicleId: SYNTH_VEHICLE_ID,
        newKm: 30000,
        expectedPreviousKm: 30000,
        isCorrection: false,
      },
      stateVersion: 3,
    });
    const msgId = await seedConfirmationMessage(setup, "K2 confirm");

    const r = await setup.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      [
        draftId, stateId, msgId, msgId, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
        30000, 30000, false, false, null, 3, ORCH_VERSION,
      ],
    );
    const result = r.rows[0]?.execute_whatsapp_km_update;
    expect(result?.kind).toBe("no_op");
    expect(result?.currentKm).toBe(30000);
    expect(result?.actionExecutionId).toBeTruthy();

    const veh = await setup.query<{ km_atual: number | null }>(
      `select km_atual from public.veiculos where id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(veh.rows[0]?.km_atual).toBe(30000);

    const exec = await setup.query<{
      n: string;
      status: string;
      outcome: string | null;
    }>(
      `select count(*)::text as n,
              max(status) as status,
              max(result_payload->>'outcome') as outcome
         from public.whatsapp_action_executions
        where draft_id = $1 and action_type = 'km_update'`,
      [draftId],
    );
    expect(Number(exec.rows[0]?.n ?? "0")).toBe(1);
    expect(exec.rows[0]?.status).toBe("succeeded");
    expect(exec.rows[0]?.outcome).toBe("no_op");
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1C-V K2] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
