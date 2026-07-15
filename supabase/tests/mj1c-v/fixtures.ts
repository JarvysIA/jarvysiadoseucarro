/**
 * MJ1C-V — Fixtures sintéticas para os testes de concorrência real da RPC
 * public.execute_whatsapp_km_update (Build 5.7F2E1B).
 *
 * Prefixo dos IDs sintéticos: cccccccc-... (dando sequência a aaaaaaaa
 * do MJ1A-V e bbbbbbbb do MJ1B-V, sem overlap). Os três conjuntos rodam
 * lado a lado no mesmo job de CI sem qualquer acoplamento.
 *
 * Regras herdadas de MJ1A-V/MJ1B-V:
 *   - NÃO abre transação própria. O chamador passa uma Session (ou Client)
 *     já dentro de BEGIN e cuida do COMMIT/ROLLBACK.
 *   - Roda somente em Postgres local do CI (superusuário postgres).
 *   - Nunca importado por src/ nem por Edge Functions.
 *   - SET LOCAL search_path = public no início de toda função de fixture.
 *
 * A RPC execute_whatsapp_km_update NÃO toca em whatsapp_provider_instances,
 * então não semeamos essa tabela aqui — nem alteramos orchestrator_mode em
 * lugar nenhum. Assim evitamos gastar linha de fixture inútil (e reforçamos
 * o escopo: a RPC é sobre veículo + estado conversacional + execução).
 *
 * Fixtures principais:
 *   - SYNTH_USER_ID (dono principal) + SYNTH_OTHER_USER_ID (segundo dono
 *     usado pelo cenário K8 vehicle_not_owned).
 *   - SYNTH_CONTACT_ID vinculado a SYNTH_USER_ID, verified_at preenchido.
 *   - SYNTH_VEHICLE_ID: ativo, dono SYNTH_USER_ID, km_atual começa NULL
 *     (cada teste ajusta via setVehicleKm).
 *   - SYNTH_VEHICLE_ARCHIVED_ID: status 'archived', dono SYNTH_USER_ID.
 *   - SYNTH_OTHER_VEHICLE_ID: ativo, dono SYNTH_OTHER_USER_ID.
 */

import type { Client } from "pg";

type QueryClient = Pick<Client, "query">;

export const SYNTH_USER_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
export const SYNTH_OTHER_USER_ID = "cccccccc-cccc-4ccc-8ccc-000000000002";
export const SYNTH_CONTACT_ID = "cccccccc-cccc-4ccc-8ccc-000000000003";
export const SYNTH_VEHICLE_ID = "cccccccc-cccc-4ccc-8ccc-000000000004";
export const SYNTH_VEHICLE_ARCHIVED_ID =
  "cccccccc-cccc-4ccc-8ccc-000000000005";
export const SYNTH_OTHER_VEHICLE_ID = "cccccccc-cccc-4ccc-8ccc-000000000006";

export const SYNTH_CONTACT_PHONE = "+5511900001003";
export const SYNTH_EMAIL = "mj1cv+owner@example.invalid";
export const SYNTH_OTHER_EMAIL = "mj1cv+other@example.invalid";
export const SYNTH_PLACA = "MJ1CV01";
export const SYNTH_PLACA_ARCHIVED = "MJ1CV02";
export const SYNTH_PLACA_OTHER = "MJ1CV03";

export async function seedBaseFixtures(client: QueryClient): Promise<void> {
  await client.query("SET LOCAL search_path = public");

  await client.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_USER_ID, SYNTH_EMAIL],
  );
  await client.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_OTHER_USER_ID, SYNTH_OTHER_EMAIL],
  );

  await client.query(
    `INSERT INTO public.profiles (id, nome, whatsapp)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_USER_ID, "MJ1C-V Owner", SYNTH_CONTACT_PHONE],
  );
  await client.query(
    `INSERT INTO public.profiles (id, nome, whatsapp)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_OTHER_USER_ID, "MJ1C-V Other", "+5511900001099"],
  );

  await client.query(
    `INSERT INTO public.whatsapp_contacts
       (id, user_id, phone_e164, opt_in, opt_out, verified_at, unlinked_at)
     VALUES ($1, $2, $3, true, false, now(), NULL)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_CONTACT_ID, SYNTH_USER_ID, SYNTH_CONTACT_PHONE],
  );

  // Veículo principal, km_atual começa NULL — cada cenário ajusta via
  // setVehicleKm antes de chamar a RPC.
  await client.query(
    `INSERT INTO public.veiculos (id, user_id, placa, status, km_atual)
     VALUES ($1, $2, $3, 'ativo', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_VEHICLE_ID, SYNTH_USER_ID, SYNTH_PLACA],
  );

  // Veículo arquivado do mesmo dono — K7.
  await client.query(
    `INSERT INTO public.veiculos (id, user_id, placa, status, km_atual)
     VALUES ($1, $2, $3, 'archived', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_VEHICLE_ARCHIVED_ID, SYNTH_USER_ID, SYNTH_PLACA_ARCHIVED],
  );

  // Veículo ativo do OUTRO usuário — K8.
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
 * Ajusta veiculos.km_atual sem passar pela RPC — usado por cada teste pra
 * estabelecer o km real antes de chamar execute_whatsapp_km_update.
 */
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
 * Cria mensagem inbound de texto do contato sintético e retorna o id.
 * OBRIGATÓRIO usar esse id como p_confirmation_message_id em qualquer
 * chamada da RPC que deva chegar em applied/no_op/replayed — a coluna
 * whatsapp_action_executions.source_message_id tem FK real pra
 * whatsapp_messages; passar um uuid solto derruba com erro de FK em vez
 * de devolver o jsonb esperado.
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
     VALUES ($1, $2, 'zapi', 'mj1cv-synth-instance', 'inbound', 'text',
             $3, 'received')
     RETURNING id`,
    [SYNTH_USER_ID, SYNTH_CONTACT_ID, textBody],
  );
  return r.rows[0]?.id as string;
}

export type ConversationStateSeed = {
  draftId: string;
  state: "awaiting_km_confirmation" | "awaiting_km_correction";
  draftPayload: Record<string, unknown>;
  stateVersion: number;
};

/**
 * Cria uma linha em whatsapp_conversation_states pré-configurada para a
 * RPC. Retorna o id real. draft_type é sempre 'km_update'. draft_payload
 * deve conter ao menos vehicleId, newKm, expectedPreviousKm (number|null)
 * e isCorrection (bool) — a RPC lê só esses 4 campos. Pode incluir
 * phase/requestMessageId por fidelidade ao core.ts real, sem efeito na RPC.
 */
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
