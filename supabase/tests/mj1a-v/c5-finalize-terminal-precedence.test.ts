/**
 * MJ1A-V — Cenário C5: precedência entre finalize_sent e finalize_failed
 * disputando a MESMA linha de whatsapp_outbound_queue.
 *
 * As duas RPCs fazem SELECT ... FOR UPDATE na mesma linha — então chamá-las
 * concorrentemente para o mesmo outbound_queue_id serializa pelo mesmo lock
 * de linha, não importa qual RPC é chamada primeiro. Prova de bloqueio real
 * via pg_stat_activity.wait_event_type = 'Lock' (mesmo padrão do C4).
 *
 * Cenário A — "sucesso vence sempre" (regra nomeada, embutida na RPC):
 * webhook de sucesso e sinal de falha (ex.: timeout do worker) chegam quase
 * juntos para o mesmo envio. finalize_sent comita primeiro; finalize_failed,
 * que estava bloqueado no lock, desbloqueia e vê status='sent' — a RPC tem
 * a checagem explícita e retorna 'terminal_after_success_invariant' sem
 * tocar em nada.
 *
 * Cenário B (bônus) — estado terminal não é flipável no sentido inverso:
 * finalize_failed comita primeiro (fila vira 'failed'); um finalize_sent
 * atrasado para a mesma linha não encontra 'sending' nem 'sent' e retorna
 * 'queue_state_invalid' — não é a mesma regra nomeada do Cenário A (não há
 * checagem explícita para "já failed"), mas confirma que nenhum dos dois
 * lados sobrescreve um terminal já resolvido.
 *
 * Setup: mesmo truque do C4 — UPDATE direto para 'sending' depois do
 * enqueue, simulando o worker de envio (não há RPC de claim para isso).
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

const IDEMPOTENCY_KEY_SUCCESS_FIRST = "mj1av-c5-key-success-first";
const IDEMPOTENCY_KEY_FAILURE_FIRST = "mj1av-c5-key-failure-first";
const TEXT_BODY_SUCCESS_FIRST = "MJ1A-V C5 synthetic — sucesso primeiro";
const TEXT_BODY_FAILURE_FIRST = "MJ1A-V C5 synthetic — falha primeiro";
const PROVIDER_MESSAGE_ID = "mj1av-c5-wamid";
const TERMINAL_REASON = "non_retryable_provider_error";
const ERROR_MESSAGE = "erro sintético concorrente MJ1A-V C5";

const POLL_INTERVAL_MS = 25;
const POLL_TIMEOUT_MS = 5_000;

type EnqueueResult = {
  result: string;
  prompt_request_id?: string;
  prompt_message_id?: string;
  outbound_queue_id?: string;
};

type FinalizeSentResult = {
  result: string;
  prompt_request_id?: string;
  prompt_message_id?: string;
  outbound_queue_id?: string;
  pending_at?: string;
  expires_at?: string;
};

type FinalizeFailedResult = {
  result: string;
  prompt_request_id?: string;
  prompt_message_id?: string;
  outbound_queue_id?: string;
  terminal_reason?: string;
  repaired?: boolean;
};

async function waitFor(
  probe: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await probe()) return;
    if (Date.now() >= deadline) {
      throw new Error(`timeout aguardando: ${label}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function waitingOnRowLock(
  ctl: Session,
  pid: number,
): Promise<boolean> {
  const r = await ctl.query<{ n: string }>(
    `select count(*)::text as n
       from pg_stat_activity
      where pid = $1
        and wait_event_type = 'Lock'`,
    [pid],
  );
  return Number(r.rows[0]?.n ?? "0") > 0;
}

async function enqueueAndClaim(
  setup: Session,
  idempotencyKey: string,
  textBody: string,
): Promise<{ queueId: string; messageId: string; requestId: string }> {
  const enqueue = await setup.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
    `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
       as enqueue_whatsapp_km_prompt`,
    [idempotencyKey, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID, textBody],
  );
  const result = enqueue.rows[0]?.enqueue_whatsapp_km_prompt;
  if (result?.result !== "created") {
    throw new Error(`setup: enqueue não retornou 'created' (${result?.result})`);
  }
  const queueId = result.outbound_queue_id as string;
  const messageId = result.prompt_message_id as string;
  const requestId = result.prompt_request_id as string;

  // Simula o worker de envio movendo a fila para 'sending'. Não é RPC nem
  // migration — não existe claim para este pipeline (ver C4).
  await setup.query(
    `update public.whatsapp_outbound_queue set status = 'sending' where id = $1`,
    [queueId],
  );

  return { queueId, messageId, requestId };
}

describeIfDb("MJ1A-V C5 — precedência entre finalize_sent e finalize_failed", () => {
  let setup: Session;
  let ctl: Session;
  let a: Session;
  let b: Session;

  beforeAll(async () => {
    setup = await openSession("setup");
    ctl = await openSession("ctl");
    a = await openSession("A");
    b = await openSession("B");
    if (a.backendPid === b.backendPid) {
      throw new Error("PIDs iguais — sessões não são físicas independentes");
    }
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
      if (residue !== 0) {
        throw new Error(`resíduo sintético != 0 após cleanup: ${residue}`);
      }
    } finally {
      await a?.close();
      await b?.close();
      await ctl?.close();
      await setup?.close();
    }
  });

  test("sucesso vence sempre — finalize_sent comita, finalize_failed concorrente é bloqueado pela invariante", async () => {
    const { queueId, messageId, requestId } = await enqueueAndClaim(
      setup,
      IDEMPOTENCY_KEY_SUCCESS_FIRST,
      TEXT_BODY_SUCCESS_FIRST,
    );

    // (1) A finaliza como SUCESSO — adquire o lock de linha, não commita.
    await a.begin();
    const aResultPromise = a.query<{ finalize_whatsapp_km_prompt_sent: FinalizeSentResult }>(
      `select public.finalize_whatsapp_km_prompt_sent($1, $2)
         as finalize_whatsapp_km_prompt_sent`,
      [queueId, PROVIDER_MESSAGE_ID],
    );
    const aResultRaw = await aResultPromise;
    const aResult = aResultRaw.rows[0]?.finalize_whatsapp_km_prompt_sent;
    expect(aResult?.result).toBe("finalized");
    expect(aResult?.prompt_request_id).toBe(requestId);
    expect(aResult?.pending_at).toBeTruthy();
    expect(aResult?.expires_at).toBeTruthy();

    // (2) B tenta finalizar como FALHA para a MESMA linha — bloqueia.
    const bResultPromise = b.query<{ finalize_whatsapp_km_prompt_failed: FinalizeFailedResult }>(
      `select public.finalize_whatsapp_km_prompt_failed($1, $2, $3)
         as finalize_whatsapp_km_prompt_failed`,
      [queueId, TERMINAL_REASON, ERROR_MESSAGE],
    );
    await waitFor(
      () => waitingOnRowLock(ctl, b.backendPid),
      POLL_TIMEOUT_MS,
      "B (finalize_failed) bloquear no lock de linha",
    );

    // (3) A commita — sucesso vence.
    await a.commit();

    const bResultRaw = await bResultPromise;
    const bResult = bResultRaw.rows[0]?.finalize_whatsapp_km_prompt_failed;
    expect(bResult?.result).toBe("terminal_after_success_invariant");

    // (4) Estado final: nada foi tocado pela tentativa de falha.
    const qQueue = await ctl.query<{
      status: string;
      error_message: string | null;
      provider_message_id: string;
    }>(
      `select status, error_message, provider_message_id
         from public.whatsapp_outbound_queue
        where id = $1`,
      [queueId],
    );
    expect(qQueue.rows[0]?.status).toBe("sent");
    expect(qQueue.rows[0]?.error_message).toBeNull();
    expect(qQueue.rows[0]?.provider_message_id).toBe(PROVIDER_MESSAGE_ID);

    const qMsg = await ctl.query<{ status: string }>(
      `select status from public.whatsapp_messages where id = $1`,
      [messageId],
    );
    expect(qMsg.rows[0]?.status).toBe("sent");

    const qReq = await ctl.query<{
      status: string;
      pending_at_matches: boolean;
      expires_at_matches: boolean;
    }>(
      `select status,
              (pending_at = $2::timestamptz) as pending_at_matches,
              (expires_at = $3::timestamptz) as expires_at_matches
         from public.whatsapp_km_prompt_requests
        where id = $1`,
      [requestId, aResult?.pending_at, aResult?.expires_at],
    );
    expect(qReq.rows[0]?.status).toBe("pending");
    expect(qReq.rows[0]?.pending_at_matches).toBe(true);
    expect(qReq.rows[0]?.expires_at_matches).toBe(true);
  });

  test("estado terminal não flipa no sentido inverso — finalize_failed comita, finalize_sent atrasado não sobrescreve", async () => {
    const { queueId, messageId, requestId } = await enqueueAndClaim(
      setup,
      IDEMPOTENCY_KEY_FAILURE_FIRST,
      TEXT_BODY_FAILURE_FIRST,
    );

    // (1) A finaliza como FALHA — adquire o lock de linha, não commita.
    await a.begin();
    const aResultPromise = a.query<{ finalize_whatsapp_km_prompt_failed: FinalizeFailedResult }>(
      `select public.finalize_whatsapp_km_prompt_failed($1, $2, $3)
         as finalize_whatsapp_km_prompt_failed`,
      [queueId, TERMINAL_REASON, ERROR_MESSAGE],
    );
    const aResultRaw = await aResultPromise;
    const aResult = aResultRaw.rows[0]?.finalize_whatsapp_km_prompt_failed;
    expect(aResult?.result).toBe("finalized");
    expect(aResult?.prompt_request_id).toBe(requestId);
    expect(aResult?.terminal_reason).toBe(TERMINAL_REASON);

    // (2) B tenta finalizar como SUCESSO, atrasado, para a MESMA linha —
    // bloqueia.
    const bResultPromise = b.query<{ finalize_whatsapp_km_prompt_sent: FinalizeSentResult }>(
      `select public.finalize_whatsapp_km_prompt_sent($1, $2)
         as finalize_whatsapp_km_prompt_sent`,
      [queueId, PROVIDER_MESSAGE_ID],
    );
    await waitFor(
      () => waitingOnRowLock(ctl, b.backendPid),
      POLL_TIMEOUT_MS,
      "B (finalize_sent) bloquear no lock de linha",
    );

    // (3) A commita — falha já é terminal.
    await a.commit();

    const bResultRaw = await bResultPromise;
    const bResult = bResultRaw.rows[0]?.finalize_whatsapp_km_prompt_sent;
    expect(bResult?.result).toBe("queue_state_invalid");

    // (4) Estado final: continua 'failed', nunca virou 'sent'.
    const qQueue = await ctl.query<{
      status: string;
      provider_message_id: string | null;
    }>(
      `select status, provider_message_id
         from public.whatsapp_outbound_queue
        where id = $1`,
      [queueId],
    );
    expect(qQueue.rows[0]?.status).toBe("failed");
    expect(qQueue.rows[0]?.provider_message_id).toBeNull();

    const qMsg = await ctl.query<{ status: string }>(
      `select status from public.whatsapp_messages where id = $1`,
      [messageId],
    );
    expect(qMsg.rows[0]?.status).toBe("failed");

    const qReq = await ctl.query<{ status: string; cancelled_at: string | null }>(
      `select status, cancelled_at
         from public.whatsapp_km_prompt_requests
        where id = $1`,
      [requestId],
    );
    expect(qReq.rows[0]?.status).toBe("cancelled");
    expect(qReq.rows[0]?.cancelled_at).not.toBeNull();
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1A-V C5] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
