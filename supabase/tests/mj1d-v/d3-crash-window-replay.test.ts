/**
 * MJ1D-V — Cenário D3: crash-window replay encadeado com apply.
 *
 * Simula worker que chama execute_whatsapp_km_update com sucesso
 * (applied), "morre" antes de chamar apply(), o lease é recuperado
 * (aqui simplesmente reaproveita o mesmo lease dentro da mesma
 * sessão), a RPC de KM é chamada de novo com os MESMOS parâmetros
 * (deve devolver 'replayed', sem duplicar linha em action_executions
 * nem re-escrever no veículo) e SÓ ENTÃO o apply é chamado pela
 * primeira vez — que deve concluir normalmente (wasReplay=false do
 * ponto de vista do apply, porque essa é a primeira chamada dele).
 * Nada pode duplicar no fim: 1 outbound, 1 action_execution,
 * state_version=1, km_atual=20000.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  serializePatch,
  serializeResponse,
} from "../../functions/_shared/whatsapp/orchestrator/repository.ts";
import {
  SYNTH_CONTACT_ID,
  SYNTH_USER_ID,
  SYNTH_VEHICLE_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  seedBaseFixtures,
  seedConfirmationQueueItem,
  seedConversationState,
  seedReportMessage,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

const WORKER = "mj1dv-d3-worker";
const ORCH_VERSION = "mj1dv-v1";

type ClaimedRow = { queue_id: string; lease_token: string | null };
type ExecResult = {
  kind: string;
  previousKm?: number | null;
  newKm?: number | null;
  actionExecutionId?: string;
};
type ApplyResult = { ok: boolean; wasReplay?: boolean };

describeIfDb("MJ1D-V D3 — crash-window replay encadeado com apply", () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession("setup");
    await session.begin();
    await cleanupBaseFixtures(session);
    await session.commit();
    await session.begin();
    await seedBaseFixtures(session, { kmAtual: 10000 });
    await session.commit();
  });

  afterAll(async () => {
    try {
      await session.begin();
      await cleanupBaseFixtures(session);
      await session.commit();
      const residue = await countSyntheticResidue(session);
      if (residue !== 0) {
        throw new Error(`resíduo sintético != 0 após cleanup: ${residue}`);
      }
    } finally {
      await session?.close();
    }
  });

  test("execute(applied) -> crash -> execute(replayed) -> apply(1a vez)", async () => {
    const reportMsgId = await seedReportMessage(session, "km 20000");
    const conversationStateId = await seedConversationState(session, {
      draftId: reportMsgId,
      state: "awaiting_km_confirmation",
      draftPayload: {
        vehicleId: SYNTH_VEHICLE_ID,
        newKm: 20000,
        expectedPreviousKm: 10000,
        requestMessageId: reportMsgId,
        isCorrection: false,
        phase: "awaiting_confirmation",
      },
      stateVersion: 0,
    });
    const { messageId: confirmMsgId, queueId } =
      await seedConfirmationQueueItem(session, "sim");

    const claim = await session.query<ClaimedRow>(
      `select * from public.claim_whatsapp_orchestrator_items($1, $2, $3)`,
      [WORKER, 1, 60],
    );
    const leaseToken = claim.rows[0]?.lease_token;
    expect(leaseToken).toBeTruthy();

    const params = [
      reportMsgId,
      conversationStateId,
      confirmMsgId,
      reportMsgId,
      queueId,
      SYNTH_USER_ID,
      SYNTH_CONTACT_ID,
      SYNTH_VEHICLE_ID,
      10000,
      20000,
      false,
      true,
      null,
      0,
      ORCH_VERSION,
    ];

    const first = await session.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      params,
    );
    const firstResult = first.rows[0]?.execute_whatsapp_km_update;
    expect(firstResult?.kind).toBe("applied");
    expect(firstResult?.previousKm).toBe(10000);
    expect(firstResult?.newKm).toBe(20000);

    // Simula crash entre execute() e apply(): nada de apply() aqui.
    // Segunda tentativa do worker recuperado com os MESMOS params.
    const second = await session.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      params,
    );
    const secondResult = second.rows[0]?.execute_whatsapp_km_update;
    expect(secondResult?.kind).toBe("replayed");
    expect(secondResult?.previousKm).toBe(firstResult?.previousKm);
    expect(secondResult?.newKm).toBe(firstResult?.newKm);

    // Só agora chama apply() — primeira vez para o apply.
    const patch = serializePatch({
      state: "idle",
      draftType: null,
      draftId: null,
      draftVersion: 0,
      draftPayload: null,
      confirmedAt: null,
      executedAt: null,
    });
    const response = serializeResponse({
      responseKey: "km_update_applied",
      messageType: "text",
      purpose: "general",
      textBody: "Prontinho! Atualizei a quilometragem do seu carro para 20000 km.",
    });
    const resultSummary = {
      decisionKind: "transition",
      eventKind: "confirm",
      outcome: "completed",
    };

    const apply = await session.query<{ apply_whatsapp_orchestrator_transition: ApplyResult }>(
      `select public.apply_whatsapp_orchestrator_transition($1,$2,$3,$4,$5,$6,$7)
         as apply_whatsapp_orchestrator_transition`,
      [queueId, leaseToken, 0, patch, ORCH_VERSION, resultSummary, response],
    );
    const applyResult = apply.rows[0]?.apply_whatsapp_orchestrator_transition;
    expect(applyResult?.ok).toBe(true);
    expect(applyResult?.wasReplay).toBe(false);

    const veh = await session.query<{ km_atual: number | null }>(
      `select km_atual from public.veiculos where id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(veh.rows[0]?.km_atual).toBe(20000);

    const st = await session.query<{ state: string; state_version: number }>(
      `select state, state_version::int as state_version
         from public.whatsapp_conversation_states where id = $1`,
      [conversationStateId],
    );
    expect(st.rows[0]?.state).toBe("idle");
    expect(st.rows[0]?.state_version).toBe(1);

    const outbound = await session.query<{ n: string }>(
      `select count(*)::text as n from public.whatsapp_outbound_queue where contact_id = $1`,
      [SYNTH_CONTACT_ID],
    );
    expect(Number(outbound.rows[0]?.n)).toBe(1);

    const execRows = await session.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_action_executions
        where draft_id = $1 and action_type = 'km_update'`,
      [reportMsgId],
    );
    expect(Number(execRows.rows[0]?.n)).toBe(1);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1D-V D3] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
