/**
 * MJ2A-V E3 — Replay com payload divergente: mesmo draft_id, valor
 * diferente na 2ª chamada → 'conflicted'/'action_execution_conflict'.
 * A despesa original é preservada intacta.
 *
 * Detalhe: a RPC valida draft_payload contra p_categoria/p_valor ANTES da
 * checagem de idempotência. Pra atingir action_execution_conflict com
 * p_valor divergente, precisamos MUDAR o draft_payload no meio dos dois
 * calls — reproduzindo o caso real onde o mesmo draft_id foi reutilizado
 * pra um novo confirm com valor diferente sem passar por reset.
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
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;
const ORCH = "mj2av-e3-v1";

type Result = {
  kind: string;
  actionExecutionId?: string;
  despesaId?: string;
  reason?: string;
};

describeIfDb("MJ2A-V E3 — replay payload mismatch", () => {
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
      if (residue !== 0) throw new Error(`resíduo != 0: ${residue}`);
    } finally {
      await setup?.close();
    }
  });

  test("valor divergente na 2ª chamada → conflicted", async () => {
    const draftId = crypto.randomUUID();
    const stateId = await seedConversationState(setup, {
      draftId,
      state: "awaiting_expense_confirmation",
      draftPayload: {
        phase: "awaiting_confirmation",
        categoria: "Combustível",
        valor: 80,
        vehicleId: SYNTH_VEHICLE_ID,
        requestMessageId: draftId,
      },
      stateVersion: 1,
    });
    const msgId = await seedConfirmationMessage(setup, "E3 confirm");

    // 1ª: aplicada com valor 80.
    const r1 = await setup.query<{ execute_whatsapp_expense_create: Result }>(
      `select public.execute_whatsapp_expense_create(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
       ) as execute_whatsapp_expense_create`,
      [
        draftId, stateId, msgId, msgId, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
        "Combustível", 80, null, 1, ORCH,
      ],
    );
    expect(r1.rows[0]?.execute_whatsapp_expense_create?.kind).toBe("applied");
    const despesaId =
      r1.rows[0]?.execute_whatsapp_expense_create?.despesaId as string;

    // Simula reutilização do draft_id com valor novo: reescreve o
    // draft_payload direto pra bater com p_valor=99 na 2ª chamada, senão
    // a defesa de draft_payload_mismatch dispararia antes da idempotência.
    await setup.query(
      `UPDATE public.whatsapp_conversation_states
          SET draft_payload = jsonb_set(draft_payload, '{valor}', '99'::jsonb)
        WHERE id = $1`,
      [stateId],
    );

    const r2 = await setup.query<{ execute_whatsapp_expense_create: Result }>(
      `select public.execute_whatsapp_expense_create(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
       ) as execute_whatsapp_expense_create`,
      [
        draftId, stateId, msgId, msgId, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
        "Combustível", 99, null, 1, ORCH,
      ],
    );
    const res2 = r2.rows[0]?.execute_whatsapp_expense_create;
    expect(res2?.kind).toBe("conflicted");
    expect(res2?.reason).toBe("action_execution_conflict");

    // Só a despesa original existe.
    const desp = await setup.query<{ id: string; valor: string }>(
      `select id, valor::text as valor from public.despesas
        where vehicle_id = $1 and user_id = $2`,
      [SYNTH_VEHICLE_ID, SYNTH_USER_ID],
    );
    expect(desp.rows.length).toBe(1);
    expect(desp.rows[0]?.id).toBe(despesaId);
    expect(Number(desp.rows[0]?.valor)).toBe(80);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ2A-V E3] skipped: TEST_DATABASE_URL ausente");
}
