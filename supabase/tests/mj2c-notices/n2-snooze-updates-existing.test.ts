/**
 * MJ2C-V N2 — action='snooze' numa linha existente → status 'snoozed',
 * snoozed_until = now() + 15 dias (tolerância de alguns segundos).
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

const TOLERANCE_MS = 10_000;
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

describeIfDb("MJ2C-V N2 — snooze atualiza linha existente", () => {
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

  test("notified seguido de snooze → status snoozed, snoozed_until ~ now()+15d", async () => {
    await setup.query<{ record_whatsapp_milestone_notice: Result }>(
      `select public.record_whatsapp_milestone_notice($1,$2,$3,$4)
         as record_whatsapp_milestone_notice`,
      [SYNTH_USER_ID, SYNTH_VEHICLE_ID, 70000, "notified"],
    );

    const beforeCall = Date.now();
    const r = await setup.query<{ record_whatsapp_milestone_notice: Result }>(
      `select public.record_whatsapp_milestone_notice($1,$2,$3,$4)
         as record_whatsapp_milestone_notice`,
      [SYNTH_USER_ID, SYNTH_VEHICLE_ID, 70000, "snooze"],
    );
    const res = r.rows[0]?.record_whatsapp_milestone_notice;
    expect(res?.kind).toBe("recorded");
    expect(res?.status).toBe("snoozed");
    expect(res?.snoozedUntil).not.toBeNull();

    const snoozedUntilMs = new Date(res?.snoozedUntil as string).getTime();
    const expectedMs = beforeCall + FIFTEEN_DAYS_MS;
    expect(Math.abs(snoozedUntilMs - expectedMs)).toBeLessThan(TOLERANCE_MS);
  });
});

if (!HAS_DB) {
  console.log("[MJ2C-V N2] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
