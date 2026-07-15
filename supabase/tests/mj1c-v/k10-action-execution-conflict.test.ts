/**
 * MJ1C-V — Cenário K10: action_execution_conflict. Uma execução com
 * draft_id D já foi registrada (newKm=100). Reaproveitamos artificialmente
 * o MESMO draft_id (via UPDATE direto em whatsapp_conversation_states,
 * NÃO um caminho que o core.ts geraria em produção) alterando o
 * draft_payload pra newKm=200. Chamamos a RPC — ela deve devolver
 * 'conflicted'/action_execution_conflict porque a execução registrada
 * tem newKm=100, divergente do pedido atual.
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
const ORCH_VERSION = "mj1cv-k10-v1";

type ExecResult = { kind: string; reason?: string; newKm?: number | null };

describeIfDb("MJ1C-V K10 — action_execution_conflict", () => {
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

  test("mesmo draft_id com newKm divergente do já executado -> conflicted", async () => {
    await setVehicleKm(setup, SYNTH_VEHICLE_ID, null);

    const draftId = crypto.randomUUID();
    const stateId = await seedConversationState(setup, {
      draftId,
      state: "awaiting_km_confirmation",
      draftPayload: {
        vehicleId: SYNTH_VEHICLE_ID,
        newKm: 100,
        expectedPreviousKm: null,
        isCorrection: false,
      },
      stateVersion: 1,
    });
    const msgId = await seedConfirmationMessage(setup, "K10 first");

    // Primeira chamada — applied, km_atual vira 100.
    const r1 = await setup.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      [
        draftId, stateId, msgId, msgId, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
        null, 100, false, false, null, 1, ORCH_VERSION,
      ],
    );
    expect(r1.rows[0]?.execute_whatsapp_km_update?.kind).toBe("applied");

    // Reaproveitamento indevido do MESMO draft_id — sobrescreve o payload.
    await setup.query(
      `UPDATE public.whatsapp_conversation_states
          SET draft_payload = $2::jsonb
        WHERE id = $1`,
      [
        stateId,
        {
          vehicleId: SYNTH_VEHICLE_ID,
          newKm: 200,
          expectedPreviousKm: 100,
          isCorrection: false,
        },
      ],
    );

    const msg2 = await seedConfirmationMessage(setup, "K10 second");
    const r2 = await setup.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      [
        draftId, stateId, msg2, msg2, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
        100, 200, false, false, null, 1, ORCH_VERSION,
      ],
    );
    const result = r2.rows[0]?.execute_whatsapp_km_update;
    expect(result?.kind).toBe("conflicted");
    expect(result?.reason).toBe("action_execution_conflict");

    const veh = await setup.query<{ km_atual: number | null }>(
      `select km_atual from public.veiculos where id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(veh.rows[0]?.km_atual).toBe(100);

    const exec = await setup.query<{ n: string }>(
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
  console.log("[MJ1C-V K10] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
