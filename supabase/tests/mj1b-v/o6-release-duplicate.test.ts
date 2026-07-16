/**
 * MJ1B-V — Cenário O6: release_whatsapp_orchestrator_item não reprocessa em
 * chamada duplicada.
 *
 * Prova dois ramos independentes de proteção contra dupla execução:
 *
 * (1) Concorrência real com o MESMO lease_token válido: duas sessões físicas
 *     chamam a RPC simultaneamente para o mesmo item. Quem chega primeiro
 *     segura o FOR UPDATE que a própria RPC faz na linha da fila; a segunda
 *     bloqueia de verdade (provado via polling em pg_stat_activity,
 *     wait_event_type='Lock'). Quando a primeira commita, a segunda destrava,
 *     relê a linha (com o lease já limpo por quem venceu) e devolve
 *     lease_lost — NÃO reprocessa. Conferido no banco: attempts +1 exato
 *     (não +2), status='queued', error_message = razão de quem venceu.
 *
 * (2) Chamada sequencial após terminal: primeira chamada com retry_kind
 *     'cancelled' leva o item pra status='cancelled' + finished_at gravado.
 *     Segunda chamada, MESMO lease_token (agora inválido, já limpo pela
 *     primeira), cai no ramo 'already_terminal' — checado ANTES do lease,
 *     então esse é o reason retornado, não 'lease_lost'. Linha da fila
 *     não muda entre as duas chamadas (status, finished_at idênticos).
 *
 * Setup: fakeClaim (UPDATE direto contornando claim()) — mesmo padrão do O4
 * — gera lease válido sem depender do claim() real, mantendo o teste focado
 * na defesa da própria release().
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
  cleanupBaseFixtures,
  countSyntheticResidue,
  seedBaseFixtures,
  seedOrchestratorQueueItem,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";

const describeIfDb = HAS_DB ? describe : describe.skip;

const WORKER_A = "mj1bv-o6-worker-a";
const WORKER_B = "mj1bv-o6-worker-b";
const WORKER_SEQ = "mj1bv-o6-worker-seq";

const POLL_INTERVAL_MS = 25;
const POLL_TIMEOUT_MS = 5_000;

type ReleaseResult = {
  ok: boolean;
  reason?: string;
  status?: string;
  attempts?: number;
  willRetry?: boolean;
  wasReplay?: boolean;
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

async function waitingOnRowLock(ctl: Session, pid: number): Promise<boolean> {
  const r = await ctl.query<{ n: string }>(
    `select count(*)::text as n
       from pg_stat_activity
      where pid = $1
        and wait_event_type = 'Lock'`,
    [pid],
  );
  return Number(r.rows[0]?.n ?? "0") > 0;
}

/**
 * Simula uma reivindicação de fila SEM passar pelo claim() — contornando
 * deliberadamente a serialização por contato, pra testar a release()
 * isoladamente. Mesmo padrão do O4.
 */
async function fakeClaim(
  session: Session,
  queueId: string,
  workerId: string,
): Promise<string> {
  const leaseToken = crypto.randomUUID();
  await session.query(
    `update public.whatsapp_processing_queue
        set status = 'running',
            claimed_at = now(),
            lease_token = $2,
            lease_expires_at = now() + interval '2 minutes',
            claimed_by = $3
      where id = $1`,
    [queueId, leaseToken, workerId],
  );
  return leaseToken;
}

describeIfDb("MJ1B-V O6 — release não reprocessa em chamada duplicada", () => {
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

  test("duas releases simultâneas MESMO lease → vencedora reagenda +1, perdedora recebe lease_lost e NÃO reprocessa", async () => {
    const item = await seedOrchestratorQueueItem(
      setup,
      "MJ1B-V O6 synthetic — item concorrente",
    );

    // max_attempts default = 5; forçamos folga para transient cair no ramo 'queued' (não 'failed').
    await setup.query(
      `update public.whatsapp_processing_queue
          set attempts = 0, max_attempts = 5
        where id = $1`,
      [item.queueId],
    );

    const leaseToken = await fakeClaim(setup, item.queueId, WORKER_A);

    const reasonA = "mj1bv-o6-winner";
    const reasonB = "mj1bv-o6-loser";

    // (A) Abre transação, dispara release, segura o FOR UPDATE da linha.
    await a.begin();
    const applyAResult = (await a.query<{ release_whatsapp_orchestrator_item: ReleaseResult }>(
      `select public.release_whatsapp_orchestrator_item($1, $2, $3, $4, $5)
         as release_whatsapp_orchestrator_item`,
      [item.queueId, leaseToken, reasonA, "transient_error", 60],
    )).rows[0]?.release_whatsapp_orchestrator_item;
    expect(applyAResult?.ok).toBe(true);
    expect(applyAResult?.status).toBe("queued");
    expect(applyAResult?.attempts).toBe(1);
    expect(applyAResult?.willRetry).toBe(true);

    // (B) Dispara release com MESMO lease — bloqueia no FOR UPDATE.
    const applyBPromise = b.query<{ release_whatsapp_orchestrator_item: ReleaseResult }>(
      `select public.release_whatsapp_orchestrator_item($1, $2, $3, $4, $5)
         as release_whatsapp_orchestrator_item`,
      [item.queueId, leaseToken, reasonB, "transient_error", 60],
    );

    await waitFor(
      () => waitingOnRowLock(ctl, b.backendPid),
      POLL_TIMEOUT_MS,
      "B bloquear no FOR UPDATE da linha da fila (segurado por A)",
    );

    // (C) A commita — libera. B relê a linha (lease já NULL) → lease_lost.
    await a.commit();

    const applyBResult = (await applyBPromise).rows[0]?.release_whatsapp_orchestrator_item;
    expect(applyBResult?.ok).toBe(false);
    expect(applyBResult?.reason).toBe("lease_lost");

    // (D) Estado final: attempts=1 EXATO (não 2), status='queued',
    // error_message = reason de A (não sobrescrito por B), lease NULL.
    const row = await ctl.query<{
      status: string;
      attempts_int: number;
      error_message: string | null;
      lease_token: string | null;
    }>(
      `select status,
              attempts::int as attempts_int,
              error_message,
              lease_token
         from public.whatsapp_processing_queue
        where id = $1`,
      [item.queueId],
    );
    expect(row.rows[0]?.status).toBe("queued");
    expect(row.rows[0]?.attempts_int).toBe(1);
    expect(row.rows[0]?.error_message).toBe(reasonA);
    expect(row.rows[0]?.lease_token).toBeNull();
  });

  test("release cancelled → segunda chamada com lease antigo cai em already_terminal (checado antes do lease), sem alterar a linha", async () => {
    const item = await seedOrchestratorQueueItem(
      setup,
      "MJ1B-V O6 synthetic — item sequencial",
    );

    const leaseToken = await fakeClaim(setup, item.queueId, WORKER_SEQ);

    const reasonCancel = "mj1bv-o6-cancel";
    const reasonRetry = "mj1bv-o6-retry";

    // Primeira chamada: cancelled → terminal.
    const first = (await setup.query<{ release_whatsapp_orchestrator_item: ReleaseResult }>(
      `select public.release_whatsapp_orchestrator_item($1, $2, $3, $4, $5)
         as release_whatsapp_orchestrator_item`,
      [item.queueId, leaseToken, reasonCancel, "cancelled", 5],
    )).rows[0]?.release_whatsapp_orchestrator_item;
    expect(first?.ok).toBe(true);
    expect(first?.status).toBe("cancelled");
    expect(first?.willRetry).toBe(false);

    // Snapshot pós-primeira chamada.
    const snap1 = await ctl.query<{
      status: string;
      finished_at: string | null;
      error_message: string | null;
      lease_token: string | null;
    }>(
      `select status, finished_at::text as finished_at, error_message, lease_token
         from public.whatsapp_processing_queue
        where id = $1`,
      [item.queueId],
    );
    expect(snap1.rows[0]?.status).toBe("cancelled");
    expect(snap1.rows[0]?.finished_at).not.toBeNull();
    expect(snap1.rows[0]?.lease_token).toBeNull();

    // Segunda chamada, MESMO lease (agora inválido) — RPC checa terminal
    // ANTES do lease, então reason = already_terminal.
    const second = (await setup.query<{ release_whatsapp_orchestrator_item: ReleaseResult }>(
      `select public.release_whatsapp_orchestrator_item($1, $2, $3, $4, $5)
         as release_whatsapp_orchestrator_item`,
      [item.queueId, leaseToken, reasonRetry, "transient_error", 60],
    )).rows[0]?.release_whatsapp_orchestrator_item;
    expect(second?.ok).toBe(false);
    expect(second?.reason).toBe("already_terminal");

    // Linha inalterada entre as duas chamadas.
    const snap2 = await ctl.query<{
      status: string;
      finished_at: string | null;
      error_message: string | null;
      lease_token: string | null;
    }>(
      `select status, finished_at::text as finished_at, error_message, lease_token
         from public.whatsapp_processing_queue
        where id = $1`,
      [item.queueId],
    );
    expect(snap2.rows[0]?.status).toBe(snap1.rows[0]?.status);
    expect(snap2.rows[0]?.finished_at).toBe(snap1.rows[0]?.finished_at);
    expect(snap2.rows[0]?.error_message).toBe(snap1.rows[0]?.error_message);
    expect(snap2.rows[0]?.lease_token).toBe(snap1.rows[0]?.lease_token);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1B-V O6] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
