/**
 * Fixtures sintéticas para os testes de protect_privileged_profile_columns
 * (colunas trial_inicio / asaas_customer_id — Fix-Profile-Additional-Columns).
 *
 * Prefixo dos IDs sintéticos: 99999999-... (livre — não colide com
 * aaaaaaaa/bbbbbbbb/cccccccc/dddddddd/eeeeeeee/ffffffff/88888888/77777777
 * já usados pelos outros conjuntos MJ*).
 *
 * Mirror estrutural mínimo de mj2b-v/fixtures.ts: só profiles + auth.users,
 * sem veículos/whatsapp (esta suíte testa só o trigger de profiles).
 *
 * Regras herdadas:
 *   - NÃO abre transação própria. O chamador cuida de BEGIN/COMMIT.
 *   - Roda somente em Postgres local do CI (superusuário postgres).
 *   - Nunca importado por src/ nem por Edge Functions.
 *   - SET LOCAL search_path = public no início de toda função de fixture.
 */
import type { Client } from "pg";

type QueryClient = Pick<Client, "query">;

export const SYNTH_USER_ID = "99999999-9999-4999-8999-000000000001";
export const SYNTH_EMAIL = "profile-privcols+owner@example.invalid";

export async function seedProfile(client: QueryClient): Promise<void> {
  await client.query("SET LOCAL search_path = public");

  await client.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_USER_ID, SYNTH_EMAIL],
  );

  await client.query(
    `INSERT INTO public.profiles (id, nome)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH_USER_ID, "PrivCols Owner"],
  );
}

export async function cleanupProfile(client: QueryClient): Promise<void> {
  await client.query("SET LOCAL search_path = public");
  await client.query(`DELETE FROM public.profiles WHERE id = $1`, [SYNTH_USER_ID]);
  await client.query(`DELETE FROM auth.users WHERE id = $1`, [SYNTH_USER_ID]);
}

export async function countSyntheticResidue(client: QueryClient): Promise<number> {
  const q = await client.query<{ n: string }>(
    `SELECT (
        (SELECT count(*) FROM public.profiles WHERE id = $1)
      + (SELECT count(*) FROM auth.users WHERE id = $1)
     )::text AS n`,
    [SYNTH_USER_ID],
  );
  return Number(q.rows[0]?.n ?? "0");
}

export async function fetchPrivilegedColumns(
  client: QueryClient,
  id: string,
): Promise<{ trial_inicio: string | null; asaas_customer_id: string | null }> {
  const r = await client.query<{ trial_inicio: string | null; asaas_customer_id: string | null }>(
    `SELECT trial_inicio, asaas_customer_id FROM public.profiles WHERE id = $1`,
    [id],
  );
  return r.rows[0] ?? { trial_inicio: null, asaas_customer_id: null };
}
