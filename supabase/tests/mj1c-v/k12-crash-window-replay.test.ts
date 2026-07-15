/**
 * MJ1C-V — Cenário K12: crash-window replay. Prova a história de
 * recuperação que justificou ter DUAS RPCs separadas
 * (execute_whatsapp_km_update e depois apply_whatsapp_orchestrator_transition)
 * em vez de uma só. Não é sobre disputa de lock — é sobre durabilidade
 * no tempo.
 *
 * Cenário: worker executa a RPC com sucesso (applied) e "morre" antes
 * de conseguir chamar apply_whatsapp_orchestrator_transition — que
 * NUNCA é chamada neste teste, de propósito. Depois, o worker que
 * recuperou o lease chama a RPC de novo com os MESMOS parâmetros. A
 * expected_state_version continua sendo a mesma da primeira chamada
 * (nenhum apply() tocou em whatsapp_conversation_states nesse
 * intervalo). Segunda chamada deve devolver 'replayed', sem segunda
 * escrita no veículo e sem segunda linha em
 * whatsapp_action_executions.
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
const ORCH_VERSION = "mj1cv-k12-v1";

type ExecResult = {
  kind: string;
  actionExecutionId?: string;
  previousKm?: number | null;
  newKm?: number | null;
};

describeIfDb("MJ1C-V K12 — crash-window replay", () => {
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

  test("worker crash entre execute e apply -> retry replaya sem duplicar", async () => {
    await setVehicleKm(setup, SYNTH_VEHICLE_ID, null);

    const draftId = crypto.randomUUID();
    const stateId = await seedConversationState(setup, {
      draftId,
      state: "awaiting_km_confirmation",
      draftPayload: {
        vehicleId: SYNTH_VEHICLE_ID,
        newKm: 300,
        expectedPreviousKm: null,
        isCorrection: false,
      },
      stateVersion: 1,
    });
    const msgId = await seedConfirmationMessage(setup, "K12 confirm");
    const params = [
      draftId, stateId, msgId, msgId, crypto.randomUUID(),
      SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
      null, 300, false, false, null, 1, ORCH_VERSION,
    ];

    // Worker original: chama a RPC, commita — e "morre" antes de chamar
    // apply_whatsapp_orchestrator_transition (que nunca é chamada aqui).
    await setup.begin();
    const rA = await setup.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      params,
    );
    const first = rA.rows[0]?.execute_whatsapp_km_update;
    expect(first?.kind).toBe("applied");
    expect(first?.newKm).toBe(300);
    await setup.commit();

    // Worker que recuperou o lease: chama de novo. state_version continua 1
    // porque nenhum apply() rodou.
    const rB = await setup.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      params,
    );
    const second = rB.rows[0]?.execute_whatsapp_km_update;
    expect(second?.kind).toBe("replayed");
    expect(second?.newKm).toBe(300);
    expect(second?.actionExecutionId).toBe(first?.actionExecutionId as string);

    const veh = await setup.query<{ km_atual: number | null }>(
      `select km_atual from public.veiculos where id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(veh.rows[0]?.km_atual).toBe(300);

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
  console.log("[MJ1C-V K12] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
