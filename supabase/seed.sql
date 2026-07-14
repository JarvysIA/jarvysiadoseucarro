-- =============================================================================
-- Jarvys — seed sintético mínimo do ambiente de testes MJ1A-V-ENV-CI.
--
-- Este seed é aplicado APENAS pelo Supabase LOCAL executado no workflow
-- .github/workflows/jarvys-test-db.yml, após `supabase db reset --local`.
--
-- NÃO aplicar em produção. NÃO conter dados reais.
--
-- Tudo dentro de um único bloco DO $$ ... $$ com EXECUTE: o Supabase CLI
-- envia seed.sql em lote (batch), e DDL seguido de DML dependente em
-- statements separados pode falhar com "relation does not exist" mesmo
-- em ordem correta (erro documentado do supabase/cli). Um bloco único
-- elimina o problema — o servidor processa tudo sequencialmente.
-- =============================================================================
DO $$
BEGIN
  EXECUTE 'CREATE SCHEMA IF NOT EXISTS jarvys_test_meta';

  EXECUTE 'REVOKE ALL ON SCHEMA jarvys_test_meta FROM public';
  EXECUTE 'REVOKE ALL ON SCHEMA jarvys_test_meta FROM anon';
  EXECUTE 'REVOKE ALL ON SCHEMA jarvys_test_meta FROM authenticated';

  EXECUTE 'CREATE TABLE IF NOT EXISTS jarvys_test_meta.local_marker (
    marker text primary key
  )';

  EXECUTE 'TRUNCATE TABLE jarvys_test_meta.local_marker';

  EXECUTE $sql$INSERT INTO jarvys_test_meta.local_marker (marker)
    VALUES (''MJ1A_V_ENV_CI_LOCAL_V1'')$sql$;

  EXECUTE 'CREATE TABLE IF NOT EXISTS jarvys_test_meta.tx_smoke (
    test_id uuid primary key,
    payload text not null,
    created_at timestamptz not null default now()
  )';

  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA jarvys_test_meta FROM public';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA jarvys_test_meta FROM anon';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA jarvys_test_meta FROM authenticated';

  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA jarvys_test_meta
    REVOKE ALL ON TABLES FROM public, anon, authenticated';
END $$;
