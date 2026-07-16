/**
 * MJ1D-V — Cenário D2: km_conflict + retry_needed. Simula o cenário em
 * que o veículo teve o km atualizado por fora entre o momento em que o
 * draft foi criado (com expectedPreviousKm=10000) e o momento em que o
 * usuário confirma. A RPC execute_whatsapp_km_update tem que rejeitar
 * com kind='conflicted' reason='km_conflict', sem tocar em veiculos. O
 * worker então finaliza via apply_whatsapp_orchestrator_transition
 * limpando o draft e enviando resposta km_update_retry_needed, para o
 * usuário poder informar o km novamente.
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
  setVehicleKm,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

const WORKER = "mj1dv-d2-worker";
const ORCH_VERSION = "mj1dv-v1";

type ClaimedRow = { queue_id: string; lease_token: string | null };
type ExecResult = { kind: string; reason?: string; currentKm?: number | null };
type ApplyResult = { ok: boolean; wasReplay?: boolean; reason?: string };

describeIfDb("MJ1D-V D2 — km_conflict e retry_needed", () => {
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

  test("km real mudou por fora -> RPC conflicted, apply limpa draft e responde retry_needed", async () => {
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

    // Simula km real tendo mudado por fora entre draft e confirmação.
    await setVehicleKm(session, SYNTH_VEHICLE_ID, 15000);

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
    expect(execResult?.kind).toBe("conflicted");
    expect(execResult?.reason).toBe("km_conflict");

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
      responseKey: "km_update_retry_needed",
      messageType: "text",
      purpose: "general",
      textBody: "Nao consegui concluir agora. Pode me dizer a quilometragem de novo?",
    });
    const resultSummary = {
      decisionKind: "transition",
      eventKind: "confirm",
      outcome: "cancelled",
    };

    const apply = await session.query<{ apply_whatsapp_orchestrator_transition: ApplyResult }>(
      `select public.apply_whatsapp_orchestrator_transition($1,$2,$3,$4,$5,$6,$7)
         as apply_whatsapp_orchestrator_transition`,
      [queueId, leaseToken, 0, patch, ORCH_VERSION, resultSummary, response],
    );
    const applyResult = apply.rows[0]?.apply_whatsapp_orchestrator_transition;
    expect(applyResult?.ok).toBe(true);

    // veiculos.km_atual segue o valor real (15000) — a RPC de KM rejeitou,
    // não tocou; apply() não escreve em veiculos.
    const veh = await session.query<{ km_atual: number | null }>(
      `select km_atual from public.veiculos where id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(veh.rows[0]?.km_atual).toBe(15000);

    const st = await session.query<{
      state: string;
      draft_id: string | null;
    }>(
      `select state, draft_id
         from public.whatsapp_conversation_states where id = $1`,
      [conversationStateId],
    );
    expect(st.rows[0]?.state).toBe("idle");
    expect(st.rows[0]?.draft_id).toBeNull();

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

    // Observação em aberto: o comportamento da RPC execute_whatsapp_km_update
    // para linhas de whatsapp_action_executions em caminhos conflicted/rejected
    // não foi verificado neste build — nada é afirmado aqui de propósito.
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1D-V D2] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
