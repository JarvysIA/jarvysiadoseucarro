-- Operational-Monitoring: RPC pra consultar o último status de cada cron
-- job. O schema "cron" (pg_cron) não é exposto via PostgREST/client comum
-- do Supabase — só "public" é exposto por padrão — por isso é obrigatório
-- passar por uma função SECURITY DEFINER com search_path incluindo "cron".
--
-- IMPORTANTE: cron.job_run_details não tem índice além da pkey em runid
-- (confirmado nesta sessão, direto no Postgres de produção) — não somos
-- owner da tabela (gerenciada pelo Supabase) e CREATE INDEX falha por
-- permissão. Qualquer filtro por jobid/start_time faz table scan e trava
-- (até um count(*) simples deu timeout). O padrão seguro confirmado é
-- "ORDER BY runid DESC LIMIT 1" por job — runid é sequencial/crescente,
-- então usa o índice da PK e é rápido mesmo pro job mais raro (mensal).

CREATE OR REPLACE FUNCTION public.get_operational_health()
RETURNS TABLE(
  jobid bigint,
  jobname text,
  active boolean,
  last_status text,
  last_run timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  RETURN QUERY
  SELECT
    j.jobid,
    j.jobname,
    j.active,
    (SELECT r.status FROM cron.job_run_details r WHERE r.jobid = j.jobid ORDER BY r.runid DESC LIMIT 1),
    (SELECT r.start_time FROM cron.job_run_details r WHERE r.jobid = j.jobid ORDER BY r.runid DESC LIMIT 1)
  FROM cron.job j;
END;
$$;

REVOKE ALL ON FUNCTION public.get_operational_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_operational_health() FROM anon;
REVOKE ALL ON FUNCTION public.get_operational_health() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_operational_health() TO service_role;

COMMENT ON FUNCTION public.get_operational_health() IS
  'Operational-Monitoring: devolve último status/horário de execução de cada cron job. Usa ORDER BY runid DESC LIMIT 1 por job (não jobid/start_time) porque cron.job_run_details não tem índice além da pkey em runid e não podemos criar um (tabela do pg_cron, sem permissão de owner). Chamada por getOperationalHealthFn via supabaseAdmin.rpc.';
