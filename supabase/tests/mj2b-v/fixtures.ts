/**
 * MJ2B-V — Fixtures sintéticas para os testes de ratificação da corrente
 * completa execute_whatsapp_expense_create + apply_whatsapp_orchestrator_transition.
 *
 * Prefixo dos IDs sintéticos: ffffffff-... (dando sequência a aaaaaaaa
 * do MJ1A-V, bbbbbbbb do MJ1B-V, cccccccc do MJ1C-V, dddddddd do
 * MJ1D-V e eeeeeeee do MJ2A-V, sem overlap). Os conjuntos rodam lado a
 * lado no mesmo job de CI sem qualquer acoplamento.
 *
 * Mirror estrutural de mj1d-v/fixtures.ts, adaptado para despesa:
 *   - draft_type fixo 'expense' (NUNCA 'expense_create').
 *   - veículo criado sem exigência de km_atual (despesa não usa esse campo).
 *   - cleanup/countSyntheticResidue somam public.despesas do vehicleId
 *     sintético (a RPC insere linha nessa tabela — resíduo silencioso
 *     mataria a prova de zero-leak).
 *
 * Regras herdadas:
 *   - NÃO abre transação própria. O chamador passa uma Session já dentro
 *     de BEGIN e cuida do COMMIT/ROLLBACK.
 *   - Roda somente em Postgres local do CI (superusuário postgres).
 *   - Nunca importado por src/ nem por Edge Functions.
 *   - SET LOCAL search_path = public no início de toda função de fixture.
 */

import type { Client } from "pg";

type QueryClient = Pick<Client, "query">;

export const SYNTH_USER_ID = "ffffffff-ffff-4fff-8fff-000000000001";
export const SYNTH_CONTACT_ID = "ffffffff-ffff-4fff-8fff-000000000002";
export const SYNTH_VEHICLE_ID = "ffffffff-ffff-4fff-8fff-000000000003";

export const SYNTH_PROVIDER = "zapi" as const;
export const SYNTH_INSTANCE_ID = "mj2bv-synth-instance";
export const SYNTH_INSTANCE_PHONE = "+551190004000";
export const SYNTH_CONTACT_PHONE = "+5511900004001";
export const SYNTH_EMAIL = "mj2bv+owner@example.invalid";
export const SYNTH_PLACA = "MJ2BV01";

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
    [SYNTH_USER_ID, "MJ2B-V Owner", SYNTH_CONTACT_PHONE],
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

  await client.query(
    `INSERT INTO public.veiculos (id, user_id, placa, status, km_atual)
     VALUES ($1, $2, $3, 'ativo', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_VEHICLE_ID, SYNTH_USER_ID, SYNTH_PLACA],
  );
}

export async function cleanupBaseFixtures(
  client: QueryClient,
): Promise<void> {
  await client.query("SET LOCAL search_path = public");

  await client.query(
    `DELETE FROM public.whatsapp_action_executions WHERE user_id = $1`,
    [SYNTH_USER_ID],
  );
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
  await client.query(
    `DELETE FROM public.whatsapp_messages WHERE user_id = $1`,
    [SYNTH_USER_ID],
  );
  // Deleta despesas ANTES de veiculos — mesmo cuidado do MJ2A-V.
  await client.query(
    `DELETE FROM public.despesas WHERE vehicle_id = $1`,
    [SYNTH_VEHICLE_ID],
  );
  await client.query(
    `DELETE FROM public.veiculos WHERE id = $1`,
    [SYNTH_VEHICLE_ID],
  );
  await client.query(
    `DELETE FROM public.whatsapp_contacts WHERE id = $1`,
    [SYNTH_CONTACT_ID],
  );
  await client.query(
    `DELETE FROM public.whatsapp_provider_instances
      WHERE provider = $1 AND instance_id = $2`,
    [SYNTH_PROVIDER, SYNTH_INSTANCE_ID],
  );
  await client.query(
    `DELETE FROM public.profiles WHERE id = $1`,
    [SYNTH_USER_ID],
  );
  await client.query(
    `DELETE FROM auth.users WHERE id = $1`,
    [SYNTH_USER_ID],
  );
}

export async function countSyntheticResidue(
  client: QueryClient,
): Promise<number> {
  const q = await client.query<{ n: string }>(
    `SELECT (
        (SELECT count(*) FROM public.whatsapp_action_executions WHERE user_id = $1)
      + (SELECT count(*) FROM public.whatsapp_processing_queue
           WHERE message_id IN (SELECT id FROM public.whatsapp_messages WHERE user_id = $1))
      + (SELECT count(*) FROM public.whatsapp_conversation_states WHERE user_id = $1)
      + (SELECT count(*) FROM public.whatsapp_outbound_queue WHERE user_id = $1)
      + (SELECT count(*) FROM public.whatsapp_messages WHERE user_id = $1)
      + (SELECT count(*) FROM public.despesas WHERE vehicle_id = $2)
      + (SELECT count(*) FROM public.veiculos WHERE id = $2)
      + (SELECT count(*) FROM public.whatsapp_contacts WHERE id = $3)
      + (SELECT count(*) FROM public.whatsapp_provider_instances
           WHERE provider = $4 AND instance_id = $5)
      + (SELECT count(*) FROM public.profiles WHERE id = $1)
      + (SELECT count(*) FROM auth.users WHERE id = $1)
     )::text AS n`,
    [
      SYNTH_USER_ID,
      SYNTH_VEHICLE_ID,
      SYNTH_CONTACT_ID,
      SYNTH_PROVIDER,
      SYNTH_INSTANCE_ID,
    ],
  );
  return Number(q.rows[0]?.n ?? "0");
}

/**
 * Cria UMA mensagem inbound de texto do contato sintético e retorna o id.
 * Serve como draft_id/source_message_id da RPC de expense.
 */
export async function seedReportMessage(
  client: QueryClient,
  textBody: string,
): Promise<string> {
  await client.query("SET LOCAL search_path = public");
  const r = await client.query<{ id: string }>(
    `INSERT INTO public.whatsapp_messages
       (user_id, contact_id, provider, instance_id, direction, message_type,
        text_body, status)
     VALUES ($1, $2, $3, $4, 'inbound', 'text', $5, 'received')
     RETURNING id`,
    [SYNTH_USER_ID, SYNTH_CONTACT_ID, SYNTH_PROVIDER, SYNTH_INSTANCE_ID, textBody],
  );
  return r.rows[0]?.id as string;
}

/**
 * Cria mensagem inbound + item em whatsapp_processing_queue pronto para
 * ser reivindicado pelo claim_whatsapp_orchestrator_items.
 */
export async function seedConfirmationQueueItem(
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

export type ExpenseConversationStateSeed = {
  draftId: string;
  state: "awaiting_expense_confirmation" | "awaiting_expense_correction";
  draftPayload: Record<string, unknown>;
  stateVersion: number;
};

export async function seedConversationState(
  client: QueryClient,
  seed: ExpenseConversationStateSeed,
): Promise<string> {
  await client.query("SET LOCAL search_path = public");
  const r = await client.query<{ id: string }>(
    `INSERT INTO public.whatsapp_conversation_states
       (user_id, contact_id, active_vehicle_id, state, draft_type,
        draft_id, draft_version, draft_payload, state_version,
        last_interaction_at)
     VALUES ($1, $2, NULL, $3, 'expense',
             $4, 0, $5::jsonb, $6, now())
     RETURNING id`,
    [
      SYNTH_USER_ID,
      SYNTH_CONTACT_ID,
      seed.state,
      seed.draftId,
      seed.draftPayload,
      seed.stateVersion,
    ],
  );
  return r.rows[0]?.id as string;
}

export async function fetchDespesaCount(
  client: QueryClient,
  vehicleId: string,
): Promise<number> {
  const r = await client.query<{ n: string }>(
    `SELECT count(*)::text as n FROM public.despesas WHERE vehicle_id = $1`,
    [vehicleId],
  );
  return Number(r.rows[0]?.n ?? "0");
}
