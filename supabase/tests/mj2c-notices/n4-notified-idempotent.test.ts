/**
 * MJ2C-V N4 — Idempotência: chamar 'notified' duas vezes não duplica linha
 * (UNIQUE respeitada) e não sobrescreve notified_at já setado.
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

describeIfDb("MJ2C-V N4 — notified duas vezes é idempotente", () => {
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

  test("2ª chamada 'notified' não duplica linha nem sobrescreve notified_at", async () => {
    const r1 = await setup.query<{ record_whatsapp_milestone_notice: Result }>(
      `select public.record_whatsapp_milestone_notice($1,$2,$3,$4)
         as record_whatsapp_milestone_notice`,
      [SYNTH_USER_ID, SYNTH_VEHICLE_ID, 90000, "notified"],
    );
    const firstNotifiedAt = r1.rows[0]?.record_whatsapp_milestone_notice.notifiedAt;
    expect(firstNotifiedAt).not.toBeNull();

    const r2 = await setup.query<{ record_whatsapp_milestone_notice: Result }>(
      `select public.record_whatsapp_milestone_notice($1,$2,$3,$4)
         as record_whatsapp_milestone_notice`,
      [SYNTH_USER_ID, SYNTH_VEHICLE_ID, 90000, "notified"],
    );
    const res2 = r2.rows[0]?.record_whatsapp_milestone_notice;
    expect(res2?.kind).toBe("recorded");
    expect(res2?.status).toBe("notified");
    expect(res2?.notifiedAt).toBe(firstNotifiedAt as string);

    const row = await setup.query<{ n: string }>(
      `select count(*)::text as n from public.whatsapp_milestone_notices
        where vehicle_id = $1 and milestone_km = $2`,
      [SYNTH_VEHICLE_ID, 90000],
    );
    expect(Number(row.rows[0]?.n ?? "0")).toBe(1);
  });
});

if (!HAS_DB) {
  console.log("[MJ2C-V N4] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
