/**
 * MJ2A-V — Fixtures sintéticas para os testes de concorrência real da RPC
 * isolada public.execute_whatsapp_expense_create.
 *
 * Prefixo dos IDs sintéticos: eeeeeeee-... (sequência depois de aaaa/bbbb/
 * cccc/dddd, sem overlap). Roda lado a lado com MJ1*-V no mesmo job de CI.
 *
 * Regras herdadas de MJ1*-V:
 *   - NÃO abre transação própria. O chamador passa uma Session já dentro
 *     de BEGIN e cuida do COMMIT/ROLLBACK.
 *   - Roda somente em Postgres local do CI (superusuário postgres).
 *   - Nunca importado por src/ nem por Edge Functions.
 *   - SET LOCAL search_path = public no início de toda função de fixture.
 *
 * Diferença em relação a mj1c-v: cleanup deleta explicitamente
 * public.despesas antes de veiculos (sem confiar em ON DELETE CASCADE)
 * e countSyntheticResidue soma despesas — a RPC insere linha nessa tabela
 * e um resíduo silencioso mataria a prova de zero-leak.
 */

import type { Client } from "pg";

type QueryClient = Pick<Client, "query">;

export const SYNTH_USER_ID = "eeeeeeee-eeee-4eee-8eee-000000000001";
export const SYNTH_OTHER_USER_ID = "eeeeeeee-eeee-4eee-8eee-000000000002";
export const SYNTH_CONTACT_ID = "eeeeeeee-eeee-4eee-8eee-000000000003";
export const SYNTH_VEHICLE_ID = "eeeeeeee-eeee-4eee-8eee-000000000004";
export const SYNTH_VEHICLE_ARCHIVED_ID =
  "eeeeeeee-eeee-4eee-8eee-000000000005";
export const SYNTH_OTHER_VEHICLE_ID = "eeeeeeee-eeee-4eee-8eee-000000000006";

export const SYNTH_CONTACT_PHONE = "+5511900003003";
export const SYNTH_EMAIL = "mj2av+owner@example.invalid";
export const SYNTH_OTHER_EMAIL = "mj2av+other@example.invalid";
export const SYNTH_PLACA = "MJ2AV01";
export const SYNTH_PLACA_ARCHIVED = "MJ2AV02";
export const SYNTH_PLACA_OTHER = "MJ2AV03";

export async function seedBaseFixtures(client: QueryClient): Promise<void> {
  await client.query("SET LOCAL search_path = public");

  await client.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [SYNTH_USER_ID, SYNTH_EMAIL],
  );
  await client.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [SYNTH_OTHER_USER_ID, SYNTH_OTHER_EMAIL],
  );

  await client.query(
    `INSERT INTO public.profiles (id, nome, whatsapp)
     VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [SYNTH_USER_ID, "MJ2A-V Owner", SYNTH_CONTACT_PHONE],
  );
  await client.query(
    `INSERT INTO public.profiles (id, nome, whatsapp)
     VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [SYNTH_OTHER_USER_ID, "MJ2A-V Other", "+5511900003099"],
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

  await client.query(
    `INSERT INTO public.veiculos (id, user_id, placa, status, km_atual)
     VALUES ($1, $2, $3, 'archived', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_VEHICLE_ARCHIVED_ID, SYNTH_USER_ID, SYNTH_PLACA_ARCHIVED],
  );

  await client.query(
    `INSERT INTO public.veiculos (id, user_id, placa, status, km_atual)
     VALUES ($1, $2, $3, 'ativo', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_OTHER_VEHICLE_ID, SYNTH_OTHER_USER_ID, SYNTH_PLACA_OTHER],
  );
}

export async function cleanupBaseFixtures(
  client: QueryClient,
): Promise<void> {
  await client.query("SET LOCAL search_path = public");

  await client.query(
    `DELETE FROM public.whatsapp_action_executions
      WHERE user_id = ANY($1::uuid[])`,
    [[SYNTH_USER_ID, SYNTH_OTHER_USER_ID]],
  );
  await client.query(
    `DELETE FROM public.whatsapp_conversation_states WHERE contact_id = $1`,
    [SYNTH_CONTACT_ID],
  );
  await client.query(
    `DELETE FROM public.whatsapp_messages WHERE user_id = $1`,
    [SYNTH_USER_ID],
  );
  await client.query(
    `DELETE FROM public.whatsapp_contacts WHERE id = $1`,
    [SYNTH_CONTACT_ID],
  );
  // Deleta despesas ANTES de veiculos — FK poderia cascade, mas contamos
  // explicitamente pra provar zero resíduo.
  await client.query(
    `DELETE FROM public.despesas WHERE vehicle_id = ANY($1::uuid[])`,
    [[SYNTH_VEHICLE_ID, SYNTH_VEHICLE_ARCHIVED_ID, SYNTH_OTHER_VEHICLE_ID]],
  );
  await client.query(
    `DELETE FROM public.veiculos WHERE id = ANY($1::uuid[])`,
    [[SYNTH_VEHICLE_ID, SYNTH_VEHICLE_ARCHIVED_ID, SYNTH_OTHER_VEHICLE_ID]],
  );
  await client.query(
    `DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`,
    [[SYNTH_USER_ID, SYNTH_OTHER_USER_ID]],
  );
  await client.query(
    `DELETE FROM auth.users WHERE id = ANY($1::uuid[])`,
    [[SYNTH_USER_ID, SYNTH_OTHER_USER_ID]],
  );
}

export async function countSyntheticResidue(
  client: QueryClient,
): Promise<number> {
  const q = await client.query<{ n: string }>(
    `SELECT (
        (SELECT count(*) FROM public.whatsapp_action_executions
           WHERE user_id = ANY($1::uuid[]))
      + (SELECT count(*) FROM public.whatsapp_conversation_states
           WHERE contact_id = $2)
      + (SELECT count(*) FROM public.whatsapp_messages WHERE user_id = $3)
      + (SELECT count(*) FROM public.whatsapp_contacts WHERE id = $2)
      + (SELECT count(*) FROM public.despesas
           WHERE vehicle_id = ANY($4::uuid[]))
      + (SELECT count(*) FROM public.veiculos WHERE id = ANY($4::uuid[]))
      + (SELECT count(*) FROM public.profiles WHERE id = ANY($1::uuid[]))
      + (SELECT count(*) FROM auth.users WHERE id = ANY($1::uuid[]))
     )::text AS n`,
    [
      [SYNTH_USER_ID, SYNTH_OTHER_USER_ID],
      SYNTH_CONTACT_ID,
      SYNTH_USER_ID,
      [SYNTH_VEHICLE_ID, SYNTH_VEHICLE_ARCHIVED_ID, SYNTH_OTHER_VEHICLE_ID],
    ],
  );
  return Number(q.rows[0]?.n ?? "0");
}

/**
 * Cria mensagem inbound de texto e retorna o id. Igual ao equivalente em
 * mj1c-v: whatsapp_action_executions.source_message_id tem FK real pra
 * whatsapp_messages — SEMPRE usar o id retornado daqui como
 * p_confirmation_message_id / p_source_message_id.
 */
export async function seedConfirmationMessage(
  client: QueryClient,
  textBody: string,
): Promise<string> {
  await client.query("SET LOCAL search_path = public");
  const r = await client.query<{ id: string }>(
    `INSERT INTO public.whatsapp_messages
       (user_id, contact_id, provider, instance_id, direction, message_type,
        text_body, status)
     VALUES ($1, $2, 'zapi', 'mj2av-synth-instance', 'inbound', 'text',
             $3, 'received')
     RETURNING id`,
    [SYNTH_USER_ID, SYNTH_CONTACT_ID, textBody],
  );
  return r.rows[0]?.id as string;
}

export type ExpenseConversationStateSeed = {
  draftId: string;
  state: "awaiting_expense_confirmation" | "awaiting_expense_correction";
  draftPayload: Record<string, unknown>;
  stateVersion: number;
};

/**
 * Insere linha em whatsapp_conversation_states com draft_type fixo 'expense'
 * (NUNCA 'expense_create' — o CHECK real wcs_draft_type_valid usa 'expense').
 * Retorna o id da linha criada.
 */
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

/**
 * Variante "raw" — permite state/draft_type arbitrários pra cobrir E5
 * (state inválido pro fluxo) e E6 (draft_type divergente). Bypass do tipo
 * estrito acima, usada apenas nos dois cenários que precisam desviar da
 * combinação normal.
 */
export async function seedConversationStateRaw(
  client: QueryClient,
  seed: {
    state: string;
    draftType: string;
    draftId: string;
    draftPayload: Record<string, unknown>;
    stateVersion: number;
  },
): Promise<string> {
  await client.query("SET LOCAL search_path = public");
  const r = await client.query<{ id: string }>(
    `INSERT INTO public.whatsapp_conversation_states
       (user_id, contact_id, active_vehicle_id, state, draft_type,
        draft_id, draft_version, draft_payload, state_version,
        last_interaction_at)
     VALUES ($1, $2, NULL, $3, $4,
             $5, 0, $6::jsonb, $7, now())
     RETURNING id`,
    [
      SYNTH_USER_ID,
      SYNTH_CONTACT_ID,
      seed.state,
      seed.draftType,
      seed.draftId,
      seed.draftPayload,
      seed.stateVersion,
    ],
  );
  return r.rows[0]?.id as string;
}

export async function fetchDespesa(
  client: QueryClient,
  despesaId: string,
): Promise<Record<string, unknown> | null> {
  const r = await client.query(
    `SELECT id, user_id, vehicle_id, valor, categoria, descricao
       FROM public.despesas WHERE id = $1`,
    [despesaId],
  );
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function countDespesasForVehicles(
  client: QueryClient,
): Promise<number> {
  const r = await client.query<{ n: string }>(
    `SELECT count(*)::text as n FROM public.despesas
      WHERE vehicle_id = ANY($1::uuid[])`,
    [[SYNTH_VEHICLE_ID, SYNTH_VEHICLE_ARCHIVED_ID, SYNTH_OTHER_VEHICLE_ID]],
  );
  return Number(r.rows[0]?.n ?? "0");
}
