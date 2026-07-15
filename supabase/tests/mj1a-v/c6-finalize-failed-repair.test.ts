/**
 * MJ1A-V — Cenário C6: finalize_failed — reparo de estado inconsistente
 * (self-heal).
 *
 * Não é um teste de concorrência física (não há duas sessões disputando
 * lock) — é validação de um caminho defensivo já embutido na RPC: se a fila
 * e a mensagem já estão 'failed' mas o request ainda está 'queued' (nunca
 * foi cancelado — um estado que só existiria por uma falha parcial fora do
 * fluxo normal, já que a própria RPC faz os 3 updates na mesma transação),
 * finalize_whatsapp_km_prompt_failed detecta a inconsistência, cancela o
 * request sozinha e retorna 'terminal_replayed' com repaired=true.
 *
 * Setup: depois do enqueue normal, este teste faz UPDATE direto em
 * whatsapp_outbound_queue e whatsapp_messages para 'failed', deixando o
 * request intocado em 'queued' — simula o estado inconsistente. Não é RPC
 * nem migration, mesma lógica do C4/C5.
 *
 * Cobertura secundária: chamar a RPC de novo na mesma linha, já 100%
 * consistente (failed+failed+cancelled), deve retornar 'terminal_replayed'
 * SEM repaired=true — confirma que o reparo não é reaplicado à toa.
 *
 * Ambiente: SÓ roda em Postgres local (guard preflight). Skipa em bun test
 * padrão quando TEST_DATABASE_URL não está setado.
 *
 * Não modifica RPCs, migrations, Edge Functions ou src/. Não liga
 * orchestrator_mode. Não conecta caller produtivo.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { openSession, type Session } from "../harness/db";

import {
  SYNTH_CONTACT_ID,
  SYNTH_VEHICLE_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  seedBaseFixtures,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";

const describeIfDb = HAS_DB ? describe : describe.skip;

const IDEMPOTENCY_KEY = "mj1av-c6-key";
const TEXT_BODY = "MJ1A-V C6 synthetic — qual a quilometragem atual?";
const TERMINAL_REASON = "non_retryable_provider_error";
const ERROR_MESSAGE = "erro sintético MJ1A-V C6 — estado pré-inconsistente";

type EnqueueResult = {
  result: string;
  prompt_request_id?: string;
  prompt_message_id?: string;
  outbound_queue_id?: string;
};

type FinalizeFailedResult = {
  result: string;
  prompt_request_id?: string;
  terminal_reason?: string;
  repaired?: boolean;
};

describeIfDb("MJ1A-V C6 — finalize_whatsapp_km_prompt_failed reparo (self-heal)", () => {
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

  test("fila+mensagem 'failed' com request ainda 'queued' — RPC repara sozinha", async () => {
    // (1) Enqueue normal.
    const enqueue = await session.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
      `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
         as enqueue_whatsapp_km_prompt`,
      [IDEMPOTENCY_KEY, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID, TEXT_BODY],
    );

    const enqueueResult = enqueue.rows[0]?.enqueue_whatsapp_km_prompt;
    expect(enqueueResult?.result).toBe("created");

    const queueId = enqueueResult?.outbound_queue_id;
    const messageId = enqueueResult?.prompt_message_id;
    const requestId = enqueueResult?.prompt_request_id;

    expect(queueId).toBeTruthy();
    expect(messageId).toBeTruthy();
    expect(requestId).toBeTruthy();

    // (2) Simula o estado inconsistente: fila e mensagem já 'failed', mas
    // o request continua 'queued' (nunca foi cancelado).
    await session.query(
      `update public.whatsapp_outbound_queue set status = 'failed', error_message = $2 where id = $1`,
      [queueId, "pre-existing-inconsistent-state"],
    );
    await session.query(
      `update public.whatsapp_messages set status = 'failed' where id = $1`,
      [messageId],
    );

    const preCheck = await session.query<{ status: string }>(
      `select status from public.whatsapp_km_prompt_requests where id = $1`,
      [requestId],
    );
    expect(preCheck.rows[0]?.status).toBe("queued");

    // (3) Chama finalize_failed nessa linha inconsistente — deve reparar.
    const repair = await session.query<{ finalize_whatsapp_km_prompt_failed: FinalizeFailedResult }>(
      `select public.finalize_whatsapp_km_prompt_failed($1, $2, $3)
         as finalize_whatsapp_km_prompt_failed`,
      [queueId, TERMINAL_REASON, ERROR_MESSAGE],
    );

    const repairResult = repair.rows[0]?.finalize_whatsapp_km_prompt_failed;
    expect(repairResult?.result).toBe("terminal_replayed");
    expect(repairResult?.repaired).toBe(true);
    expect(repairResult?.prompt_request_id).toBe(requestId);

    // (4) Request agora está cancelado de verdade.
    const postCheck = await session.query<{
      status: string;
      cancelled_at: string | null;
    }>(
      `select status, cancelled_at
         from public.whatsapp_km_prompt_requests
        where id = $1`,
      [requestId],
    );
    expect(postCheck.rows[0]?.status).toBe("cancelled");
    expect(postCheck.rows[0]?.cancelled_at).not.toBeNull();

    // (5) Bônus: chamando de novo na mesma linha, já 100% consistente
    // (failed+failed+cancelled) — replay normal, SEM repaired=true.
    const secondCall = await session.query<{ finalize_whatsapp_km_prompt_failed: FinalizeFailedResult }>(
      `select public.finalize_whatsapp_km_prompt_failed($1, $2, $3)
         as finalize_whatsapp_km_prompt_failed`,
      [queueId, TERMINAL_REASON, ERROR_MESSAGE],
    );

    const secondResult = secondCall.rows[0]?.finalize_whatsapp_km_prompt_failed;
    expect(secondResult?.result).toBe("terminal_replayed");
    expect(secondResult?.repaired).toBeFalsy();
    expect(secondResult?.prompt_request_id).toBe(requestId);

    // (6) Estado final inalterado pela segunda chamada.
    const finalCheck = await session.query<{ status: string }>(
      `select status from public.whatsapp_km_prompt_requests where id = $1`,
      [requestId],
    );
    expect(finalCheck.rows[0]?.status).toBe("cancelled");
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1A-V C6] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
