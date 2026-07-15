/**
 * MJ1B-V — Fixtures sintéticas para os testes de concorrência das RPCs do
 * orquestrador (claim_whatsapp_orchestrator_items,
 * release_whatsapp_orchestrator_item, apply_whatsapp_orchestrator_transition).
 *
 * Independente do conjunto de fixtures do MJ1A-V (supabase/tests/mj1a-v/) —
 * IDs sintéticos próprios (prefixo bbbbbbbb-...), sem overlap, para os dois
 * conjuntos de testes poderem rodar lado a lado no mesmo job sem qualquer
 * acoplamento.
 *
 * Mesmas regras do MJ1A-V:
 *   - NÃO abre transação própria. O chamador passa uma Session já dentro
 *     de BEGIN e cuida do COMMIT/ROLLBACK.
 *   - Roda somente em Postgres local do CI (superusuário postgres).
 *   - Nunca importado por src/ nem por Edge Functions.
 *
 * A linha de whatsapp_provider_instances criada aqui é SINTÉTICA e só
 * existe no banco efêmero do CI — não é a instância real de produção, que
 * permanece orchestrator_mode='off' (documentado no roadmap). Setar
 * orchestrator_mode='test' nesta linha sintética é exigido como
 * pré-condição pelas 3 RPCs do orquestrador — mesmo princípio de já
 * inserir em auth.users no MJ1A-V: seguro porque o banco é descartável.
 *
 * Colunas NOT NULL sem default preenchidas:
 *   - auth.users: id, email.
 *   - profiles: id, nome, whatsapp.
 *   - whatsapp_provider_instances: provider, instance_id
 *     (+ orchestrator_mode explícito, default seria 'off').
 *   - whatsapp_contacts: user_id, phone_e164 (+ verified_at exigido pelas
 *     RPCs, embora nullable no schema).
 *
 * NÃO semeia whatsapp_messages nem whatsapp_processing_queue — cada
 * cenário (O1, O2...) monta a própria mensagem/item de fila com o
 * texto/estado que precisar, via seedOrchestratorQueueItem.
 */

import type { Client } from "pg";

type QueryClient = Pick<Client, "query">;

export const SYNTH_PROVIDER = "zapi" as const;
export const SYNTH_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
export const SYNTH_CONTACT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
export const SYNTH_INSTANCE_ID = "mj1bv-synthetic-instance";
export const SYNTH_INSTANCE_PHONE = "+551190001000";
export const SYNTH_CONTACT_PHONE = "+5511900001002";
export const SYNTH_EMAIL = "mj1bv+base@example.invalid";

/**
 * Semeia a cadeia base: usuário sintético, contato verificado, instância
 * de provider sintética (orchestrator_mode='test').
 */
export async function seedBaseFixtures(client: QueryClient): Promise<void> {
  await client.query("SET LOCAL search_path = public");

  await client.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_USER_ID, SYNTH_EMAIL],
  );

  await client.query(
    `INSERT INTO public.profiles (id, nome, whatsapp)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_USER_ID, "MJ1B-V Synth", SYNTH_CONTACT_PHONE],
  );

  await client.query(
    `INSERT INTO public.whatsapp_provider_instances
       (provider, instance_id, status, phone_number_e164, health_status, orchestrator_mode)
     VALUES ($1, $2, 'active', $3, 'ok', 'test')
     ON CONFLICT (provider, instance_id) DO NOTHING`,
    [SYNTH_PROVIDER, SYNTH_INSTANCE_ID, SYNTH_INSTANCE_PHONE],
  );

  await client.query(
    `INSERT INTO public.whatsapp_contacts
       (id, user_id, phone_e164, opt_in, opt_out, verified_at, unlinked_at)
     VALUES ($1, $2, $3, true, false, now(), NULL)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_CONTACT_ID, SYNTH_USER_ID, SYNTH_CONTACT_PHONE],
  );
}

/**
 * Remove todos os resíduos sintéticos (fixtures + linhas geradas pelas
 * RPCs: mensagens, itens de fila, estado de conversa, outbound).
 * Ordem reversa das FKs. Deve deixar zero resíduo.
 */
export async function cleanupBaseFixtures(client: QueryClient): Promise<void> {
  await client.query("SET LOCAL search_path = public");

  await client.query(
    `DELETE FROM public.whatsapp_processing_queue
      WHERE message_id IN (
        SELECT id FROM public.whatsapp_messages WHERE user_id = $1
      )`,
    [SYNTH_USER_ID],
  );
  await client.query(
    `DELETE FROM public.whatsapp_conversation_states WHERE user_id = $1`,
    [SYNTH_USER_ID],
  );
  await client.query(
    `DELETE FROM public.whatsapp_outbound_queue WHERE user_id = $1`,
    [SYNTH_USER_ID],
  );
  await client.query(`DELETE FROM public.whatsapp_messages WHERE user_id = $1`, [
    SYNTH_USER_ID,
  ]);
  await client.query(`DELETE FROM public.whatsapp_contacts WHERE id = $1`, [
    SYNTH_CONTACT_ID,
  ]);
  await client.query(
    `DELETE FROM public.whatsapp_provider_instances
     WHERE provider = $1 AND instance_id = $2`,
    [SYNTH_PROVIDER, SYNTH_INSTANCE_ID],
  );
  await client.query(`DELETE FROM public.profiles WHERE id = $1`, [
    SYNTH_USER_ID,
  ]);
  await client.query(`DELETE FROM auth.users WHERE id = $1`, [SYNTH_USER_ID]);
}

/**
 * Conta linhas sintéticas remanescentes. 0 esperado após cleanup.
 */
export async function countSyntheticResidue(
  client: QueryClient,
): Promise<number> {
  const q = await client.query<{ n: string }>(
    `SELECT (
        (SELECT count(*) FROM public.whatsapp_processing_queue
           WHERE message_id IN (SELECT id FROM public.whatsapp_messages WHERE user_id = $1))
      + (SELECT count(*) FROM public.whatsapp_conversation_states WHERE user_id = $1)
      + (SELECT count(*) FROM public.whatsapp_outbound_queue WHERE user_id = $1)
      + (SELECT count(*) FROM public.whatsapp_messages WHERE user_id = $1)
      + (SELECT count(*) FROM public.whatsapp_contacts WHERE id = $2)
      + (SELECT count(*) FROM public.whatsapp_provider_instances
           WHERE provider = $3 AND instance_id = $4)
      + (SELECT count(*) FROM public.profiles WHERE id = $1)
      + (SELECT count(*) FROM auth.users WHERE id = $1)
     )::text AS n`,
    [SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_PROVIDER, SYNTH_INSTANCE_ID],
  );
  return Number(q.rows[0]?.n ?? "0");
}

/**
 * Cria uma mensagem inbound de texto do contato sintético + um item de
 * fila do orquestrador ('queued', route_owner='orchestrator',
 * scheduled_at no passado) pronto pra ser reivindicado. Retorna os ids
 * gerados. Ponto de partida comum pra praticamente todo cenário O1..O6.
 */
export async function seedOrchestratorQueueItem(
  client: QueryClient,
  textBody: string,
): Promise<{ messageId: string; queueId: string }> {
  await client.query("SET LOCAL search_path = public");

  const msg = await client.query<{ id: string }>(
    `INSERT INTO public.whatsapp_messages
       (user_id, contact_id, provider, instance_id, direction, message_type, text_body, status)
     VALUES ($1, $2, $3, $4, 'inbound', 'text', $5, 'received')
     RETURNING id`,
    [SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_PROVIDER, SYNTH_INSTANCE_ID, textBody],
  );
  const messageId = msg.rows[0]?.id as string;

  const q = await client.query<{ id: string }>(
    `INSERT INTO public.whatsapp_processing_queue
       (message_id, queue_type, status, route_owner, scheduled_at)
     VALUES ($1, 'command', 'queued', 'orchestrator', now() - interval '1 second')
     RETURNING id`,
    [messageId],
  );
  const queueId = q.rows[0]?.id as string;

  return { messageId, queueId };
}
