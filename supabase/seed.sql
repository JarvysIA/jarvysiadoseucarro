-- =============================================================================
-- Jarvys — seed sintético mínimo do ambiente de testes MJ1A-V-ENV-CI.
--
-- Este seed é aplicado APENAS pelo Supabase LOCAL executado no workflow
-- .github/workflows/jarvys-test-db.yml, após `supabase db reset --local`.
--
-- NÃO aplicar em produção. NÃO conter dados reais.
-- Nenhum profile, veículo, contato, mensagem, telefone, e-mail, placa,
-- CPF/CNPJ, provider id, token ou payload real.
--
-- Cria um namespace isolado `jarvys_test_meta` com:
--   - local_marker: prova de que o guard está falando com o banco local certo;
--   - tx_smoke:     tabela mínima usada pelo smoke test multi-sessão.
--
-- Grants: revogados de PUBLIC/anon/authenticated; acesso reservado ao role
-- administrativo local (postgres) usado pelo harness.
-- =============================================================================

create schema if not exists jarvys_test_meta;

revoke all on schema jarvys_test_meta from public;
revoke all on schema jarvys_test_meta from anon;
revoke all on schema jarvys_test_meta from authenticated;

-- ---------------------------------------------------------------------------
-- Marker estático do ambiente local. Uma linha única, valor fixo.
-- Usado pelo guard pós-conexão para provar identidade do banco.
-- ---------------------------------------------------------------------------
create table if not exists jarvys_test_meta.local_marker (
  marker text primary key
);

-- Idempotente: reset local reexecuta o seed do zero, mas mesmo em reruns
-- pontuais garantimos exatamente um marker.
truncate table jarvys_test_meta.local_marker;
insert into jarvys_test_meta.local_marker (marker)
values ('MJ1A_V_ENV_CI_LOCAL_V1');

-- ---------------------------------------------------------------------------
-- Tabela sintética usada exclusivamente pelo smoke transacional.
-- Não referencia auth.users, tabelas produtivas, ou qualquer schema real.
-- ---------------------------------------------------------------------------
create table if not exists jarvys_test_meta.tx_smoke (
  test_id uuid primary key,
  payload text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Fecha o namespace para roles do Data API. Apenas o superuser local (postgres),
-- usado pelo harness dedicado do CI, pode ler/escrever.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema jarvys_test_meta from public;
revoke all on all tables in schema jarvys_test_meta from anon;
revoke all on all tables in schema jarvys_test_meta from authenticated;

alter default privileges in schema jarvys_test_meta
  revoke all on tables from public, anon, authenticated;
