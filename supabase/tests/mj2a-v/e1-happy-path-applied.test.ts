/**
 * MJ2A-V E1 — Caminho feliz: execute_whatsapp_expense_create devolve
 * 'applied', cria linha em despesas e uma execução succeeded.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  SYNTH_CONTACT_ID,
  SYNTH_USER_ID,
  SYNTH_VEHICLE_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  fetchDespesa,
  seedBaseFixtures,
  seedConfirmationMessage,
  seedConversationState,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;
const ORCH = "mj2av-e1-v1";

type Result = {
  kind: string;
  actionExecutionId?: string;
  despesaId?: string;
  categoria?: string;
  valor?: number | string;
  reason?: string;
};

describeIfDb("MJ2A-V E1 — applied (happy path)", () => {
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

  test("insere despesa e execução succeeded", async () => {
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
    const msgId = await seedConfirmationMessage(setup, "E1 confirm");

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
    expect(res?.kind).toBe("applied");
    expect(res?.despesaId).toBeTruthy();
    expect(res?.categoria).toBe("Combustível");

    const desp = await fetchDespesa(setup, res!.despesaId as string);
    expect(desp?.categoria).toBe("Combustível");
    expect(Number(desp?.valor)).toBe(80);
    expect(desp?.vehicle_id).toBe(SYNTH_VEHICLE_ID);
    expect(desp?.user_id).toBe(SYNTH_USER_ID);

    const exec = await setup.query<{ n: string; status: string }>(
      `select count(*)::text as n, max(status) as status
         from public.whatsapp_action_executions
        where draft_id = $1 and action_type = 'expense_create'`,
      [draftId],
    );
    expect(Number(exec.rows[0]?.n ?? "0")).toBe(1);
    expect(exec.rows[0]?.status).toBe("succeeded");

    const resAfter = await countSyntheticResidue(setup);
    expect(resAfter).toBeGreaterThan(0); // rows existem pré-cleanup
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ2A-V E1] skipped: TEST_DATABASE_URL ausente");
}
