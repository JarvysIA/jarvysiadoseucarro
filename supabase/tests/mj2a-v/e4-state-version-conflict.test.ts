/**
 * MJ2A-V E4 — state_version_conflict: expected diverge do persistido.
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
const ORCH = "mj2av-e4-v1";

type Result = {
  kind: string;
  reason?: string;
  currentStateVersion?: number;
};

describeIfDb("MJ2A-V E4 — state_version_conflict", () => {
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

  test("expected=5, persisted=0 → conflicted", async () => {
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
      stateVersion: 0,
    });
    const msgId = await seedConfirmationMessage(setup, "E4 confirm");

    const r = await setup.query<{ execute_whatsapp_expense_create: Result }>(
      `select public.execute_whatsapp_expense_create(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
       ) as execute_whatsapp_expense_create`,
      [
        draftId, stateId, msgId, msgId, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
        "Combustível", 80, null, 5, ORCH,
      ],
    );
    const res = r.rows[0]?.execute_whatsapp_expense_create;
    expect(res?.kind).toBe("conflicted");
    expect(res?.reason).toBe("state_version_conflict");
    expect(res?.currentStateVersion).toBe(0);

    const desp = await setup.query<{ n: string }>(
      `select count(*)::text as n from public.despesas
        where vehicle_id = $1`, [SYNTH_VEHICLE_ID],
    );
    expect(Number(desp.rows[0]?.n ?? "0")).toBe(0);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ2A-V E4] skipped: TEST_DATABASE_URL ausente");
}
