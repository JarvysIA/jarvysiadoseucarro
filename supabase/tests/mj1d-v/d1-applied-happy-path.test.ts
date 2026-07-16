/**
 * MJ1D-V — Cenário D1: corrente completa applied. Simula um worker
 * inteiro pegando um item da fila via claim, executando
 * execute_whatsapp_km_update (aplicando o km novo no veiculo e
 * gravando whatsapp_action_executions) e finalizando o item via
 * apply_whatsapp_orchestrator_transition (state -> idle, draft
 * limpo, whatsapp_processing_queue.status='done', mensagem outbound
 * enfileirada).
 *
 * SÓ roda em Postgres local (guard preflight). Skipa em bun test
 * padrão quando TEST_DATABASE_URL não está setado.
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

const WORKER = "mj1dv-d1-worker";
const ORCH_VERSION = "mj1dv-v1";

type ClaimedRow = {
  queue_id: string;
  message_id: string;
  contact_id: string;
  lease_token: string | null;
};

type ExecResult = {
  kind: string;
  previousKm?: number | null;
  newKm?: number | null;
  actionExecutionId?: string;
  reason?: string;
};

type ApplyResult = {
  ok: boolean;
  wasReplay?: boolean;
  reason?: string;
};

describeIfDb("MJ1D-V D1 — corrente completa applied", () => {
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

  test("claim -> execute (applied) -> apply (idle) — tudo persiste corretamente", async () => {
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
    expect(claim.rows.length).toBe(1);
    const leaseToken = claim.rows[0]?.lease_token;
    expect(leaseToken).toBeTruthy();

    const exec = await session.query<{ execute_whatsapp_km_update: ExecResult }>(
      `select public.execute_whatsapp_km_update(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) as execute_whatsapp_km_update`,
      [
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
      ],
    );
    const execResult = exec.rows[0]?.execute_whatsapp_km_update;
    expect(execResult?.kind).toBe("applied");
    expect(execResult?.previousKm).toBe(10000);
    expect(execResult?.newKm).toBe(20000);

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

    const st = await session.query<{
      state: string;
      draft_id: string | null;
      draft_type: string | null;
      draft_payload: unknown;
      state_version: number;
    }>(
      `select state, draft_id, draft_type, draft_payload,
              state_version::int as state_version
         from public.whatsapp_conversation_states where id = $1`,
      [conversationStateId],
    );
    expect(st.rows[0]?.state).toBe("idle");
    expect(st.rows[0]?.draft_id).toBeNull();
    expect(st.rows[0]?.draft_type).toBeNull();
    expect(st.rows[0]?.draft_payload).toBeNull();
    expect(st.rows[0]?.state_version).toBe(1);

    const q = await session.query<{ status: string }>(
      `select status from public.whatsapp_processing_queue where id = $1`,
      [queueId],
    );
    expect(q.rows[0]?.status).toBe("done");

    const outbound = await session.query<{ n: string }>(
      `select count(*)::text as n from public.whatsapp_outbound_queue where contact_id = $1`,
      [SYNTH_CONTACT_ID],
    );
    expect(Number(outbound.rows[0]?.n)).toBe(1);

    const execRows = await session.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_action_executions
        where draft_id = $1 and action_type = 'km_update' and status = 'succeeded'`,
      [reportMsgId],
    );
    expect(Number(execRows.rows[0]?.n)).toBe(1);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1D-V D1] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
