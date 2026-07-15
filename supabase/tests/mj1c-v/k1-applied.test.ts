/**
 * MJ1C-V — Cenário K1: execute_whatsapp_km_update no caminho feliz
 * ('applied'). Veículo com km_atual NULL, draft consistente, RPC aplica
 * a atualização, veiculos.km_atual passa a 500 e nasce uma linha em
 * whatsapp_action_executions com status 'succeeded'.
 *
 * SÓ roda em Postgres local (guard preflight). Skipa em bun test padrão
 * quando TEST_DATABASE_URL não está setado. Não modifica RPCs, migrations,
 * Edge Functions ou src/.
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

const ORCH_VERSION = "mj1cv-k1-v1";

type ExecResult = {
  kind: string;
  actionExecutionId?: string;
  previousKm?: number | null;
  newKm?: number | null;
  reason?: string;
  currentKm?: number | null;
  currentStateVersion?: number;
  noChange?: boolean;
};

describeIfDb("MJ1C-V K1 — applied (caminho feliz)", () => {
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

  test("km_atual NULL -> aplica 500, cria execução succeeded", async () => {
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
    const msgId = await seedConfirmationMessage(setup, "K1 confirm");

    const r = await setup.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      [
        draftId,
        stateId,
        msgId,
        msgId,
        crypto.randomUUID(),
        SYNTH_USER_ID,
        SYNTH_CONTACT_ID,
        SYNTH_VEHICLE_ID,
        null,
        500,
        false,
        false,
        null,
        1,
        ORCH_VERSION,
      ],
    );
    const result = r.rows[0]?.execute_whatsapp_km_update;
    expect(result?.kind).toBe("applied");
    expect(result?.previousKm).toBeNull();
    expect(result?.newKm).toBe(500);
    expect(result?.actionExecutionId).toBeTruthy();

    const veh = await setup.query<{ km_atual: number | null }>(
      `select km_atual from public.veiculos where id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(veh.rows[0]?.km_atual).toBe(500);

    const exec = await setup.query<{ n: string; status: string }>(
      `select count(*)::text as n,
              max(status) as status
         from public.whatsapp_action_executions
        where draft_id = $1 and action_type = 'km_update'`,
      [draftId],
    );
    expect(Number(exec.rows[0]?.n ?? "0")).toBe(1);
    expect(exec.rows[0]?.status).toBe("succeeded");
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1C-V K1] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
