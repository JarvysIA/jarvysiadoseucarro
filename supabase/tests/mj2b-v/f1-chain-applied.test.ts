/**
 * MJ2B-V — Cenário F1: corrente completa applied. Mirror do D1 do MJ1D-V,
 * adaptado para despesa. Simula worker que reivindica um item da fila
 * via claim, executa execute_whatsapp_expense_create (INSERT em despesas
 * + linha em whatsapp_action_executions) e finaliza via
 * apply_whatsapp_orchestrator_transition (state -> idle, draft limpo,
 * fila 'done', mensagem outbound enfileirada).
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
import { buildExpenseFinalization } from "../../functions/_shared/whatsapp/orchestrator/test-service.ts";
import { renderResponse } from "../../functions/_shared/whatsapp/conversation/responses.ts";
import type {
  ConversationVehicle,
  ConversationState,
} from "../../functions/_shared/whatsapp/conversation/types.ts";
import type { LoadContextResult } from "../../functions/_shared/whatsapp/orchestrator/types.ts";
import type { ConfirmedExpenseCreateResult } from "../../functions/_shared/whatsapp/actions/expense-types.ts";
import {
  SYNTH_CONTACT_ID,
  SYNTH_USER_ID,
  SYNTH_VEHICLE_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  fetchDespesaCount,
  seedBaseFixtures,
  seedConfirmationQueueItem,
  seedConversationState,
  seedReportMessage,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

const WORKER = "mj2bv-f1-worker";
const ORCH_VERSION = "mj2bv-v1";

type ClaimedRow = {
  queue_id: string;
  message_id: string;
  contact_id: string;
  lease_token: string | null;
};
type ExecResult = {
  kind: string;
  despesaId?: string;
  categoria?: string;
  valor?: number | string;
  actionExecutionId?: string;
  reason?: string;
};
type ApplyResult = { ok: boolean; wasReplay?: boolean; reason?: string };

function buildCtxMock(
  conversationStateId: string,
  draftId: string,
  draftPayload: Record<string, unknown>,
  stateVersion: number,
): Extract<LoadContextResult, { kind: "ok" }> {
  const state: ConversationState = {
    state: "awaiting_expense_confirmation",
    currentIntent: null,
    awaitingField: null,
    requestSource: null,
    draftType: "expense",
    draftId,
    draftVersion: 0,
    draftPayload,
    activeVehicleId: null,
    confirmedAt: null,
    executedAt: null,
    expiresAt: null,
    lastMessageId: null,
  };
  const vehicle: ConversationVehicle = {
    id: SYNTH_VEHICLE_ID,
    brand: "Fiat",
    model: "Argo",
    plate: "MJ2BV01",
    isArchived: false,
    isEligible: true,
    kmAtual: null,
    whatsappAccessMode: "full",
  };
  return {
    kind: "ok",
    context: {
      state,
      stateVersion,
      fallbackCount: 0,
      vehicles: [vehicle],
      conversationStateId,
    },
    activeVehicleIssue: null,
  };
}

describeIfDb("MJ2B-V F1 — corrente completa applied (despesa)", () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession("setup");
    await session.begin();
    await cleanupBaseFixtures(session);
    await session.commit();
    await session.begin();
    await seedBaseFixtures(session);
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

  test("claim -> execute_expense (applied) -> apply (idle) — tudo persiste", async () => {
    const before = await fetchDespesaCount(session, SYNTH_VEHICLE_ID);
    expect(before).toBe(0);

    const reportMsgId = await seedReportMessage(session, "gasolina 80 reais");
    const draftPayload = {
      phase: "awaiting_confirmation",
      categoria: "Combustível",
      valor: 80,
      vehicleId: SYNTH_VEHICLE_ID,
      requestMessageId: reportMsgId,
    };
    const conversationStateId = await seedConversationState(session, {
      draftId: reportMsgId,
      state: "awaiting_expense_confirmation",
      draftPayload,
      stateVersion: 0,
    });
    const { messageId: confirmMsgId, queueId } =
      await seedConfirmationQueueItem(session, "sim");

    const claim = await session.query<ClaimedRow>(
      `select * from public.claim_whatsapp_orchestrator_items($1, $2, $3)`,
      [WORKER, 1, 60],
    );
    expect(claim.rows.length).toBe(1);
    expect(claim.rows[0]?.queue_id).toBe(queueId);
    const leaseToken = claim.rows[0]?.lease_token;
    expect(leaseToken).toBeTruthy();

    const exec = await session.query<{ execute_whatsapp_expense_create: ExecResult }>(
      `select public.execute_whatsapp_expense_create(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
       ) as execute_whatsapp_expense_create`,
      [
        reportMsgId,
        conversationStateId,
        confirmMsgId,
        crypto.randomUUID(),
        queueId,
        SYNTH_USER_ID,
        SYNTH_CONTACT_ID,
        SYNTH_VEHICLE_ID,
        "Combustível",
        80,
        null,
        0,
        ORCH_VERSION,
      ],
    );
    const execResult = exec.rows[0]?.execute_whatsapp_expense_create;
    expect(execResult?.kind).toBe("applied");
    expect(execResult?.despesaId).toBeTruthy();

    const ctxMock = buildCtxMock(conversationStateId, reportMsgId, draftPayload, 0);
    const finalization = buildExpenseFinalization(
      execResult as unknown as ConfirmedExpenseCreateResult,
      ctxMock,
      SYNTH_VEHICLE_ID,
    );
    expect(finalization.kind).toBe("finalize");
    if (finalization.kind !== "finalize") throw new Error("expected finalize");
    const decision = finalization.decision;
    expect(decision.responseKey).toBe("expense_create_completed");

    const textBody = renderResponse(decision.responseKey, decision.responseParams);
    const patch = serializePatch(decision.statePatch);
    const response = serializeResponse({
      responseKey: decision.responseKey,
      messageType: "text",
      purpose: "general",
      textBody,
    });
    const resultSummary = {
      decisionKind: decision.decisionKind,
      eventKind: decision.eventKind,
      outcome: decision.outcome,
    };

    const apply = await session.query<{ apply_whatsapp_orchestrator_transition: ApplyResult }>(
      `select public.apply_whatsapp_orchestrator_transition($1,$2,$3,$4,$5,$6,$7)
         as apply_whatsapp_orchestrator_transition`,
      [queueId, leaseToken, 0, patch, ORCH_VERSION, resultSummary, response],
    );
    const applyResult = apply.rows[0]?.apply_whatsapp_orchestrator_transition;
    expect(applyResult?.ok).toBe(true);
    expect(applyResult?.wasReplay).toBe(false);

    const despCount = await fetchDespesaCount(session, SYNTH_VEHICLE_ID);
    expect(despCount).toBe(1);

    const desp = await session.query<{
      user_id: string;
      vehicle_id: string;
      categoria: string;
      valor: string;
    }>(
      `select user_id, vehicle_id, categoria, valor::text as valor
         from public.despesas where vehicle_id = $1`,
      [SYNTH_VEHICLE_ID],
    );
    expect(desp.rows[0]?.user_id).toBe(SYNTH_USER_ID);
    expect(desp.rows[0]?.vehicle_id).toBe(SYNTH_VEHICLE_ID);
    expect(desp.rows[0]?.categoria).toBe("Combustível");
    expect(Number(desp.rows[0]?.valor)).toBe(80);

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

    const outbound = await session.query<{ n: string; text_body: string | null }>(
      `select count(*)::text as n, max(text_body) as text_body
         from public.whatsapp_outbound_queue where contact_id = $1`,
      [SYNTH_CONTACT_ID],
    );
    expect(Number(outbound.rows[0]?.n)).toBe(1);
    expect(outbound.rows[0]?.text_body).toBe(textBody);

    const execRows = await session.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_action_executions
        where draft_id = $1 and action_type = 'expense_create' and status = 'succeeded'`,
      [reportMsgId],
    );
    expect(Number(execRows.rows[0]?.n)).toBe(1);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ2B-V F1] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
