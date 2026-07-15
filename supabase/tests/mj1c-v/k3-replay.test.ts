/**
 * MJ1C-V — Cenário K3: replay durável. Mesma setup do K1; chama a RPC
 * duas vezes consecutivas com os mesmos parâmetros. A segunda chamada
 * deve retornar kind='replayed' com previousKm/newKm idênticos, sem
 * criar segunda linha em whatsapp_action_executions e sem re-escrever
 * o veículo.
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
const ORCH_VERSION = "mj1cv-k3-v1";

type ExecResult = {
  kind: string;
  actionExecutionId?: string;
  previousKm?: number | null;
  newKm?: number | null;
};

describeIfDb("MJ1C-V K3 — replay", () => {
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

  test("segunda chamada idêntica -> replayed, sem duplicar exec nem re-escrever", async () => {
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
    const msgId = await seedConfirmationMessage(setup, "K3 confirm");
    const params = [
      draftId, stateId, msgId, msgId, crypto.randomUUID(),
      SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
      null, 500, false, false, null, 1, ORCH_VERSION,
    ];

    const r1 = await setup.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      params,
    );
    const first = r1.rows[0]?.execute_whatsapp_km_update;
    expect(first?.kind).toBe("applied");
    expect(first?.newKm).toBe(500);

    const r2 = await setup.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      params,
    );
    const second = r2.rows[0]?.execute_whatsapp_km_update;
    expect(second?.kind).toBe("replayed");
    expect(second?.previousKm).toBe(first?.previousKm ?? null);
    expect(second?.newKm).toBe(500);
    expect(second?.actionExecutionId).toBe(first?.actionExecutionId as string);

    const exec = await setup.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_action_executions
        where draft_id = $1 and action_type = 'km_update'`,
      [draftId],
    );
    expect(Number(exec.rows[0]?.n ?? "0")).toBe(1);

    const veh = await setup.query<{ km_atual: number | null }>(
      `select km_atual from public.veiculos where id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(veh.rows[0]?.km_atual).toBe(500);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1C-V K3] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
