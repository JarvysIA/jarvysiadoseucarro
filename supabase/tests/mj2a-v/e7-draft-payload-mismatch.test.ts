/**
 * MJ2A-V E7 — draft_payload divergente dos params (3 sub-casos: categoria,
 * valor, vehicleId). Cada divergência → rejected/invariant_violation.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  SYNTH_CONTACT_ID,
  SYNTH_OTHER_VEHICLE_ID,
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
const ORCH = "mj2av-e7-v1";

type Result = { kind: string; reason?: string };

describeIfDb("MJ2A-V E7 — draft_payload mismatch", () => {
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

  async function seedBase(draftId: string, msgId: string) {
    return await seedConversationState(setup, {
      draftId,
      state: "awaiting_expense_confirmation",
      draftPayload: {
        phase: "awaiting_confirmation",
        categoria: "Combustível",
        valor: 80,
        vehicleId: SYNTH_VEHICLE_ID,
        requestMessageId: msgId,
      },
      stateVersion: 1,
    });
  }

  async function call(
    params: unknown[],
  ): Promise<Result | undefined> {
    const r = await setup.query<{ execute_whatsapp_expense_create: Result }>(
      `select public.execute_whatsapp_expense_create(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
       ) as execute_whatsapp_expense_create`,
      params,
    );
    return r.rows[0]?.execute_whatsapp_expense_create;
  }

  test("p_categoria divergente → invariant_violation", async () => {
    const draftId = crypto.randomUUID();
    const msgId = await seedConfirmationMessage(setup, "E7a");
    const stateId = await seedBase(draftId, msgId);
    const res = await call([
      draftId, stateId, msgId, msgId, crypto.randomUUID(),
      SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
      "Manutenção", 80, null, 1, ORCH,
    ]);
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("invariant_violation");
    // limpa o state pra próximo sub-caso (nova linha).
    await setup.query(
      `DELETE FROM public.whatsapp_conversation_states WHERE id = $1`,
      [stateId],
    );
  });

  test("p_valor divergente → invariant_violation", async () => {
    const draftId = crypto.randomUUID();
    const msgId = await seedConfirmationMessage(setup, "E7b");
    const stateId = await seedBase(draftId, msgId);
    const res = await call([
      draftId, stateId, msgId, msgId, crypto.randomUUID(),
      SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
      "Combustível", 90, null, 1, ORCH,
    ]);
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("invariant_violation");
    await setup.query(
      `DELETE FROM public.whatsapp_conversation_states WHERE id = $1`,
      [stateId],
    );
  });

  test("p_vehicle_id divergente → invariant_violation", async () => {
    const draftId = crypto.randomUUID();
    const msgId = await seedConfirmationMessage(setup, "E7c");
    const stateId = await seedBase(draftId, msgId);
    const res = await call([
      draftId, stateId, msgId, msgId, crypto.randomUUID(),
      SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_OTHER_VEHICLE_ID,
      "Combustível", 80, null, 1, ORCH,
    ]);
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("invariant_violation");
    await setup.query(
      `DELETE FROM public.whatsapp_conversation_states WHERE id = $1`,
      [stateId],
    );
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ2A-V E7] skipped: TEST_DATABASE_URL ausente");
}
