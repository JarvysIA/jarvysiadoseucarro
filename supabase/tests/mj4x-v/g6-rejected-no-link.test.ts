/**
 * MJ4x-V — Cenário G6: quando a RPC base rejeita (veículo arquivado), a
 * despesa nunca é tocada — a ligação só acontece para kind em
 * ('applied','no_op','replayed').
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  SYNTH_CONTACT_ID,
  SYNTH_USER_ID,
  SYNTH_VEHICLE_ARCHIVED_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  fetchDespesaKmRegistro,
  seedBaseFixtures,
  seedConfirmationMessage,
  seedConversationState,
  seedDespesa,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

const ORCH_VERSION = "mj4xv-g6-v1";

type ExecResult = { kind: string; reason?: string };

describeIfDb("MJ4x-V G6 — RPC rejeitada não toca a despesa", () => {
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

  test("veículo arquivado -> rejected, despesa continua sem km_registro", async () => {
    const despesaId = await seedDespesa(setup, {
      userId: SYNTH_USER_ID,
      vehicleId: SYNTH_VEHICLE_ARCHIVED_ID,
      kmRegistro: null,
    });

    const draftId = crypto.randomUUID();
    const stateId = await seedConversationState(setup, {
      draftId,
      state: "awaiting_km_confirmation",
      draftPayload: {
        vehicleId: SYNTH_VEHICLE_ARCHIVED_ID,
        newKm: 500,
        expectedPreviousKm: null,
        isCorrection: false,
        linkedExpenseId: despesaId,
      },
      stateVersion: 1,
    });
    const msgId = await seedConfirmationMessage(setup, "G6 confirm");

    const r = await setup.query<{ execute_whatsapp_km_update_with_expense_link: ExecResult }>(
      `select public.execute_whatsapp_km_update_with_expense_link(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       ) as execute_whatsapp_km_update_with_expense_link`,
      [
        draftId, stateId, msgId, msgId, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ARCHIVED_ID,
        null, 500, false, false, null,
        1, ORCH_VERSION,
        despesaId,
      ],
    );
    const result = r.rows[0]?.execute_whatsapp_km_update_with_expense_link;
    expect(result?.kind).toBe("rejected");
    expect(result?.reason).toBe("vehicle_archived");

    const kmRegistro = await fetchDespesaKmRegistro(setup, despesaId);
    expect(kmRegistro).toBeNull();
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ4x-V G6] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
