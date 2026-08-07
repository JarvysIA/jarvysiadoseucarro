/**
 * MJ2C-V N5 — p_vehicle_id de veículo que pertence a OUTRO user_id →
 * rejected/vehicle_not_owned.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  SYNTH_OTHER_VEHICLE_ID,
  SYNTH_USER_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  seedBaseFixtures,
} from "./fixtures";

const HAS_DB =
  typeof process.env.TEST_DATABASE_URL === "string" && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

type Result = { kind: string; reason?: string };

describeIfDb("MJ2C-V N5 — vehicle_not_owned", () => {
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

  test("veículo pertence ao OTHER_USER → rejected/vehicle_not_owned", async () => {
    const r = await setup.query<{ record_whatsapp_milestone_notice: Result }>(
      `select public.record_whatsapp_milestone_notice($1,$2,$3,$4)
         as record_whatsapp_milestone_notice`,
      [SYNTH_USER_ID, SYNTH_OTHER_VEHICLE_ID, 100000, "notified"],
    );
    const res = r.rows[0]?.record_whatsapp_milestone_notice;
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("vehicle_not_owned");

    const row = await setup.query<{ n: string }>(
      `select count(*)::text as n from public.whatsapp_milestone_notices
        where vehicle_id = $1`,
      [SYNTH_OTHER_VEHICLE_ID],
    );
    expect(Number(row.rows[0]?.n ?? "0")).toBe(0);
  });
});

if (!HAS_DB) {
  console.log("[MJ2C-V N5] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
