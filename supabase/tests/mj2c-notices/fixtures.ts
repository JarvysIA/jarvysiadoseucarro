/**
 * MJ2C-V — Fixtures sintéticas para os testes da RPC
 * public.record_whatsapp_milestone_notice.
 *
 * Prefixo dos IDs sintéticos: 88888888-... (confirmado sem overlap contra
 * os demais fixtures.ts de mjXX-v antes de escolher).
 *
 * Regras herdadas de MJ1*-V/MJ2A-V:
 *   - NÃO abre transação própria. O chamador passa uma Session já dentro
 *     de BEGIN e cuida do COMMIT/ROLLBACK.
 *   - Roda somente em Postgres local do CI (superusuário postgres).
 *   - Nunca importado por src/ nem por Edge Functions.
 *   - SET LOCAL search_path = public no início de toda função de fixture.
 */

import type { Client } from "pg";

type QueryClient = Pick<Client, "query">;

export const SYNTH_USER_ID = "88888888-8888-4888-8888-000000000001";
export const SYNTH_OTHER_USER_ID = "88888888-8888-4888-8888-000000000002";
export const SYNTH_VEHICLE_ID = "88888888-8888-4888-8888-000000000003";
export const SYNTH_OTHER_VEHICLE_ID = "88888888-8888-4888-8888-000000000004";

export const SYNTH_EMAIL = "mj2cv+owner@example.invalid";
export const SYNTH_OTHER_EMAIL = "mj2cv+other@example.invalid";
export const SYNTH_PHONE = "+5511900008001";
export const SYNTH_OTHER_PHONE = "+5511900008002";
export const SYNTH_PLACA = "MJ2CV01";
export const SYNTH_PLACA_OTHER = "MJ2CV02";

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
    [SYNTH_USER_ID, "MJ2C-V Owner", SYNTH_PHONE],
  );
  await client.query(
    `INSERT INTO public.profiles (id, nome, whatsapp)
     VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [SYNTH_OTHER_USER_ID, "MJ2C-V Other", SYNTH_OTHER_PHONE],
  );

  await client.query(
    `INSERT INTO public.veiculos (id, user_id, placa, status, km_atual)
     VALUES ($1, $2, $3, 'ativo', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_VEHICLE_ID, SYNTH_USER_ID, SYNTH_PLACA],
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
    `DELETE FROM public.whatsapp_milestone_notices
      WHERE vehicle_id = ANY($1::uuid[])`,
    [[SYNTH_VEHICLE_ID, SYNTH_OTHER_VEHICLE_ID]],
  );
  await client.query(`DELETE FROM public.veiculos WHERE id = ANY($1::uuid[])`, [
    [SYNTH_VEHICLE_ID, SYNTH_OTHER_VEHICLE_ID],
  ]);
  await client.query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [
    [SYNTH_USER_ID, SYNTH_OTHER_USER_ID],
  ]);
  await client.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [
    [SYNTH_USER_ID, SYNTH_OTHER_USER_ID],
  ]);
}

export async function countSyntheticResidue(client: QueryClient): Promise<number> {
  const q = await client.query<{ n: string }>(
    `SELECT (
        (SELECT count(*) FROM public.whatsapp_milestone_notices
           WHERE vehicle_id = ANY($1::uuid[]))
      + (SELECT count(*) FROM public.veiculos WHERE id = ANY($1::uuid[]))
      + (SELECT count(*) FROM public.profiles WHERE id = ANY($2::uuid[]))
      + (SELECT count(*) FROM auth.users WHERE id = ANY($2::uuid[]))
     )::text AS n`,
    [
      [SYNTH_VEHICLE_ID, SYNTH_OTHER_VEHICLE_ID],
      [SYNTH_USER_ID, SYNTH_OTHER_USER_ID],
    ],
  );
  return Number(q.rows[0]?.n ?? "0");
}
