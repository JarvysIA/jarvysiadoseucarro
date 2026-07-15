/**
 * MJ1A-V — Cenário C2: enqueue + rollback libera o advisory lock.
 *
 * Prova que quando a sessão que primeiro adquire o advisory lock em
 * public.enqueue_whatsapp_km_prompt aborta a transação (ROLLBACK) em vez de
 * commitar, o lock é liberado e a inserção é desfeita de verdade — a segunda
 * sessão, que estava bloqueada esperando, assume como dona real da emissão
 * ('created'), não como replay ('replayed').
 *
 * Sincronização determinística via pg_advisory_xact_lock que a própria RPC
 * adquire — a segunda sessão bloqueia de verdade no lock interno até a
 * primeira sessão finalizar a transação (commit OU rollback). Sem pg_sleep,
 * sem Promise.all fingido.
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

const IDEMPOTENCY_KEY = "mj1av-c2-key";
const TEXT_BODY = "MJ1A-V C2 synthetic — qual a quilometragem atual?";
const POLL_INTERVAL_MS = 25;
const POLL_TIMEOUT_MS = 5_000;

type EnqueueResult = {
  result: string;
  prompt_request_id?: string;
  prompt_message_id?: string;
  outbound_queue_id?: string;
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

async function holdsAdvisoryLock(
  ctl: Session,
  pid: number,
): Promise<boolean> {
  const r = await ctl.query<{ n: string }>(
    `select count(*)::text as n
       from pg_locks
      where locktype = 'advisory'
        and granted = true
        and pid = $1`,
    [pid],
  );
  return Number(r.rows[0]?.n ?? "0") > 0;
}

async function waitingOnAdvisoryLock(
  ctl: Session,
  pid: number,
): Promise<boolean> {
  const r = await ctl.query<{ n: string }>(
    `select count(*)::text as n
       from pg_locks
      where locktype = 'advisory'
        and granted = false
        and pid = $1`,
    [pid],
  );
  return Number(r.rows[0]?.n ?? "0") > 0;
}

describeIfDb("MJ1A-V C2 — enqueue_whatsapp_km_prompt + rollback libera lock", () => {
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

  test("rollback de A libera o lock — B assume como created, não replayed", async () => {
    // (1) A abre tx e dispara enqueue — adquire o advisory lock e insere as
    // 3 linhas, mas NÃO commita.
    await a.begin();
    const aResultPromise = a.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
      `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
         as enqueue_whatsapp_km_prompt`,
      [IDEMPOTENCY_KEY, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID, TEXT_BODY],
    );

    const aResultRaw = await aResultPromise;
    const aResult = aResultRaw.rows[0]?.enqueue_whatsapp_km_prompt;
    expect(aResult?.result).toBe("created");

    const aRequestId = aResult?.prompt_request_id;
    const aMessageId = aResult?.prompt_message_id;
    const aQueueId = aResult?.outbound_queue_id;
    expect(aRequestId).toBeTruthy();
    expect(aMessageId).toBeTruthy();
    expect(aQueueId).toBeTruthy();

    // Confirma que A ainda detém o advisory lock (tx aberta).
    await waitFor(
      () => holdsAdvisoryLock(ctl, a.backendPid),
      POLL_TIMEOUT_MS,
      "A adquirir advisory lock",
    );

    // (2) B dispara enqueue com a MESMA key — deve bloquear no advisory lock.
    const bResultPromise = b.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
      `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
         as enqueue_whatsapp_km_prompt`,
      [IDEMPOTENCY_KEY, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID, TEXT_BODY],
    );

    await waitFor(
      () => waitingOnAdvisoryLock(ctl, b.backendPid),
      POLL_TIMEOUT_MS,
      "B bloquear no advisory lock",
    );

    // (3) A ABORTA (ROLLBACK), não commita — desfaz o insert e libera o lock.
    await a.rollback();

    const bResultRaw = await bResultPromise;
    const bResult = bResultRaw.rows[0]?.enqueue_whatsapp_km_prompt;

    // B não encontra replay (linha de A foi desfeita) — assume como dona real.
    expect(bResult?.result).toBe("created");
    expect(bResult?.prompt_request_id).toBeTruthy();
    expect(bResult?.prompt_message_id).toBeTruthy();
    expect(bResult?.outbound_queue_id).toBeTruthy();

    // IDs de B devem ser DIFERENTES dos de A (A foi desfeito de verdade).
    expect(bResult?.prompt_request_id).not.toBe(aRequestId);
    expect(bResult?.prompt_message_id).not.toBe(aMessageId);
    expect(bResult?.outbound_queue_id).not.toBe(aQueueId);

    // (4) Contagens: exatamente 1 linha por tabela para esta key — a de B.
    const q1 = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_outbound_queue
        where idempotency_key = $1`,
      [IDEMPOTENCY_KEY],
    );
    expect(Number(q1.rows[0]?.n)).toBe(1);

    const q1id = await ctl.query<{ id: string }>(
      `select id::text as id
         from public.whatsapp_outbound_queue
        where idempotency_key = $1`,
      [IDEMPOTENCY_KEY],
    );
    expect(q1id.rows[0]?.id).toBe(bResult?.outbound_queue_id);

    const q2 = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_messages
        where id = $1`,
      [bResult?.prompt_message_id],
    );
    expect(Number(q2.rows[0]?.n)).toBe(1);

    // Mensagem de A não pode existir — o rollback desfez de verdade.
    const qAGone = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_messages
        where id = $1`,
      [aMessageId],
    );
    expect(Number(qAGone.rows[0]?.n)).toBe(0);

    const q3 = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_km_prompt_requests
        where prompt_message_id = $1`,
      [bResult?.prompt_message_id],
    );
    expect(Number(q3.rows[0]?.n)).toBe(1);

    // (5) Estado do request de B: 'queued' (ainda não enviado).
    const qStatus = await ctl.query<{ status: string }>(
      `select status from public.whatsapp_km_prompt_requests where id = $1`,
      [bResult?.prompt_request_id],
    );
    expect(qStatus.rows[0]?.status).toBe("queued");

    // (6) Lock não pode mais estar retido por A (tx já finalizada via rollback).
    const lockGone = await holdsAdvisoryLock(ctl, a.backendPid);
    expect(lockGone).toBe(false);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1A-V C2] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
