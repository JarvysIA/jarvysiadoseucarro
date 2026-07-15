/**
 * MJ1B-V — Cenário O2: recuperação de lease expirado em
 * claim_whatsapp_orchestrator_items, e invalidação do lease_token antigo.
 *
 * Não é um teste de concorrência física (não há duas sessões disputando
 * lock) — é validação sequencial de um caminho de recuperação: um worker
 * reivindica um item e "some" (crash, timeout) antes de terminar. O
 * lease_expires_at fica no passado. Uma nova chamada de claim() precisa
 * recuperar esse item sozinha (was_recovered=true), com um lease_token
 * NOVO — e o token antigo não pode mais ser usado em nenhuma RPC.
 *
 * De quebra, valida uma fatia de release_whatsapp_orchestrator_item:
 * o token antigo falha com 'lease_lost', o token novo funciona
 * normalmente.
 *
 * Setup: depois do claim() inicial, este teste faz um UPDATE direto em
 * whatsapp_processing_queue.lease_expires_at para o passado — simula o
 * worker que sumiu. Não é RPC nem migration, mesma lógica já usada no
 * MJ1A-V (C4/C5); esperar 30s de verdade seria inviável no CI.
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

const WORKER_A = "mj1bv-o2-worker-a";
const WORKER_B = "mj1bv-o2-worker-b";

type ClaimedRow = {
  queue_id: string;
  message_id: string;
  contact_id: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  was_recovered: boolean;
  orchestrator_mode: string;
};

type ReleaseResult = {
  ok: boolean;
  reason?: string;
  status?: string;
  attempts?: number;
  willRetry?: boolean;
  wasReplay?: boolean;
};

describeIfDb("MJ1B-V O2 — recuperação de lease expirado", () => {
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

  test("lease expirado é recuperado por outro worker; token antigo morre de verdade", async () => {
    // (1) Item elegível único.
    const { queueId } = await seedOrchestratorQueueItem(
      session,
      "MJ1B-V O2 synthetic — mensagem de teste",
    );

    // (2) Worker A reivindica normalmente.
    const first = await session.query<ClaimedRow>(
      `select * from public.claim_whatsapp_orchestrator_items($1, $2, $3)`,
      [WORKER_A, 1, 30],
    );
    expect(first.rows.length).toBe(1);
    const tokenV1 = first.rows[0]?.lease_token;
    expect(tokenV1).toBeTruthy();
    expect(first.rows[0]?.was_recovered).toBe(false);

    // (3) Simula o worker A sumindo: força claimed_at e lease_expires_at
    // pro passado, nessa ordem — a constraint wpq_lease_expires_after_claim
    // exige lease_expires_at > claimed_at mesmo quando ambos já expiraram.
    await session.query(
      `update public.whatsapp_processing_queue
          set claimed_at = now() - interval '2 minutes',
              lease_expires_at = now() - interval '1 minute'
        where id = $1`,
      [queueId],
    );

    // (4) Worker B reivindica o MESMO item — recuperação de lease.
    const second = await session.query<ClaimedRow>(
      `select * from public.claim_whatsapp_orchestrator_items($1, $2, $3)`,
      [WORKER_B, 1, 30],
    );
    expect(second.rows.length).toBe(1);
    const recovered = second.rows[0];
    expect(recovered.queue_id).toBe(queueId);
    expect(recovered.was_recovered).toBe(true);
    const tokenV2 = recovered.lease_token;
    expect(tokenV2).toBeTruthy();
    expect(tokenV2).not.toBe(tokenV1);

    // (5) Confirma dono trocou de verdade no banco.
    const owner = await session.query<{ claimed_by: string | null }>(
      `select claimed_by from public.whatsapp_processing_queue where id = $1`,
      [queueId],
    );
    expect(owner.rows[0]?.claimed_by).toBe(WORKER_B);

    // (6) Token ANTIGO não serve mais pra nada — release com tokenV1 falha
    // limpo com 'lease_lost', não com erro cru.
    const staleRelease = await session.query<{ release_whatsapp_orchestrator_item: ReleaseResult }>(
      `select public.release_whatsapp_orchestrator_item($1, $2, $3, $4, $5)
         as release_whatsapp_orchestrator_item`,
      [queueId, tokenV1, "o2-stale-token-attempt", "state_conflict", 5],
    );
    const staleResult = staleRelease.rows[0]?.release_whatsapp_orchestrator_item;
    expect(staleResult?.ok).toBe(false);
    expect(staleResult?.reason).toBe("lease_lost");

    // (7) Token NOVO funciona normalmente.
    const freshRelease = await session.query<{ release_whatsapp_orchestrator_item: ReleaseResult }>(
      `select public.release_whatsapp_orchestrator_item($1, $2, $3, $4, $5)
         as release_whatsapp_orchestrator_item`,
      [queueId, tokenV2, "o2-fresh-token-attempt", "state_conflict", 5],
    );
    const freshResult = freshRelease.rows[0]?.release_whatsapp_orchestrator_item;
    expect(freshResult?.ok).toBe(true);
    expect(freshResult?.status).toBe("queued");
    expect(freshResult?.willRetry).toBe(true);

    // (8) Estado final: fila 'queued' de novo, lease limpo, sem
    // incrementar tentativa (state_conflict não conta como tentativa).
    const final = await session.query<{
      status: string;
      lease_token: string | null;
      lease_expires_at: string | null;
      claimed_at: string | null;
      claimed_by: string | null;
      attempts: number;
    }>(
      `select status, lease_token, lease_expires_at, claimed_at, claimed_by, attempts
         from public.whatsapp_processing_queue
        where id = $1`,
      [queueId],
    );
    expect(final.rows[0]?.status).toBe("queued");
    expect(final.rows[0]?.lease_token).toBeNull();
    expect(final.rows[0]?.lease_expires_at).toBeNull();
    expect(final.rows[0]?.claimed_at).toBeNull();
    expect(final.rows[0]?.claimed_by).toBeNull();
    expect(final.rows[0]?.attempts).toBe(0);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1B-V O2] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
