/**
 * MJ1D-V — Fixtures sintéticas para os testes de ratificação da corrente
 * completa execute_whatsapp_km_update + apply_whatsapp_orchestrator_transition.
 *
 * Prefixo dos IDs sintéticos: dddddddd-... (dando sequência a aaaaaaaa
 * do MJ1A-V, bbbbbbbb do MJ1B-V e cccccccc do MJ1C-V, sem overlap). Os
 * quatro conjuntos rodam lado a lado no mesmo job de CI sem qualquer
 * acoplamento.
 *
 * Combina o que os fixtures de MJ1B-V e MJ1C-V oferecem separadamente:
 * precisa de veiculo (como MJ1C-V, porque execute_whatsapp_km_update
 * escreve em veiculos) E de whatsapp_provider_instances +
 * whatsapp_processing_queue (como MJ1B-V, porque apply_whatsapp_orchestrator_transition
 * exige item de fila reivindicado). Instância sintética marcada com
 * orchestrator_mode='test' — exigido pelo claim, só existe no banco
 * efêmero de CI.
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

export const SYNTH_USER_ID = "dddddddd-dddd-4ddd-8ddd-000000000001";
export const SYNTH_CONTACT_ID = "dddddddd-dddd-4ddd-8ddd-000000000002";
export const SYNTH_VEHICLE_ID = "dddddddd-dddd-4ddd-8ddd-000000000003";

export const SYNTH_PROVIDER = "zapi" as const;
export const SYNTH_INSTANCE_ID = "mj1dv-synth-instance";
export const SYNTH_INSTANCE_PHONE = "+551190002000";
export const SYNTH_CONTACT_PHONE = "+5511900002001";
export const SYNTH_EMAIL = "mj1dv+owner@example.invalid";
export const SYNTH_PLACA = "MJ1DV01";

export async function seedBaseFixtures(
  client: QueryClient,
  opts: { kmAtual?: number | null } = {},
): Promise<void> {
  const km = opts.kmAtual === undefined ? 10000 : opts.kmAtual;

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
    [SYNTH_USER_ID, "MJ1D-V Owner", SYNTH_CONTACT_PHONE],
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
     VALUES ($1, $2, $3, 'ativo', $4)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_VEHICLE_ID, SYNTH_USER_ID, SYNTH_PLACA, km],
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

export async function setVehicleKm(
  client: QueryClient,
  vehicleId: string,
  km: number | null,
): Promise<void> {
  await client.query("SET LOCAL search_path = public");
  await client.query(
    `UPDATE public.veiculos SET km_atual = $2 WHERE id = $1`,
    [vehicleId, km],
  );
}

/**
 * Cria UMA mensagem inbound de texto do contato sintético e retorna o id.
 * Serve como draft_id/source_message_id da RPC de KM (mesma FK real que
 * seedConfirmationMessage do MJ1C-V respeita).
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
 * ser reivindicado pelo claim_whatsapp_orchestrator_items (route_owner
 * 'orchestrator', queued, scheduled_at no passado). Mesmo padrão de
 * seedOrchestratorQueueItem do MJ1B-V.
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

export type ConversationStateSeed = {
  draftId: string;
  state: "awaiting_km_confirmation" | "awaiting_km_correction";
  draftPayload: Record<string, unknown>;
  stateVersion: number;
};

export async function seedConversationState(
  client: QueryClient,
  seed: ConversationStateSeed,
): Promise<string> {
  await client.query("SET LOCAL search_path = public");
  const r = await client.query<{ id: string }>(
    `INSERT INTO public.whatsapp_conversation_states
       (user_id, contact_id, active_vehicle_id, state, draft_type,
        draft_id, draft_version, draft_payload, state_version,
        last_interaction_at)
     VALUES ($1, $2, NULL, $3, 'km_update',
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
