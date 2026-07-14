CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1) Função utilitária para upsert no Vault (uso restrito a service_role/postgres)
CREATE OR REPLACE FUNCTION public.upsert_vault_secret(_name text, _value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _id uuid;
BEGIN
  SELECT id INTO _id FROM vault.secrets WHERE name = _name;
  IF _id IS NULL THEN
    PERFORM vault.create_secret(_value, _name);
  ELSE
    PERFORM vault.update_secret(_id, _value, _name);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_vault_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_vault_secret(text, text) TO service_role;

-- 2) Reagenda cron FIPE com header x-cron-secret vindo do Vault
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 1) THEN
    PERFORM cron.unschedule(1);
  END IF;
END $$;
SELECT cron.schedule(
  'fipe-monthly-refresh',
  '0 9 7 * *',
  $job$
  SELECT net.http_post(
    url := 'https://project--40c0308e-ece5-4528-ba87-83157e2ce465-dev.lovable.app/api/public/hooks/fipe-monthly-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'FIPE_CRON_SECRET')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $job$
);

-- 3) Reagenda cron verificar-pagamentos com header x-cron-secret vindo do Vault
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 2) THEN
    PERFORM cron.unschedule(2);
  END IF;
END $$;
SELECT cron.schedule(
  'verificar-pagamentos-pix-5min',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://thbbyjyefozrznocihso.supabase.co/functions/v1/verificar-pagamentos-asaas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoYmJ5anllZm96cnpub2NpaHNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMTQ1NDgsImV4cCI6MjA5NTU5MDU0OH0.fAZ3RPOSRYf3ckrfB9ELo4gXUuD2NLT3b5hAjvs81v4',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'PAYMENT_CRON_SECRET')
    ),
    body := '{}'::jsonb
  );
  $job$
);
