/**
 * MJ1B-V — Cenário O5: corrida na PRIMEIRA inserção de
 * whatsapp_conversation_states (contato ainda sem estado nenhum).
 *
 * Diferente do O4 (linha de estado já existia, FOR UPDATE trava de
 * verdade e resolve limpo): aqui a linha AINDA NÃO EXISTE pra nenhuma das
 * duas sessões. O SELECT...FOR UPDATE não trava nada (não há o que
 * travar) — as duas sessões passam achando que são as primeiras. A trava
 * real só acontece no INSERT, via o índice único wcs_contact_unique
 * (contact_id) — mecânica padrão do Postgres: a segunda transação a
 * tentar inserir a mesma chave BLOQUEIA esperando a primeira resolver
 * (commit ou rollback), só descobre o resultado depois disso.
 *
 * Achado de auditoria que motivou este teste: o INSERT de estado novo
 * dentro de apply_whatsapp_orchestrator_transition NÃO tem bloco de
 * EXCEPTION pra unique_violation — diferente do INSERT de outbound na
 * mesma função, que tem. Hipótese: a sessão que perde a corrida recebe um
 * erro cru do Postgres (code=23505) em vez de uma resposta estruturada.
 *
 * ESTE TESTE É UMA INVESTIGAÇÃO, NÃO UMA ASSERÇÃO CEGA — não presume qual
 * dos dois caminhos (exceção crua vs. resposta estruturada) vai
 * acontecer. Captura os dois, relata qual ocorreu, e falha de verdade
 * SÓ se o sistema ficar em estado corrompido (duas linhas de estado pro
 * mesmo contato, ou o item de fila de quem perde ficando num estado
 * inconsistente/zumbi) — essa é a garantia que importa de verdade,
 * independente de qual caminho o Postgres seguir.
 *
 * Setup: 2 itens de fila pro MESMO contato, SEM item "bootstrap" (essa é
 * justamente a ausência que cria o cenário) — via fakeClaim (UPDATE
 * direto), mesma técnica do O4, contornando a serialização por contato
 * do claim() de propósito.
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

const WORKER_A = "mj1bv-o5-worker-a";
const WORKER_B = "mj1bv-o5-worker-b";
const ORCH_VERSION = "mj1bv-o5-v1";

const POLL_INTERVAL_MS = 25;
const POLL_TIMEOUT_MS = 5_000;

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
 * Simula uma reivindicação de fila SEM passar pelo claim() — mesma
 * técnica do O4, documentada lá.
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

describeIfDb("MJ1B-V O5 — corrida na primeira inserção de conversation_state", () => {
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

  test("dois apply() concorrentes pro mesmo contato SEM estado ainda -> nunca corrompe, documenta o caminho real", async () => {
    // (1) 2 itens de fila pro mesmo contato — SEM bootstrap. O contato
    // não tem NENHUMA linha em whatsapp_conversation_states ainda.
    const itemA = await seedOrchestratorQueueItem(
      setup,
      "MJ1B-V O5 synthetic — mensagem sessão A",
    );
    const itemB = await seedOrchestratorQueueItem(
      setup,
      "MJ1B-V O5 synthetic — mensagem sessão B",
    );

    const leaseA = await fakeClaim(setup, itemA.queueId, WORKER_A);
    const leaseB = await fakeClaim(setup, itemB.queueId, WORKER_B);

    const patch = { next_state: "awaiting_vehicle" };
    const resultSummary = {
      decisionKind: "respond",
      eventKind: "unknown",
      outcome: "none",
    };

    // (2) Confirma o ponto de partida: zero linhas de estado.
    const before = await ctl.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_conversation_states
        where contact_id = $1`,
      [SYNTH_CONTACT_ID],
    );
    expect(Number(before.rows[0]?.n)).toBe(0);

    // (3) Sessão A aplica com expected_state_version=0 — sucesso real
    // (INSERT novo), mas NÃO commita ainda.
    await a.begin();
    const applyAPromise = a.query<{ apply_whatsapp_orchestrator_transition: ApplyResult }>(
      `select public.apply_whatsapp_orchestrator_transition($1, $2, $3, $4, $5, $6)
         as apply_whatsapp_orchestrator_transition`,
      [itemA.queueId, leaseA, 0, patch, ORCH_VERSION, resultSummary],
    );
    const applyAResult = (await applyAPromise).rows[0]?.apply_whatsapp_orchestrator_transition;
    expect(applyAResult?.ok).toBe(true);
    expect(applyAResult?.orchestratorResult?.stateVersion).toBe(1);

    // (4) Sessão B tenta aplicar, também expected_state_version=0. O
    // SELECT...FOR UPDATE dela não vê a linha de A (ainda não commitada)
    // e não trava — B só vai travar de verdade quando tentar o PRÓPRIO
    // INSERT, no índice único, esperando A resolver.
    const applyBPromise = b.query<{ apply_whatsapp_orchestrator_transition: ApplyResult }>(
      `select public.apply_whatsapp_orchestrator_transition($1, $2, $3, $4, $5, $6)
         as apply_whatsapp_orchestrator_transition`,
      [itemB.queueId, leaseB, 0, patch, ORCH_VERSION, resultSummary],
    );

    await waitFor(
      () => waitingOnRowLock(ctl, b.backendPid),
      POLL_TIMEOUT_MS,
      "B bloquear no índice único de whatsapp_conversation_states",
    );

    // (5) A commita — a linha de A vira real e visível. B desbloqueia
    // AGORA, e é aqui que descobrimos o caminho real.
    await a.commit();

    let bError: unknown = null;
    let bResult: ApplyResult | undefined;
    try {
      const bRaw = await applyBPromise;
      bResult = bRaw.rows[0]?.apply_whatsapp_orchestrator_transition;
    } catch (err) {
      bError = err;
    }

    if (bError !== null) {
      // CAMINHO CONFIRMADO: erro cru do Postgres, não resposta
      // estruturada. Valida que é EXATAMENTE o unique_violation esperado
      // (code=23505), não qualquer erro genérico.
      const msg = String(bError);
      // eslint-disable-next-line no-console
      console.log(
        "[MJ1B-V O5] ACHADO CONFIRMADO: apply() concorrente na primeira " +
          "inserção de estado propaga erro cru (sem tratamento de " +
          "unique_violation). Mensagem sanitizada:",
        msg,
      );
      expect(msg).toContain("code=23505");
    } else {
      // CAMINHO ALTERNATIVO: algo trata isso de forma estruturada, ao
      // contrário do que a leitura do código sugeria. Documenta o que
      // veio, sem presumir qual "reason" seria.
      // eslint-disable-next-line no-console
      console.log(
        "[MJ1B-V O5] Hipótese de bug NÃO confirmada — resposta estruturada:",
        JSON.stringify(bResult),
      );
      expect(bResult?.ok).toBe(false);
    }

    // (6) GARANTIA QUE IMPORTA DE VERDADE, independente do caminho acima:
    // zero corrupção. Exatamente 1 linha de estado pro contato, dona é A.
    const afterState = await ctl.query<{
      n: string;
    }>(
      `select count(*)::text as n
         from public.whatsapp_conversation_states
        where contact_id = $1`,
      [SYNTH_CONTACT_ID],
    );
    expect(Number(afterState.rows[0]?.n)).toBe(1);

    const stateDetail = await ctl.query<{ state_version_int: number }>(
      `select state_version::int as state_version_int
         from public.whatsapp_conversation_states
        where contact_id = $1`,
      [SYNTH_CONTACT_ID],
    );
    expect(stateDetail.rows[0]?.state_version_int).toBe(1);

    // (7) O item de fila de B (quem perdeu) não pode ter ficado num
    // estado zumbi — continua 'running', lease intacto, pronto pra um
    // novo apply() com a versão certa (1) ou um release().
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

    // (8) O item de fila de A (quem venceu) foi finalizado normalmente.
    const aQueueState = await ctl.query<{ status: string }>(
      `select status from public.whatsapp_processing_queue where id = $1`,
      [itemA.queueId],
    );
    expect(aQueueState.rows[0]?.status).toBe("done");
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1B-V O5] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
