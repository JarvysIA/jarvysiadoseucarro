/**
 * MJ1B-V — Cenário O4: CAS de state_version em
 * apply_whatsapp_orchestrator_transition sob lock físico real.
 *
 * Duas sessões físicas competem para aplicar uma transição na MESMA
 * conversa já existente (mesmo contato, mesma linha de
 * whatsapp_conversation_states), cada uma com seu próprio item de fila e
 * lease válidos. A que perde a corrida trava de verdade — não é lógica
 * sequencial, é bloqueio físico real (mesmo padrão do C4/C5 do MJ1A-V).
 * CORREÇÃO (descoberta no O5): o bloqueio físico observado aqui acontece
 * no SELECT...FOR UPDATE que a própria RPC faz em whatsapp_contacts logo
 * no início — trava que ela segura pela transação inteira e que já
 * serializa qualquer apply() concorrente pro mesmo contato, antes mesmo
 * de chegar perto de whatsapp_conversation_states. O resultado do teste
 * (CAS correto, versão certa devolvida) continua 100% válido — só a
 * localização exata do lock físico estava descrita errado aqui.
 *
 * Setup: para ter duas sessões com leases válidos e simultâneos, contorno
 * deliberadamente a serialização por contato do claim() (que só libera um
 * item por vez por contato — já provado no O1) fazendo UPDATE direto para
 * simular duas reivindicações concorrentes. Isso testa a defesa da PRÓPRIA
 * apply() (o CAS), independente de como as leases foram obtidas — defesa
 * em profundidade, não só o caminho feliz orquestrado pelo claim(). O item
 * "bootstrap" que estabelece o estado inicial é semeado e resolvido ANTES
 * de A e B existirem, pra não haver ambiguidade sobre qual item o claim()
 * pegaria primeiro.
 *
 * Prova negativa: quem perde a corrida recebe 'state_version_conflict' com
 * a versão atual CORRETA, não um erro genérico — e o item de fila de quem
 * perdeu continua 'running', com o lease intacto (a função retorna ANTES
 * de qualquer UPDATE na fila nesse caminho — confirmado lendo o código).
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

const WORKER_BOOTSTRAP = "mj1bv-o4-worker-bootstrap";
const WORKER_A = "mj1bv-o4-worker-a";
const WORKER_B = "mj1bv-o4-worker-b";
const ORCH_VERSION = "mj1bv-o4-v1";

const POLL_INTERVAL_MS = 25;
const POLL_TIMEOUT_MS = 5_000;

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
 * deliberadamente a serialização por contato, pra testar o CAS da apply()
 * isoladamente. Gera o lease_token no JS (crypto.randomUUID) pra não
 * depender de nenhuma extensão específica do Postgres.
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

describeIfDb("MJ1B-V O4 — CAS de state_version sob lock físico real", () => {
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

  test("duas sessões disputam a mesma conversa -> quem perde trava de verdade e recebe a versão certa", async () => {
    // (1) Item bootstrap sozinho — estabelece o estado inicial
    // (state_version=1), sequencial, sem concorrência. Mesmo padrão do O3.
    const bootstrap = await seedOrchestratorQueueItem(
      setup,
      "MJ1B-V O4 synthetic — mensagem bootstrap",
    );

    const claimBootstrap = await setup.query<ClaimedRow>(
      `select * from public.claim_whatsapp_orchestrator_items($1, $2, $3)`,
      [WORKER_BOOTSTRAP, 1, 60],
    );
    expect(claimBootstrap.rows.length).toBe(1);
    expect(claimBootstrap.rows[0]?.queue_id).toBe(bootstrap.queueId);
    const bootstrapLease = claimBootstrap.rows[0]?.lease_token;

    const bootstrapApply = await setup.query<{
      apply_whatsapp_orchestrator_transition: ApplyResult;
    }>(
      `select public.apply_whatsapp_orchestrator_transition($1, $2, $3, $4, $5, $6)
         as apply_whatsapp_orchestrator_transition`,
      [
        bootstrap.queueId,
        bootstrapLease,
        0,
        { next_state: "idle" },
        ORCH_VERSION,
        { decisionKind: "respond", eventKind: "unknown", outcome: "none" },
      ],
    );
    const bootstrapResult = bootstrapApply.rows[0]?.apply_whatsapp_orchestrator_transition;
    expect(bootstrapResult?.ok).toBe(true);
    expect(bootstrapResult?.orchestratorResult?.stateVersion).toBe(1);

    // (2) SÓ AGORA semeia os 2 itens que vão disputar a corrida — sem
    // ambiguidade nenhuma, o bootstrap já está 'done'.
    const itemA = await seedOrchestratorQueueItem(
      setup,
      "MJ1B-V O4 synthetic — mensagem sessão A",
    );
    const itemB = await seedOrchestratorQueueItem(
      setup,
      "MJ1B-V O4 synthetic — mensagem sessão B",
    );

    const leaseA = await fakeClaim(setup, itemA.queueId, WORKER_A);
    const leaseB = await fakeClaim(setup, itemB.queueId, WORKER_B);

    const patch = { next_state: "awaiting_vehicle" };
    const resultSummary = {
      decisionKind: "respond",
      eventKind: "unknown",
      outcome: "none",
    };

    // (3) Sessão A aplica com a versão certa (1) — sucesso real, mas NÃO
    // commita ainda. Segura o lock da linha de whatsapp_contacts (ver
    // nota no cabeçalho do arquivo).
    await a.begin();
    const applyAPromise = a.query<{ apply_whatsapp_orchestrator_transition: ApplyResult }>(
      `select public.apply_whatsapp_orchestrator_transition($1, $2, $3, $4, $5, $6)
         as apply_whatsapp_orchestrator_transition`,
      [itemA.queueId, leaseA, 1, patch, ORCH_VERSION, resultSummary],
    );
    const applyAResult = (await applyAPromise).rows[0]?.apply_whatsapp_orchestrator_transition;
    expect(applyAResult?.ok).toBe(true);
    expect(applyAResult?.orchestratorResult?.stateVersion).toBe(2);

    // (4) Sessão B tenta aplicar, também com expected_state_version=1 —
    // bloqueia de verdade no FOR UPDATE que a RPC faz em whatsapp_contacts
    // logo no início (A ainda não commitou) — ver nota no cabeçalho do
    // arquivo, corrigida após o achado do O5.
    const applyBPromise = b.query<{ apply_whatsapp_orchestrator_transition: ApplyResult }>(
      `select public.apply_whatsapp_orchestrator_transition($1, $2, $3, $4, $5, $6)
         as apply_whatsapp_orchestrator_transition`,
      [itemB.queueId, leaseB, 1, patch, ORCH_VERSION, resultSummary],
    );

    await waitFor(
      () => waitingOnRowLock(ctl, b.backendPid),
      POLL_TIMEOUT_MS,
      "B bloquear no lock da linha de whatsapp_contacts (segurado por A)",
    );

    // (5) A commita — libera a trava. B perde a corrida.
    await a.commit();

    const applyBResult = (await applyBPromise).rows[0]?.apply_whatsapp_orchestrator_transition;
    expect(applyBResult?.ok).toBe(false);
    expect(applyBResult?.reason).toBe("state_version_conflict");
    expect(applyBResult?.currentStateVersion).toBe(2);

    // (6) O item de fila de B continua 'running', lease intacto — não foi
    // finalizado nem corrompido pela derrota na corrida.
    const bQueueState = await ctl.query<{
      status: string;
      lease_token: string | null;
      claimed_by: string | null;
    }>(
      `select status, lease_token, claimed_by
         from public.whatsapp_processing_queue
        where id = $1`,
      [itemB.queueId],
    );
    expect(bQueueState.rows[0]?.status).toBe("running");
    expect(bQueueState.rows[0]?.lease_token).toBe(leaseB);
    expect(bQueueState.rows[0]?.claimed_by).toBe(WORKER_B);

    // (7) Estado final da conversa: versão 2, quem venceu foi A.
    const finalState = await ctl.query<{
      state: string;
      state_version_int: number;
    }>(
      `select state, state_version::int as state_version_int
         from public.whatsapp_conversation_states
        where contact_id = $1`,
      [SYNTH_CONTACT_ID],
    );
    expect(finalState.rows.length).toBe(1);
    expect(finalState.rows[0]?.state_version_int).toBe(2);
    expect(finalState.rows[0]?.state).toBe("awaiting_vehicle");
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1B-V O4] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
