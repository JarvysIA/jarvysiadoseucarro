/**
 * MJ1B-V — Cenário O1: claim_whatsapp_orchestrator_items usa
 * FOR UPDATE SKIP LOCKED na linha do contato — não bloqueia, não duplica.
 *
 * Diferente do C1-C6 (MJ1A-V): aqui não existe espera. SKIP LOCKED por
 * definição nunca bloqueia — o objetivo do teste é justamente provar a
 * AUSÊNCIA de bloqueio: uma sessão que já segura a linha do contato faz a
 * segunda chamada de claim() voltar vazia (não travar, não dar erro, não
 * roubar o item de ninguém), e o item continua disponível assim que a
 * trava sai.
 *
 * Sincronização determinística: sessão A adquire manualmente o mesmo tipo
 * de lock que o claim() adquire internamente (SELECT ... FOR UPDATE na
 * linha de whatsapp_contacts) e mantém a transação aberta. Sessão B chama
 * a RPC de verdade.
 *
 * Ambiente: SÓ roda em Postgres local (guard preflight). Skipa em bun test
 * padrão quando TEST_DATABASE_URL não está setado.
 *
 * Não modifica RPCs, migrations, Edge Functions ou src/. A linha de
 * whatsapp_provider_instances usada é sintética (orchestrator_mode='test'
 * só neste banco efêmero) — não afeta a instância real de produção, que
 * permanece 'off'. Não conecta caller produtivo.
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

const WORKER_B = "mj1bv-o1-worker-b";

type ClaimedRow = {
  queue_id: string;
  message_id: string;
  contact_id: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  was_recovered: boolean;
  orchestrator_mode: string;
};

describeIfDb("MJ1B-V O1 — claim_whatsapp_orchestrator_items com SKIP LOCKED", () => {
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

  test("contato travado por outra sessão -> claim() não bloqueia, devolve vazio, item segue disponível depois", async () => {
    // (0) Item elegível único: 1 mensagem inbound de texto + 1 item de
    // fila 'queued'/'orchestrator' pronto pra reivindicar.
    const { messageId, queueId } = await seedOrchestratorQueueItem(
      setup,
      "MJ1B-V O1 synthetic — mensagem de teste",
    );

    // (1) A segura a MESMA trava que o claim() usaria internamente na
    // linha do contato — simula "outro claim() já está no meio do SKIP
    // LOCKED nesse contato".
    await a.begin();
    await a.query(
      `select 1 from public.whatsapp_contacts where id = $1 for update`,
      [SYNTH_CONTACT_ID],
    );

    // (2) B chama a RPC de verdade enquanto A segura a trava.
    const bFirst = await b.query<ClaimedRow>(
      `select * from public.claim_whatsapp_orchestrator_items($1, $2, $3)`,
      [WORKER_B, 1, 60],
    );
    // Não bloqueou (chegamos até aqui) e não reivindicou nada — o único
    // candidato elegível pertence ao contato travado.
    expect(bFirst.rows.length).toBe(0);

    // (3) A libera a trava.
    await a.commit();

    // (4) B chama de novo — agora reivindica o item normalmente.
    const bSecond = await b.query<ClaimedRow>(
      `select * from public.claim_whatsapp_orchestrator_items($1, $2, $3)`,
      [WORKER_B, 1, 60],
    );
    expect(bSecond.rows.length).toBe(1);
    const claimed = bSecond.rows[0];
    expect(claimed.queue_id).toBe(queueId);
    expect(claimed.message_id).toBe(messageId);
    expect(claimed.contact_id).toBe(SYNTH_CONTACT_ID);
    expect(claimed.lease_token).toBeTruthy();
    expect(claimed.lease_expires_at).toBeTruthy();
    expect(claimed.was_recovered).toBe(false);
    expect(claimed.orchestrator_mode).toBe("test");

    // (5) Estado final no banco: 'running', dono correto, sem duplicar
    // (busca por PK — 1 linha é garantido a menos que algo tenha
    // duplicado o item, o que a query já expõe).
    const qState = await ctl.query<{
      status: string;
      claimed_by: string | null;
      lease_token: string | null;
    }>(
      `select status, claimed_by, lease_token
         from public.whatsapp_processing_queue
        where id = $1`,
      [queueId],
    );
    expect(qState.rows.length).toBe(1);
    expect(qState.rows[0]?.status).toBe("running");
    expect(qState.rows[0]?.claimed_by).toBe(WORKER_B);
    expect(qState.rows[0]?.lease_token).toBe(claimed.lease_token);

    // (6) Uma terceira chamada não acha mais nada — o único item elegível
    // já foi consumido.
    const bThird = await b.query<ClaimedRow>(
      `select * from public.claim_whatsapp_orchestrator_items($1, $2, $3)`,
      [WORKER_B, 1, 60],
    );
    expect(bThird.rows.length).toBe(0);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1B-V O1] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
