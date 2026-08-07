/**
 * MJ2C-V N7 — p_action inválido (ex.: 'xyz') → rejected/invariant_violation.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  SYNTH_USER_ID,
  SYNTH_VEHICLE_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  seedBaseFixtures,
} from "./fixtures";

const HAS_DB =
  typeof process.env.TEST_DATABASE_URL === "string" && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

type Result = { kind: string; reason?: string };

describeIfDb("MJ2C-V N7 — invariant_violation", () => {
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

  test("p_action='xyz' → rejected/invariant_violation", async () => {
    const r = await setup.query<{ record_whatsapp_milestone_notice: Result }>(
      `select public.record_whatsapp_milestone_notice($1,$2,$3,$4)
         as record_whatsapp_milestone_notice`,
      [SYNTH_USER_ID, SYNTH_VEHICLE_ID, 120000, "xyz"],
    );
    const res = r.rows[0]?.record_whatsapp_milestone_notice;
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("invariant_violation");

    const row = await setup.query<{ n: string }>(
      `select count(*)::text as n from public.whatsapp_milestone_notices
        where vehicle_id = $1 and milestone_km = $2`,
      [SYNTH_VEHICLE_ID, 120000],
    );
    expect(Number(row.rows[0]?.n ?? "0")).toBe(0);
  });

  test("p_milestone_km <= 0 → rejected/invariant_violation", async () => {
    const r = await setup.query<{ record_whatsapp_milestone_notice: Result }>(
      `select public.record_whatsapp_milestone_notice($1,$2,$3,$4)
         as record_whatsapp_milestone_notice`,
      [SYNTH_USER_ID, SYNTH_VEHICLE_ID, 0, "notified"],
    );
    const res = r.rows[0]?.record_whatsapp_milestone_notice;
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("invariant_violation");
  });
});

if (!HAS_DB) {
  console.log("[MJ2C-V N7] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
