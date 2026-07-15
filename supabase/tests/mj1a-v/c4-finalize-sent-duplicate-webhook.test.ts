/**
 * MJ1A-V — Cenário C4: finalize_sent concorrente (webhook duplicado).
 *
 * Cenário realista: o provedor (Z-API/WhatsApp) reenvia o mesmo webhook de
 * "mensagem enviada" duas vezes (retry de rede). Duas chamadas concorrentes
 * de public.finalize_whatsapp_km_prompt_sent para o MESMO outbound_queue_id
 * e o MESMO provider_message_id não podem promover o request duas vezes.
 *
 * Diferente do C1/C2: essa RPC NÃO usa pg_advisory_xact_lock — sincroniza
 * via SELECT ... FOR UPDATE na própria linha de whatsapp_outbound_queue.
 * A prova de bloqueio real aqui é via pg_stat_activity.wait_event_type =
 * 'Lock' (lock de linha), não pg_locks locktype = 'advisory'.
 *
 * Setup: depois do enqueue normal (que deixa a fila em 'queued'), este
 * teste faz um UPDATE direto em whatsapp_outbound_queue.status = 'sending'
 * para simular o worker de envio — não existe RPC de "claim" para essa
 * transição no pipeline de KM prompt (auditado antes de escrever este
 * teste: as únicas funções que tocam whatsapp_outbound_queue são
 * enqueue/finalize_sent/finalize_failed). Esse UPDATE não é RPC nem
 * migration, só avança o estado no banco de teste efêmero até a
 * pré-condição que a própria RPC já exige.
 *
 * Sincronização determinística: sessão A abre tx, chama finalize_sent e
 * NÃO commita — mantém o lock de linha. Sessão B dispara a mesma chamada
 * (mesmo queue_id, mesmo provider_message_id) e bloqueia de verdade
 * (confirmado via pg_stat_activity). A commita, B desbloqueia e deve
 * receber 'replayed', nunca um segundo 'finalized'.
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

const IDEMPOTENCY_KEY = "mj1av-c4-key";
const TEXT_BODY = "MJ1A-V C4 synthetic — qual a quilometragem atual?";
const PROVIDER_MESSAGE_ID = "mj1av-c4-wamid-duplicado";
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

describeIfDb("MJ1A-V C4 — finalize_whatsapp_km_prompt_sent com webhook duplicado", () => {
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

  test("webhook duplicado — A finaliza, B recebe replay, sem dupla promoção", async () => {
    // (0a) Enqueue normal — fila nasce 'queued'.
    const enqueue = await setup.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
      `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
         as enqueue_whatsapp_km_prompt`,
      [IDEMPOTENCY_KEY, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID, TEXT_BODY],
    );
    const enqueueResult = enqueue.rows[0]?.enqueue_whatsapp_km_prompt;
    expect(enqueueResult?.result).toBe("created");
    const queueId = enqueueResult?.outbound_queue_id;
    const messageId = enqueueResult?.prompt_message_id;
    const originalRequestId = enqueueResult?.prompt_request_id;
    expect(queueId).toBeTruthy();
    expect(messageId).toBeTruthy();
    expect(originalRequestId).toBeTruthy();

    // (0b) Simula o worker de envio: move a fila para 'sending'. NÃO é RPC
    // nem migration — não existe RPC de "claim" para este pipeline.
    await setup.query(
      `update public.whatsapp_outbound_queue set status = 'sending' where id = $1`,
      [queueId],
    );

    // (1) A abre tx e finaliza — adquire o lock de linha via FOR UPDATE
    // dentro da própria RPC, mas NÃO commita ainda.
    await a.begin();
    const aResultPromise = a.query<{ finalize_whatsapp_km_prompt_sent: FinalizeSentResult }>(
      `select public.finalize_whatsapp_km_prompt_sent($1, $2)
         as finalize_whatsapp_km_prompt_sent`,
      [queueId, PROVIDER_MESSAGE_ID],
    );
    const aResultRaw = await aResultPromise;
    const aResult = aResultRaw.rows[0]?.finalize_whatsapp_km_prompt_sent;
    expect(aResult?.result).toBe("finalized");
    expect(aResult?.prompt_request_id).toBe(originalRequestId);
    expect(aResult?.pending_at).toBeTruthy();
    expect(aResult?.expires_at).toBeTruthy();

    // (2) B dispara o MESMO webhook (mesmo queue_id, mesmo
    // provider_message_id) — deve bloquear no lock de linha, porque A
    // ainda não commitou.
    const bResultPromise = b.query<{ finalize_whatsapp_km_prompt_sent: FinalizeSentResult }>(
      `select public.finalize_whatsapp_km_prompt_sent($1, $2)
         as finalize_whatsapp_km_prompt_sent`,
      [queueId, PROVIDER_MESSAGE_ID],
    );

    await waitFor(
      () => waitingOnRowLock(ctl, b.backendPid),
      POLL_TIMEOUT_MS,
      "B bloquear no lock de linha (FOR UPDATE)",
    );

    // (3) A commita — libera o lock de linha.
    await a.commit();

    const bResultRaw = await bResultPromise;
    const bResult = bResultRaw.rows[0]?.finalize_whatsapp_km_prompt_sent;

    // B recebe REPLAY, não um segundo 'finalized' — a promoção não roda
    // de novo.
    expect(bResult?.result).toBe("replayed");
    expect(bResult?.prompt_request_id).toBe(aResult?.prompt_request_id);
    expect(bResult?.prompt_message_id).toBe(aResult?.prompt_message_id);
    expect(bResult?.outbound_queue_id).toBe(aResult?.outbound_queue_id);
    expect(bResult?.pending_at).toBe(aResult?.pending_at);
    expect(bResult?.expires_at).toBe(aResult?.expires_at);

    // (4) Estado final: fila e mensagem 'sent', com o provider_message_id
    // correto — sem duplicar nem sobrescrever com valor diferente.
    const qQueue = await ctl.query<{ status: string; provider_message_id: string }>(
      `select status, provider_message_id
         from public.whatsapp_outbound_queue
        where id = $1`,
      [queueId],
    );
    expect(qQueue.rows[0]?.status).toBe("sent");
    expect(qQueue.rows[0]?.provider_message_id).toBe(PROVIDER_MESSAGE_ID);

    const qMsg = await ctl.query<{ status: string; provider_message_id: string }>(
      `select status, provider_message_id
         from public.whatsapp_messages
        where id = $1`,
      [messageId],
    );
    expect(qMsg.rows[0]?.status).toBe("sent");
    expect(qMsg.rows[0]?.provider_message_id).toBe(PROVIDER_MESSAGE_ID);

    // (5) Request: exatamente 1 linha, promovido exatamente 1 vez —
    // 'pending', com pending_at/expires_at batendo com o que A recebeu.
    // Comparação feita DENTRO do SQL (cast para timestamptz) para evitar
    // falso-negativo por formatação de data (Date do node-pg vs string do
    // jsonb da RPC).
    const qReqCount = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_km_prompt_requests
        where prompt_message_id = $1`,
      [messageId],
    );
    expect(Number(qReqCount.rows[0]?.n)).toBe(1);

    const qReqStatus = await ctl.query<{
      status: string;
      pending_at_matches: boolean;
      expires_at_matches: boolean;
    }>(
      `select status,
              (pending_at = $2::timestamptz) as pending_at_matches,
              (expires_at = $3::timestamptz) as expires_at_matches
         from public.whatsapp_km_prompt_requests
        where id = $1`,
      [originalRequestId, aResult?.pending_at, aResult?.expires_at],
    );
    expect(qReqStatus.rows[0]?.status).toBe("pending");
    expect(qReqStatus.rows[0]?.pending_at_matches).toBe(true);
    expect(qReqStatus.rows[0]?.expires_at_matches).toBe(true);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1A-V C4] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
