/**
 * MJ2A-V E6 — draft_type='km_update' com state expense →
 * rejected/invariant_violation.
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
  seedConversationStateRaw,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;
const ORCH = "mj2av-e6-v1";

type Result = { kind: string; reason?: string };

describeIfDb("MJ2A-V E6 — draft_type mismatch", () => {
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

  test("draft_type='km_update' → rejected/invariant_violation", async () => {
    const draftId = crypto.randomUUID();
    const stateId = await seedConversationStateRaw(setup, {
      state: "awaiting_expense_confirmation",
      draftType: "km_update",
      draftId,
      draftPayload: {
        phase: "awaiting_confirmation",
        categoria: "Combustível",
        valor: 80,
        vehicleId: SYNTH_VEHICLE_ID,
        requestMessageId: draftId,
      },
      stateVersion: 1,
    });
    const msgId = await seedConfirmationMessage(setup, "E6 confirm");

    const r = await setup.query<{ execute_whatsapp_expense_create: Result }>(
      `select public.execute_whatsapp_expense_create(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
       ) as execute_whatsapp_expense_create`,
      [
        draftId, stateId, msgId, msgId, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
        "Combustível", 80, null, 1, ORCH,
      ],
    );
    const res = r.rows[0]?.execute_whatsapp_expense_create;
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("invariant_violation");
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ2A-V E6] skipped: TEST_DATABASE_URL ausente");
}
