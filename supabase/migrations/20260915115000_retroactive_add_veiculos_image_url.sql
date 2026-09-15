-- Retroativo: esta coluna já existe em produção (confirmado via
-- information_schema: image_url text nullable) mas nunca foi criada por
-- nenhuma migration deste repositório — foi adicionada direto no banco em
-- algum momento não documentado. Um banco criado do zero a partir das
-- migrations nunca a teve, o que só foi descoberto quando o trigger
-- proteger_colunas_privilegiadas_veiculo (Security-Audit-Fixes,
-- 20260915120002) a referenciou pela primeira vez — erro do CI ao rodar
-- `supabase db reset`: "record new has no field image_url". Este arquivo
-- só fecha o gap de reprodutibilidade, mesmo padrão já usado antes
-- (PR #94, e as migrations retroativas de C1/C2 desta mesma build).
--
-- fipe_historico NÃO precisou da mesma correção: já é criada pela
-- migration 20260610195352_6ba88fc0-1eb0-45bf-9d62-41abf143919a.sql
-- (confirmado por busca em todas as migrations do repositório antes de
-- escrever este arquivo) — só image_url estava com o gap.
ALTER TABLE public.veiculos
  ADD COLUMN IF NOT EXISTS image_url text;
