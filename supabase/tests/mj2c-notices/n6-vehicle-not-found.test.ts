/**
 * MJ2C-V N6 — p_vehicle_id inexistente → rejected/vehicle_not_found.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  SYNTH_USER_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  seedBaseFixtures,
} from "./fixtures";

const HAS_DB =
  typeof process.env.TEST_DATABASE_URL === "string" && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

type Result = { kind: string; reason?: string };

describeIfDb("MJ2C-V N6 — vehicle_not_found", () => {
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

  test("veículo inexistente → rejected/vehicle_not_found", async () => {
    const nonExistentVehicleId = "88888888-8888-4888-8888-000000000099";
    const r = await setup.query<{ record_whatsapp_milestone_notice: Result }>(
      `select public.record_whatsapp_milestone_notice($1,$2,$3,$4)
         as record_whatsapp_milestone_notice`,
      [SYNTH_USER_ID, nonExistentVehicleId, 110000, "notified"],
    );
    const res = r.rows[0]?.record_whatsapp_milestone_notice;
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("vehicle_not_found");
  });
});

if (!HAS_DB) {
  console.log("[MJ2C-V N6] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
