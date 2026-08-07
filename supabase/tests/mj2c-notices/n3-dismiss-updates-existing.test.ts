/**
 * MJ2C-V N3 — action='dismiss' → status 'dismissed', dismissed_at
 * preenchido.
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

type Result = {
  kind: string;
  reason?: string;
  id?: string;
  status?: string;
  notifiedAt?: string | null;
  snoozedUntil?: string | null;
  dismissedAt?: string | null;
};

describeIfDb("MJ2C-V N3 — dismiss atualiza linha existente", () => {
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

  test("notified seguido de dismiss → status dismissed, dismissed_at preenchido", async () => {
    await setup.query<{ record_whatsapp_milestone_notice: Result }>(
      `select public.record_whatsapp_milestone_notice($1,$2,$3,$4)
         as record_whatsapp_milestone_notice`,
      [SYNTH_USER_ID, SYNTH_VEHICLE_ID, 80000, "notified"],
    );

    const r = await setup.query<{ record_whatsapp_milestone_notice: Result }>(
      `select public.record_whatsapp_milestone_notice($1,$2,$3,$4)
         as record_whatsapp_milestone_notice`,
      [SYNTH_USER_ID, SYNTH_VEHICLE_ID, 80000, "dismiss"],
    );
    const res = r.rows[0]?.record_whatsapp_milestone_notice;
    expect(res?.kind).toBe("recorded");
    expect(res?.status).toBe("dismissed");
    expect(res?.dismissedAt).not.toBeNull();

    const row = await setup.query<{ n: string }>(
      `select count(*)::text as n from public.whatsapp_milestone_notices
        where vehicle_id = $1 and milestone_km = $2`,
      [SYNTH_VEHICLE_ID, 80000],
    );
    expect(Number(row.rows[0]?.n ?? "0")).toBe(1);
  });
});

if (!HAS_DB) {
  console.log("[MJ2C-V N3] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
