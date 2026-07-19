/**
 * MJ4x-V — Fixtures sintéticas para os testes de ratificação da RPC
 * execute_whatsapp_km_update_with_expense_link (item 6 — Revisão/
 * Manutenção via WhatsApp).
 *
 * Prefixo dos IDs sintéticos: gggggggg-... (dando sequência a aaaaaaaa
 * do MJ1A-V, bbbbbbbb do MJ1B-V, cccccccc do MJ1C-V, dddddddd do
 * MJ1D-V, eeeeeeee do MJ2A-V e ffffffff do MJ2B-V, sem overlap). MJ3 foi
 * reservado pelo item 3 e não é reaproveitado aqui.
 *
 * Escopo: a RPC nova SÓ acrescenta a ligação despesa->km em cima da RPC
 * original (execute_whatsapp_km_update), já ratificada em MJ1C-V/MJ1D-V.
 * Estas fixtures cobrem apenas o que é NOVO: os cenários G1-G6 da RPC de
 * ligação. Não re-testam vehicle_archived/vehicle_not_owned/km_conflict/
 * state_version_conflict/etc. da RPC base — isso já está provado contra
 * Postgres real em MJ1C-V (K1-K12).
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

export const SYNTH_USER_ID = "gggggggg-gggg-4ggg-8ggg-000000000001";
export const SYNTH_OTHER_USER_ID = "gggggggg-gggg-4ggg-8ggg-000000000002";
export const SYNTH_CONTACT_ID = "gggggggg-gggg-4ggg-8ggg-000000000003";
export const SYNTH_VEHICLE_ID = "gggggggg-gggg-4ggg-8ggg-000000000004";
export const SYNTH_VEHICLE_ARCHIVED_ID = "gggggggg-gggg-4ggg-8ggg-000000000005";
export const SYNTH_OTHER_VEHICLE_ID = "gggggggg-gggg-4ggg-8ggg-000000000006";

export const SYNTH_CONTACT_PHONE = "+5511900007001";
export const SYNTH_EMAIL = "mj4xv+owner@example.invalid";
export const SYNTH_OTHER_EMAIL = "mj4xv+other@example.invalid";
export const SYNTH_PLACA = "MJ4XV01";
export const SYNTH_PLACA_ARCHIVED = "MJ4XV02";
export const SYNTH_PLACA_OTHER = "MJ4XV03";

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
    [SYNTH_USER_ID, "MJ4x-V Owner", SYNTH_CONTACT_PHONE],
  );
  await client.query(
    `INSERT INTO public.profiles (id, nome, whatsapp)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_OTHER_USER_ID, "MJ4x-V Other", "+5511900007099"],
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

export async function cleanupBaseFixtures(client: QueryClient): Promise<void> {
  await client.query("SET LOCAL search_path = public");

  await client.query(
    `DELETE FROM public.whatsapp_action_executions WHERE user_id = ANY($1::uuid[])`,
    [[SYNTH_USER_ID, SYNTH_OTHER_USER_ID]],
  );
  await client.query(
    `DELETE FROM public.whatsapp_conversation_states WHERE contact_id = $1`,
    [SYNTH_CONTACT_ID],
  );
  await client.query(
    `DELETE FROM public.whatsapp_messages WHERE user_id = ANY($1::uuid[])`,
    [[SYNTH_USER_ID, SYNTH_OTHER_USER_ID]],
  );
  await client.query(
    `DELETE FROM public.despesas WHERE vehicle_id = ANY($1::uuid[])`,
    [[SYNTH_VEHICLE_ID, SYNTH_VEHICLE_ARCHIVED_ID, SYNTH_OTHER_VEHICLE_ID]],
  );
  await client.query(
    `DELETE FROM public.veiculos WHERE id = ANY($1::uuid[])`,
    [[SYNTH_VEHICLE_ID, SYNTH_VEHICLE_ARCHIVED_ID, SYNTH_OTHER_VEHICLE_ID]],
  );
  await client.query(
    `DELETE FROM public.whatsapp_contacts WHERE id = $1`,
    [SYNTH_CONTACT_ID],
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

export async function countSyntheticResidue(client: QueryClient): Promise<number> {
  const q = await client.query<{ n: string }>(
    `SELECT (
        (SELECT count(*) FROM public.whatsapp_action_executions WHERE user_id = ANY($1::uuid[]))
      + (SELECT count(*) FROM public.whatsapp_conversation_states WHERE contact_id = $2)
      + (SELECT count(*) FROM public.whatsapp_messages WHERE user_id = ANY($1::uuid[]))
      + (SELECT count(*) FROM public.despesas WHERE vehicle_id = ANY($3::uuid[]))
      + (SELECT count(*) FROM public.veiculos WHERE id = ANY($3::uuid[]))
      + (SELECT count(*) FROM public.whatsapp_contacts WHERE id = $2)
      + (SELECT count(*) FROM public.profiles WHERE id = ANY($1::uuid[]))
      + (SELECT count(*) FROM auth.users WHERE id = ANY($1::uuid[]))
     )::text AS n`,
    [
      [SYNTH_USER_ID, SYNTH_OTHER_USER_ID],
      SYNTH_CONTACT_ID,
      [SYNTH_VEHICLE_ID, SYNTH_VEHICLE_ARCHIVED_ID, SYNTH_OTHER_VEHICLE_ID],
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
  await client.query(`UPDATE public.veiculos SET km_atual = $2 WHERE id = $1`, [vehicleId, km]);
}

export async function seedConfirmationMessage(
  client: QueryClient,
  textBody: string,
): Promise<string> {
  await client.query("SET LOCAL search_path = public");
  const r = await client.query<{ id: string }>(
    `INSERT INTO public.whatsapp_messages
       (user_id, contact_id, provider, instance_id, direction, message_type,
        text_body, status)
     VALUES ($1, $2, 'zapi', 'mj4xv-synth-instance', 'inbound', 'text',
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
    [SYNTH_USER_ID, SYNTH_CONTACT_ID, seed.state, seed.draftId, seed.draftPayload, seed.stateVersion],
  );
  return r.rows[0]?.id as string;
}

/**
 * Insere uma despesa diretamente (sem passar pela RPC de despesa — fora
 * do escopo deste build), com o km_registro que o cenário precisar.
 */
export async function seedDespesa(
  client: QueryClient,
  args: {
    userId: string;
    vehicleId: string;
    kmRegistro: number | null;
  },
): Promise<string> {
  await client.query("SET LOCAL search_path = public");
  const r = await client.query<{ id: string }>(
    `INSERT INTO public.despesas
       (user_id, vehicle_id, data, valor, categoria, descricao, km_registro)
     VALUES ($1, $2, CURRENT_DATE, 150.00, 'Revisão', 'MJ4x-V synthetic', $3)
     RETURNING id`,
    [args.userId, args.vehicleId, args.kmRegistro],
  );
  return r.rows[0]?.id as string;
}

export async function fetchDespesaKmRegistro(
  client: QueryClient,
  despesaId: string,
): Promise<number | null> {
  const r = await client.query<{ km_registro: number | null }>(
    `SELECT km_registro FROM public.despesas WHERE id = $1`,
    [despesaId],
  );
  return r.rows[0]?.km_registro ?? null;
}
