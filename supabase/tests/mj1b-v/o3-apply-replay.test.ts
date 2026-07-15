/**
 * MJ1B-V — Cenário O3: replay durável de apply_whatsapp_orchestrator_transition.
 *
 * Não é um teste de concorrência física — é validação sequencial de
 * idempotência: um worker chama apply() com sucesso (fila vira 'done'),
 * mas por qualquer motivo do lado dele (timeout, conexão caindo na volta
 * da resposta) acha que a chamada falhou e tenta de novo com os MESMOS
 * parâmetros — inclusive o mesmo lease_token, que já foi limpo no banco
 * pela primeira chamada. A RPC precisa detectar que o item já está 'done'
 * (orchestrator_processed_at/result/version preenchidos) e devolver
 * exatamente o mesmo resultado gravado, ANTES de sequer checar o lease —
 * confirmado lendo o código: a checagem de replay vem antes da checagem
 * de lease na função.
 *
 * Prova negativa: nada pode duplicar na segunda chamada — nem a linha de
 * whatsapp_outbound_queue (idempotência por chave), nem o state_version
 * de whatsapp_conversation_states (tem que continuar em 1, não virar 2).
 *
 * Ambiente: SÓ roda em Postgres local (guard preflight). Skipa em bun test
 * padrão quando TEST_DATABASE_URL não está setado.
 *
 * Não modifica RPCs, migrations, Edge Functions ou src/. Instância
 * sintética (orchestrator_mode='test' só no banco efêmero de CI). Não
 * conecta caller produtivo.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";
import {
  SYNTH_CONTACT_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  seedBaseFixtures,
  seedOrchestratorQueueItem,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";

const describeIfDb = HAS_DB ? describe : describe.skip;

const WORKER_A = "mj1bv-o3-worker-a";
const ORCH_VERSION = "mj1bv-o3-v1";

type ClaimedRow = {
  queue_id: string;
  message_id: string;
  contact_id: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  was_recovered: boolean;
  orchestrator_mode: string;
};

type OrchestratorResult = {
  decisionKind: string;
  eventKind: string;
  outcome: string;
  responseKey: string | null;
  nextState: string;
  stateVersion: number;
  outboundQueueId: string | null;
};

type ApplyResult = {
  ok: boolean;
  reason?: string;
  wasReplay?: boolean;
  orchestratorResult?: OrchestratorResult;
  currentStateVersion?: number;
};

describeIfDb("MJ1B-V O3 — replay durável de apply_whatsapp_orchestrator_transition", () => {
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

  test("apply() chamado 2x com os mesmos parâmetros -> segunda vez é replay, nada duplica", async () => {
    // (1) Item elegível único + claim normal.
    const { queueId } = await seedOrchestratorQueueItem(
      session,
      "MJ1B-V O3 synthetic — mensagem de teste",
    );

    const claim = await session.query<ClaimedRow>(
      `select * from public.claim_whatsapp_orchestrator_items($1, $2, $3)`,
      [WORKER_A, 1, 60],
    );
    expect(claim.rows.length).toBe(1);
    const leaseToken = claim.rows[0]?.lease_token;
    expect(leaseToken).toBeTruthy();

    // Payload da transição — mínimo válido, primeira conversa deste
    // contato (ainda sem whatsapp_conversation_states).
    const patch = { next_state: "awaiting_vehicle" };
    const resultSummary = {
      decisionKind: "respond",
      eventKind: "unknown",
      outcome: "none",
    };
    const response = {
      response_key: "o3-ack",
      text_body: "MJ1B-V O3 synthetic — resposta de teste",
    };

    // (2) Primeira chamada — aplica de verdade.
    const first = await session.query<{ apply_whatsapp_orchestrator_transition: ApplyResult }>(
      `select public.apply_whatsapp_orchestrator_transition($1, $2, $3, $4, $5, $6, $7)
         as apply_whatsapp_orchestrator_transition`,
      [queueId, leaseToken, 0, patch, ORCH_VERSION, resultSummary, response],
    );
    const firstResult = first.rows[0]?.apply_whatsapp_orchestrator_transition;
    expect(firstResult?.ok).toBe(true);
    expect(firstResult?.wasReplay).toBe(false);
    expect(firstResult?.orchestratorResult?.stateVersion).toBe(1);
    expect(firstResult?.orchestratorResult?.outboundQueueId).toBeTruthy();

    // (3) Segunda chamada — MESMOS parâmetros, inclusive o lease_token já
    // limpo no banco pela primeira chamada. Tem que ser replay.
    const second = await session.query<{ apply_whatsapp_orchestrator_transition: ApplyResult }>(
      `select public.apply_whatsapp_orchestrator_transition($1, $2, $3, $4, $5, $6, $7)
         as apply_whatsapp_orchestrator_transition`,
      [queueId, leaseToken, 0, patch, ORCH_VERSION, resultSummary, response],
    );
    const secondResult = second.rows[0]?.apply_whatsapp_orchestrator_transition;
    expect(secondResult?.ok).toBe(true);
    expect(secondResult?.wasReplay).toBe(true);
    expect(secondResult?.orchestratorResult).toEqual(firstResult?.orchestratorResult);

    // (4) Nada duplicou no banco.
    const stateRows = await session.query<{ state_version: number }>(
      `select state_version::int as state_version
         from public.whatsapp_conversation_states
        where contact_id = $1`,
      [SYNTH_CONTACT_ID],
    );
    expect(stateRows.rows.length).toBe(1);
    expect(stateRows.rows[0]?.state_version).toBe(1);

    const outboundRows = await session.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_outbound_queue
        where contact_id = $1`,
      [SYNTH_CONTACT_ID],
    );
    expect(Number(outboundRows.rows[0]?.n)).toBe(1);

    const queueRow = await session.query<{
      status: string;
      orchestrator_processed_at: string;
    }>(
      `select status, orchestrator_processed_at
         from public.whatsapp_processing_queue
        where id = $1`,
      [queueId],
    );
    expect(queueRow.rows[0]?.status).toBe("done");
    expect(queueRow.rows[0]?.orchestrator_processed_at).toBeTruthy();
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1B-V O3] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
