/**
 * MJ1A-V — Cenário C3: mesma idempotency_key, contexto divergente.
 *
 * Cenário realista: o mesmo usuário tem MAIS DE UM veículo na garagem
 * (é o produto — "Garagem Virtual Inteligente"). Se por qualquer bug de
 * geração de chave (ex.: idempotency_key computada só por usuário+data,
 * sem incluir o veículo) a mesma key for reusada para dois carros
 * diferentes, a RPC precisa REJEITAR com 'idempotency_context_mismatch',
 * nunca silenciosamente linkar o prompt do carro B como se fosse replay
 * do carro A.
 *
 * Cobertura secundária (sem custo de fixture extra): mesma key, mesmo
 * veículo, texto divergente — também deve ser rejeitado.
 *
 * Não é um teste de concorrência física (não há lock físico disputado
 * neste código-caminho) — é lógica de validação, sequencial, sessão única.
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
  SYNTH_VEHICLE_ID_B,
  cleanupBaseFixtures,
  cleanupSecondVehicle,
  countSyntheticResidue,
  seedBaseFixtures,
  seedSecondVehicle,
} from "./fixtures";

const HAS_DB = typeof process.env.TEST_DATABASE_URL === "string"
  && process.env.TEST_DATABASE_URL.trim() !== "";

const describeIfDb = HAS_DB ? describe : describe.skip;

const IDEMPOTENCY_KEY = "mj1av-c3-key";
const TEXT_BODY_ORIGINAL = "MJ1A-V C3 synthetic — qual a quilometragem atual?";
const TEXT_BODY_DIVERGENTE = "MJ1A-V C3 synthetic — texto diferente do original";

type EnqueueResult = {
  result: string;
  prompt_request_id?: string;
  prompt_message_id?: string;
  outbound_queue_id?: string;
};

describeIfDb("MJ1A-V C3 — enqueue_whatsapp_km_prompt com contexto divergente", () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession("setup");

    await session.begin();
    await cleanupSecondVehicle(session);
    await cleanupBaseFixtures(session);
    await session.commit();

    await session.begin();
    await seedBaseFixtures(session);
    await seedSecondVehicle(session);
    await session.commit();
  });

  afterAll(async () => {
    try {
      await session.begin();
      await cleanupSecondVehicle(session);
      await cleanupBaseFixtures(session);
      await session.commit();

      const residue = await countSyntheticResidue(session);
      if (residue !== 0) {
        throw new Error(`resíduo sintético != 0 após cleanup: ${residue}`);
      }

      const vehicleBResidue = await session.query<{ n: string }>(
        `select count(*)::text as n from public.veiculos where id = $1`,
        [SYNTH_VEHICLE_ID_B],
      );
      if (Number(vehicleBResidue.rows[0]?.n ?? "0") !== 0) {
        throw new Error("resíduo do segundo veículo sintético != 0 após cleanup");
      }
    } finally {
      await session?.close();
    }
  });

  test("emissão original cria; mesma key + veículo diferente é rejeitada", async () => {
    // (1) Emissão original — veículo A (o mesmo usado por C1/C2).
    const original = await session.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
      `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
         as enqueue_whatsapp_km_prompt`,
      [IDEMPOTENCY_KEY, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID, TEXT_BODY_ORIGINAL],
    );

    const originalResult = original.rows[0]?.enqueue_whatsapp_km_prompt;
    expect(originalResult?.result).toBe("created");
    expect(originalResult?.prompt_request_id).toBeTruthy();

    // (2) MESMA key, MESMO contato, mas veículo B (carro diferente na
    // garagem do mesmo usuário) — deve ser rejeitada, nunca "replayed".
    const vehicleMismatch = await session.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
      `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
         as enqueue_whatsapp_km_prompt`,
      [IDEMPOTENCY_KEY, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID_B, TEXT_BODY_ORIGINAL],
    );

    const vehicleMismatchResult = vehicleMismatch.rows[0]?.enqueue_whatsapp_km_prompt;
    expect(vehicleMismatchResult?.result).toBe("idempotency_context_mismatch");

    // (3) MESMA key, MESMO contato, MESMO veículo A, mas texto diferente
    // — também deve ser rejeitada.
    const textMismatch = await session.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
      `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
         as enqueue_whatsapp_km_prompt`,
      [IDEMPOTENCY_KEY, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID, TEXT_BODY_DIVERGENTE],
    );

    const textMismatchResult = textMismatch.rows[0]?.enqueue_whatsapp_km_prompt;
    expect(textMismatchResult?.result).toBe("idempotency_context_mismatch");

    // (4) Repetir com os argumentos EXATOS da emissão original — deve dar
    // replay de verdade, provando que a rejeição acima não é um falso
    // positivo genérico.
    const legitReplay = await session.query<{ enqueue_whatsapp_km_prompt: EnqueueResult }>(
      `select public.enqueue_whatsapp_km_prompt($1, $2, $3, $4)
         as enqueue_whatsapp_km_prompt`,
      [IDEMPOTENCY_KEY, SYNTH_CONTACT_ID, SYNTH_VEHICLE_ID, TEXT_BODY_ORIGINAL],
    );

    const legitReplayResult = legitReplay.rows[0]?.enqueue_whatsapp_km_prompt;
    expect(legitReplayResult?.result).toBe("replayed");
    expect(legitReplayResult?.prompt_request_id).toBe(originalResult?.prompt_request_id);
    expect(legitReplayResult?.prompt_message_id).toBe(originalResult?.prompt_message_id);
    expect(legitReplayResult?.outbound_queue_id).toBe(originalResult?.outbound_queue_id);

    // (5) Contagens finais: exatamente 1 linha por tabela para esta key —
    // as tentativas rejeitadas não inseriram nada.
    const q1 = await session.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_outbound_queue
        where idempotency_key = $1`,
      [IDEMPOTENCY_KEY],
    );
    expect(Number(q1.rows[0]?.n)).toBe(1);

    const q2 = await session.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_messages
        where id = $1`,
      [originalResult?.prompt_message_id],
    );
    expect(Number(q2.rows[0]?.n)).toBe(1);

    const q3 = await session.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_km_prompt_requests
        where prompt_message_id = $1`,
      [originalResult?.prompt_message_id],
    );
    expect(Number(q3.rows[0]?.n)).toBe(1);

    // (6) O veículo B nunca deve ter ganhado nenhum request vinculado.
    const qVehicleB = await session.query<{ n: string }>(
      `select count(*)::text as n
         from public.whatsapp_km_prompt_requests
        where vehicle_id = $1`,
      [SYNTH_VEHICLE_ID_B],
    );
    expect(Number(qVehicleB.rows[0]?.n)).toBe(0);
  });
});

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log("[MJ1A-V C3] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
