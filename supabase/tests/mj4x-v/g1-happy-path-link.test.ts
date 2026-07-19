/**
 * MJ4x-V — Cenário G1: caminho feliz. Despesa sem km ligada
 * (km_registro NULL), RPC nova aplica a atualização de km E liga a
 * despesa no mesmo UPDATE atômico.
 *
 * SÓ roda em Postgres local (guard preflight). Skipa em bun test padrão
 * quando TEST_DATABASE_URL não está setado. Não modifica RPCs, migrations,
 * Edge Functions ou src/ — só chama a RPC já existente.
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

const ORCH_VERSION = "mj4xv-g1-v1";

type ExecResult = {
  kind: string;
  actionExecutionId?: string;
  previousKm?: number | null;
  newKm?: number | null;
};

describeIfDb("MJ4x-V G1 — caminho feliz (liga despesa)", () => {
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

  test("km_atual NULL -> aplica 500 e liga despesa", async () => {
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
        newKm: 500,
        expectedPreviousKm: null,
        isCorrection: false,
        linkedExpenseId: despesaId,
      },
      stateVersion: 1,
    });
    const msgId = await seedConfirmationMessage(setup, "G1 confirm");

    const r = await setup.query<{ execute_whatsapp_km_update_with_expense_link: ExecResult }>(
      `select public.execute_whatsapp_km_update_with_expense_link(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       ) as execute_whatsapp_km_update_with_expense_link`,
      [
        draftId, stateId, msgId, msgId, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
        null, 500, false, false, null,
        1, ORCH_VERSION,
        despesaId,
      ],
    );
    const result = r.rows[0]?.execute_whatsapp_km_update_with_expense_link;
    expect(result?.kind).toBe("applied");
    expect(result?.newKm).toBe(500);

    const veh = await setup.query<{ km_atual: number | null }>(
      `select km_atual from public.veiculos where id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(veh.rows[0]?.km_atual).toBe(500);

    const kmRegistro = await fetchDespesaKmRegistro(setup, despesaId);
    expect(kmRegistro).toBe(500);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ4x-V G1] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
