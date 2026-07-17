DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'verificar-pagamentos-pix-5min') THEN
    PERFORM cron.unschedule('verificar-pagamentos-pix-5min');
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
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'PAYMENT_CRON_SECRET')
    ),
    body := '{}'::jsonb
  );
  $job$
);