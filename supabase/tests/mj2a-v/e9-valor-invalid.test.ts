/**
 * MJ2A-V E9 — valor fora dos limites (3 sub-casos: 0, negativo, acima
 * do teto). Todos → rejected/valor_invalid.
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
const ORCH = "mj2av-e9-v1";

type Result = { kind: string; reason?: string };

describeIfDb("MJ2A-V E9 — valor_invalid", () => {
  let setup: Session;
  let stateId: string;
  let draftId: string;
  let msgId: string;

  beforeAll(async () => {
    setup = await openSession("setup");
    await setup.begin();
    await cleanupBaseFixtures(setup);
    await setup.commit();
    await setup.begin();
    await seedBaseFixtures(setup);
    await setup.commit();

    draftId = crypto.randomUUID();
    stateId = await seedConversationState(setup, {
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
    msgId = await seedConfirmationMessage(setup, "E9");
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

  async function call(valor: number): Promise<Result | undefined> {
    const r = await setup.query<{ execute_whatsapp_expense_create: Result }>(
      `select public.execute_whatsapp_expense_create(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
       ) as execute_whatsapp_expense_create`,
      [
        draftId, stateId, msgId, msgId, crypto.randomUUID(),
        SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
        "Combustível", valor, null, 1, ORCH,
      ],
    );
    return r.rows[0]?.execute_whatsapp_expense_create;
  }

  test("valor=0 → valor_invalid", async () => {
    const res = await call(0);
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("valor_invalid");
  });

  test("valor=-10 → valor_invalid", async () => {
    const res = await call(-10);
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("valor_invalid");
  });

  test("valor=9999999999 → valor_invalid", async () => {
    const res = await call(9999999999);
    expect(res?.kind).toBe("rejected");
    expect(res?.reason).toBe("valor_invalid");
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ2A-V E9] skipped: TEST_DATABASE_URL ausente");
}
