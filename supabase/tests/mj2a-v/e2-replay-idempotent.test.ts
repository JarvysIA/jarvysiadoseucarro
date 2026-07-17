/**
 * MJ2A-V E2 — Replay idempotente: chamar 2x com os mesmos parâmetros
 * gera 'applied' + 'replayed', mesmo despesaId, uma única linha em despesas.
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
const ORCH = "mj2av-e2-v1";

type Result = {
  kind: string;
  actionExecutionId?: string;
  despesaId?: string;
  categoria?: string;
  valor?: number | string;
};

describeIfDb("MJ2A-V E2 — replay idempotente", () => {
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

  test("2ª chamada devolve replayed com mesmo despesaId", async () => {
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
      stateVersion: 1,
    });
    const msgId = await seedConfirmationMessage(setup, "E2 confirm");

    const params = [
      draftId, stateId, msgId, msgId, crypto.randomUUID(),
      SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID,
      "Combustível", 80, null, 1, ORCH,
    ];

    const r1 = await setup.query<{ execute_whatsapp_expense_create: Result }>(
      `select public.execute_whatsapp_expense_create(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
       ) as execute_whatsapp_expense_create`,
      params,
    );
    const res1 = r1.rows[0]?.execute_whatsapp_expense_create;
    expect(res1?.kind).toBe("applied");
    const despesaId = res1?.despesaId as string;

    const r2 = await setup.query<{ execute_whatsapp_expense_create: Result }>(
      `select public.execute_whatsapp_expense_create(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
       ) as execute_whatsapp_expense_create`,
      params,
    );
    const res2 = r2.rows[0]?.execute_whatsapp_expense_create;
    expect(res2?.kind).toBe("replayed");
    expect(res2?.despesaId).toBe(despesaId);
    expect(res2?.categoria).toBe("Combustível");
    expect(Number(res2?.valor)).toBe(80);

    const desp = await setup.query<{ n: string }>(
      `select count(*)::text as n from public.despesas
        where vehicle_id = $1 and user_id = $2`,
      [SYNTH_VEHICLE_ID, SYNTH_USER_ID],
    );
    expect(Number(desp.rows[0]?.n ?? "0")).toBe(1);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ2A-V E2] skipped: TEST_DATABASE_URL ausente");
}
