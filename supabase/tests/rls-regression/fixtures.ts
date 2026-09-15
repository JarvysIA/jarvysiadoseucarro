/**
 * RLS-Regression-Tests — fixtures e helpers compartilhados pelos 4 testes
 * de regressão de RLS desta sessão (C1, C3, C4, A3). Mirror do padrão de
 * profile-privileged-columns/fixtures.ts (usuário sintético via
 * auth.users + profiles) e mj2b-v/fixtures.ts (ordem de cleanup).
 *
 * Padrão de simulação de contexto CONFIRMADO funcionando via CI real no
 * PR #109 (exploratório): `SET LOCAL ROLE authenticated` troca o role
 * EFETIVO da sessão de verdade (current_user, não só uma GUC) — só assim
 * RLS passa a ser avaliada (Postgres pula RLS pra superuser/dono de
 * tabela, e o harness conecta como "postgres", superuser). Combinado com
 * `SET LOCAL request.jwt.claim.sub`, que é o que as funções auth.uid()
 * leem.
 *
 * Para o lado privilegiado, este build usa uma combinação mais completa
 * que os testes de TRIGGER anteriores (profile-privileged-columns, MJ2B-V
 * F2), que só precisavam de set_config('request.jwt.claims', ...) porque
 * auth.role()/auth.uid() são funções que leem GUC, não o role Postgres
 * real — e triggers rodam sempre, para qualquer role. RLS é diferente:
 * o bypass real do service_role em produção vem do atributo BYPASSRLS do
 * role Postgres "service_role" (fato conhecido da plataforma Supabase,
 * não deste repositório — não dá pra confirmar sem rodar no CI real).
 * Por isso `asServiceRole` aqui faz SET LOCAL ROLE service_role (troca
 * real de role, pra RLS respeitar o bypass) *e* set_config (pra
 * auth.role() dentro de triggers como proteger_colunas_privilegiadas_veiculo
 * também reconhecer o contexto como privilegiado).
 *
 * Prefixo dos IDs sintéticos: 33333333 (OWNER) / 44444444 (VICTIM) —
 * livres, não colidem com os outros conjuntos já usados nesta sessão
 * (aaaaaaaa/bbbbbbbb/cccccccc/dddddddd/eeeeeeee/ffffffff/88888888/
 * 77777777/99999999/11111111/22222222).
 */
import type { Session } from "../harness/db";

export const OWNER_ID = "33333333-3333-4333-8333-000000000001";
export const OWNER_EMAIL = "rls-regression+owner@example.invalid";
export const VICTIM_ID = "44444444-4444-4444-8444-000000000001";
export const VICTIM_EMAIL = "rls-regression+victim@example.invalid";

export async function seedUsers(session: Session): Promise<void> {
  await session.query("SET LOCAL search_path = public");
  for (const [id, email] of [
    [OWNER_ID, OWNER_EMAIL],
    [VICTIM_ID, VICTIM_EMAIL],
  ] as const) {
    await session.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, email],
    );
    await session.query(
      `INSERT INTO public.profiles (id, nome) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, "RLS Regression"],
    );
  }
}

export async function cleanupUsers(session: Session): Promise<void> {
  await session.query("SET LOCAL search_path = public");
  await session.query(`DELETE FROM public.profiles WHERE id IN ($1, $2)`, [OWNER_ID, VICTIM_ID]);
  await session.query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [OWNER_ID, VICTIM_ID]);
}

/**
 * Roda `run()` dentro de uma transação simulando uma chamada service_role
 * real (ex: supabaseAdmin). SET LOCAL ROLE service_role troca o role
 * efetivo — se esse role tiver BYPASSRLS (esperado, é assim que
 * service_role bypassa RLS em produção), as policies são puladas de
 * verdade, não só "coincidentemente" por sermos superuser. O set_config
 * garante que auth.role() dentro de triggers também reconheça o
 * contexto. Em erro, faz ROLLBACK e repropaga (deixa o teste decidir se
 * esperava erro ou não).
 */
export async function asServiceRole(
  session: Session,
  run: () => Promise<void>,
): Promise<void> {
  await session.begin();
  await session.query(`SET LOCAL ROLE service_role`);
  await session.query(
    `select set_config('request.jwt.claims', '{"role":"service_role"}', true)`,
  );
  try {
    await run();
    await session.commit();
  } catch (e) {
    await session.rollback();
    throw e;
  }
}

/**
 * Roda `run()` dentro de uma transação simulando um usuário autenticado
 * comum — mesma técnica confirmada funcionando de ponta a ponta no CI
 * real (PR #109): SET LOCAL ROLE authenticated + request.jwt.claim.sub.
 * Em erro, faz ROLLBACK e repropaga.
 */
export async function asUser(
  session: Session,
  userId: string,
  run: () => Promise<void>,
): Promise<void> {
  await session.begin();
  await session.query(`SET LOCAL ROLE authenticated`);
  await session.query(`SET LOCAL request.jwt.claim.sub = '${userId}'`);
  try {
    await run();
    await session.commit();
  } catch (e) {
    await session.rollback();
    throw e;
  }
}

/** Roda `run()` numa transação simples sem trocar role (superuser) — pra
 * setup/leitura de verificação fora do escopo de RLS. */
export async function asSuperuser(
  session: Session,
  run: () => Promise<void>,
): Promise<void> {
  await session.begin();
  await run();
  await session.commit();
}
