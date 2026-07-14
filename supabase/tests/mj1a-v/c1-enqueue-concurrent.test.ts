/**
 * MJ1A-V — Cenário C1: enqueue concorrente com mesma idempotency_key.
 *
 * Prova que duas chamadas concorrentes de public.enqueue_whatsapp_km_prompt
 * com a MESMA idempotency_key colapsam determinísticamente em 1 emissão real
 * ('created') + 1 replay ('replayed'), sem duplicar linhas em
 * whatsapp_messages / whatsapp_outbound_queue / whatsapp_km_prompt_requests.
 *
 * Sincronização determinística via pg_advisory_xact_lock que a própria RPC
 * adquire — a segunda sessão bloqueia de verdade no lock interno até a
 * primeira commitar. Sem pg_sleep, sem Promise.all fingido.
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
  SYNTH_USER_ID,
  SYNTH_VEHICLE_ID,
  cleanupBaseFixtures,
  countSyntheticResidue,
  seedBaseFixtures,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";

const describeIfDb = HAS_DB ? describe : describe.skip;

const IDEMPOTENCY_KEY = "mj1av-c1-key";
const TEXT_BODY = "MJ1A-V C1 synthetic — qual a quilometragem atual?";
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

describeIfDb("MJ1A-V C1 — enqueue_whatsapp_km_prompt concorrente", () => {
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

    // Garante ambiente limpo antes de semear.
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

  test("colapsa em created + replayed via advisory lock", async () => {
    // (1) A abre tx e dispara enqueue — a RPC adquire pg_advisory_xact_lock
    // e insere as 3 linhas, mas NÃO commita: quem commita é o cliente.
    await a.begin();
    const aResultPromise = a.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
      `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
         as enqueue_whatsapp_km_prompt`,
      [IDEMPOTENCY_KEY, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID, TEXT_BODY],
    );

    // Aguarda A retornar da RPC ainda dentro da tx (lock permanece até commit).
    const aResultRaw = await aResultPromise;
    const aResult = aResultRaw.rows[0]?.enqueue_whatsapp_km_prompt;
    expect(aResult?.result).toBe("created");
    expect(aResult?.prompt_request_id).toBeTruthy();
    expect(aResult?.prompt_message_id).toBeTruthy();
    expect(aResult?.outbound_queue_id).toBeTruthy();

    // Confirma que A ainda detém o advisory lock (tx aberta).
    await waitFor(
      () => holdsAdvisoryLock(ctl, a.backendPid),
      POLL_TIMEOUT_MS,
      "A adquirir advisory lock",
    );

    // (2) B dispara enqueue — deve bloquear no advisory lock enquanto A tx aberta.
    const bResultPromise = b.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
      `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
         as enqueue_whatsapp_km_prompt`,
      [IDEMPOTENCY_KEY, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID, TEXT_BODY],
    );

    // Confirma via pg_locks que B está de fato esperando (não retornou já).
    await waitFor(
      () => waitingOnAdvisoryLock(ctl, b.backendPid),
      POLL_TIMEOUT_MS,
      "B bloquear no advisory lock",
    );

    // (3) A commita — libera advisory lock — B desbloqueia e replay.
    await a.commit();

    const bResultRaw = await bResultPromise;
    const bResult = bResultRaw.rows[0]?.enqueue_whatsapp_km_prompt;
    expect(bResult?.result).toBe("replayed");
    expect(bResult?.prompt_request_id).toBe(aResult?.prompt_request_id);
    expect(bResult?.prompt_message_id).toBe(aResult?.prompt_message_id);
    expect(bResult?.outbound_queue_id).toBe(aResult?.outbound_queue_id);

    // (4) Contagens: exatamente 1 linha por tabela para esta emissão.
    const q1 = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_outbound_queue
        where idempotency_key = $1`,
      [IDEMPOTENCY_KEY],
    );
    expect(Number(q1.rows[0]?.n)).toBe(1);

    const q2 = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_messages
        where id = $1`,
      [aResult?.prompt_message_id],
    );
    expect(Number(q2.rows[0]?.n)).toBe(1);

    const q3 = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_km_prompt_requests
        where prompt_message_id = $1`,
      [aResult?.prompt_message_id],
    );
    expect(Number(q3.rows[0]?.n)).toBe(1);

    // (5) Estado do request: 'queued' (ainda não enviado).
    const qStatus = await ctl.query<{ status: string }>(
      `select status from public.whatsapp_km_prompt_requests where id = $1`,
      [aResult?.prompt_request_id],
    );
    expect(qStatus.rows[0]?.status).toBe("queued");
  });
});

// Aviso em bun test padrão: sem TEST_DATABASE_URL o cenário C1 é pulado.
// Isso é intencional — o cenário roda apenas no CI efêmero MJ1A-V-ENV-CI.
if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1A-V C1] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
