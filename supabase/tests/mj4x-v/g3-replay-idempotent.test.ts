/**
 * MJ4x-V — Cenário G3: replay (mesma chamada 2x) não liga a despesa duas
 * vezes nem quebra — a segunda chamada retorna 'replayed' e o UPDATE de
 * despesas é bloqueado pela trava km_registro IS NULL (já setado na 1a).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  SYNTH_CONTACT_ID,
  SYNTH_USER_ID,
  SYNTH_VEHICLE_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  fetchDespesaKmRegistro,
  seedBaseFixtures,
  seedConfirmationMessage,
  seedConversationState,
  seedDespesa,
  setVehicleKm,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

const ORCH_VERSION = "mj4xv-g3-v1";

type ExecResult = { kind: string; newKm?: number | null };

describeIfDb("MJ4x-V G3 — replay não reprocessa a ligação", () => {
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

  test("2a chamada idêntica -> replayed, despesa continua ligada ao mesmo valor", async () => {
    await setVehicleKm(setup, SYNTH_VEHICLE_ID, null);
    const despesaId = await seedDespesa(setup, {
      userId: SYNTH_USER_ID,
      vehicleId: SYNTH_VEHICLE_ID,
      kmRegistro: null,
    });

    const draftId = crypto.randomUUID();
    const stateId = await seedConversationState(setup, {
      draftId,
      state: "awaiting_km_confirmation",
      draftPayload: {
        vehicleId: SYNTH_VEHICLE_ID,
        newKm: 700,
        expectedPreviousKm: null,
        isCorrection: false,
        linkedExpenseId: despesaId,
      },
      stateVersion: 1,
    });
    const msgId = await seedConfirmationMessage(setup, "G3 confirm");
    const queueItemId = crypto.randomUUID();

    const params = [
      draftId, stateId, msgId, msgId, queueItemId,
      SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
      null, 700, false, false, null,
      1, ORCH_VERSION,
      despesaId,
    ];

    const r1 = await setup.query<{ execute_whatsapp_km_update_with_expense_link: ExecResult }>(
      `select public.execute_whatsapp_km_update_with_expense_link(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       ) as execute_whatsapp_km_update_with_expense_link`,
      params,
    );
    expect(r1.rows[0]?.execute_whatsapp_km_update_with_expense_link.kind).toBe("applied");

    const kmAfterFirst = await fetchDespesaKmRegistro(setup, despesaId);
    expect(kmAfterFirst).toBe(700);

    const r2 = await setup.query<{ execute_whatsapp_km_update_with_expense_link: ExecResult }>(
      `select public.execute_whatsapp_km_update_with_expense_link(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       ) as execute_whatsapp_km_update_with_expense_link`,
      params,
    );
    expect(r2.rows[0]?.execute_whatsapp_km_update_with_expense_link.kind).toBe("replayed");

    const kmAfterSecond = await fetchDespesaKmRegistro(setup, despesaId);
    expect(kmAfterSecond).toBe(700);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ4x-V G3] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
