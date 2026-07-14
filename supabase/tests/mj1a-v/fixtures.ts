/**
 * MJ1A-V — Fixtures sintéticas reutilizáveis para os testes de concorrência
 * das RPCs de KM prompt (enqueue/finalize).
 *
 * Regras:
 *   - NÃO abre transação própria. O chamador passa um `pg.Client` já dentro
 *     de BEGIN e cuida do COMMIT/ROLLBACK.
 *   - IDs sintéticos fixos, reconhecíveis (prefixo aaaaaaaa-...). Nenhum
 *     dado real (sem telefone real, email real, placa real, CPF).
 *   - Roda somente em Postgres local do CI (superusuário postgres), onde
 *     inserir em auth.users é permitido — banco descartável.
 *   - Nunca importado por src/ nem por Edge Functions.
 *
 * Colunas NOT NULL sem default preenchidas nas fixtures:
 *   - auth.users:   id (uuid).  email preenchido também por unicidade
 *                   sintética. Demais colunas de auth.users em Supabase
 *                   local possuem default ou aceitam NULL.
 *   - profiles:     id, nome, whatsapp (id herda de auth.users).
 *   - veiculos:     user_id, placa, status.
 *   - whatsapp_provider_instances: provider, instance_id
 *                   (status/health_status têm default).
 *   - whatsapp_contacts: user_id, phone_e164 (+ opt_in/opt_out via default).
 *     Extras exigidos pela RPC: verified_at, assigned_provider,
 *     assigned_instance_id, assigned_whatsapp_number, opt_in=true.
 */

import type { Client } from "pg";

export const SYNTH_PROVIDER = "zapi" as const;
export const SYNTH_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
export const SYNTH_VEHICLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
export const SYNTH_CONTACT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
export const SYNTH_INSTANCE_ID = "mj1av-c1-instance";
export const SYNTH_INSTANCE_PHONE = "+551190000000";
export const SYNTH_CONTACT_PHONE = "+5511900000101";
export const SYNTH_PLACA = "MJ1AVC1";
export const SYNTH_EMAIL = "mj1av+c1@example.invalid";

type QueryClient = Pick<Client, "query">;

/**
 * Semeia as fixtures mínimas dentro da transação já aberta pelo chamador.
 * NÃO faz BEGIN/COMMIT. Idempotente por DELETE prévio no cleanup.
 */
export async function seedBaseFixtures(client: QueryClient): Promise<void> {
  await client.query("SET LOCAL search_path = public");

  // 1) auth.users — só o mínimo. Demais colunas possuem default ou aceitam NULL.
  await client.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_USER_ID, SYNTH_EMAIL],
  );

  // 2) profiles
  await client.query(
    `INSERT INTO public.profiles (id, nome, whatsapp)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_USER_ID, "MJ1A-V Synth", SYNTH_CONTACT_PHONE],
  );

  // 3) veiculos
  await client.query(
    `INSERT INTO public.veiculos (id, user_id, placa, status)
     VALUES ($1, $2, $3, 'ativo')
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_VEHICLE_ID, SYNTH_USER_ID, SYNTH_PLACA],
  );

  // 4) whatsapp_provider_instances
  await client.query(
    `INSERT INTO public.whatsapp_provider_instances
       (provider, instance_id, status, phone_number_e164, health_status)
     VALUES ($1, $2, 'active', $3, 'ok')
     ON CONFLICT (provider, instance_id) DO NOTHING`,
    [SYNTH_PROVIDER, SYNTH_INSTANCE_ID, SYNTH_INSTANCE_PHONE],
  );

  // 5) whatsapp_contacts
  await client.query(
    `INSERT INTO public.whatsapp_contacts
       (id, user_id, phone_e164, opt_in, opt_out, verified_at, unlinked_at,
        assigned_provider, assigned_instance_id, assigned_whatsapp_number)
     VALUES ($1, $2, $3, true, false, now(), NULL, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      SYNTH_CONTACT_ID,
      SYNTH_USER_ID,
      SYNTH_CONTACT_PHONE,
      SYNTH_PROVIDER,
      SYNTH_INSTANCE_ID,
      SYNTH_INSTANCE_PHONE,
    ],
  );
}

/**
 * Remove todos os resíduos sintéticos (fixtures + linhas geradas pelas RPCs).
 * Ordem reversa das FKs. Deve deixar zero resíduo.
 */
export async function cleanupBaseFixtures(client: QueryClient): Promise<void> {
  await client.query("SET LOCAL search_path = public");

  await client.query(
    `DELETE FROM public.whatsapp_km_prompt_requests WHERE user_id = $1`,
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
  await client.query(`DELETE FROM public.whatsapp_contacts WHERE id = $1`, [
    SYNTH_CONTACT_ID,
  ]);
  await client.query(
    `DELETE FROM public.whatsapp_provider_instances
     WHERE provider = $1 AND instance_id = $2`,
    [SYNTH_PROVIDER, SYNTH_INSTANCE_ID],
  );
  await client.query(`DELETE FROM public.veiculos WHERE id = $1`, [
    SYNTH_VEHICLE_ID,
  ]);
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
        (SELECT count(*) FROM public.whatsapp_km_prompt_requests WHERE user_id = $1)
      + (SELECT count(*) FROM public.whatsapp_outbound_queue WHERE user_id = $1)
      + (SELECT count(*) FROM public.whatsapp_messages WHERE user_id = $1)
      + (SELECT count(*) FROM public.whatsapp_contacts WHERE id = $2)
      + (SELECT count(*) FROM public.whatsapp_provider_instances
           WHERE provider = $3 AND instance_id = $4)
      + (SELECT count(*) FROM public.veiculos WHERE id = $5)
      + (SELECT count(*) FROM public.profiles WHERE id = $1)
      + (SELECT count(*) FROM auth.users WHERE id = $1)
     )::text AS n`,
    [
      SYNTH_USER_ID,
      SYNTH_CONTACT_ID,
      SYNTH_PROVIDER,
      SYNTH_INSTANCE_ID,
      SYNTH_VEHICLE_ID,
    ],
  );
  return Number(q.rows[0]?.n ?? "0");
}
