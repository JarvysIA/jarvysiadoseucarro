-- Ai-Usage-Alert: registra cada chamada de IA feita pelo app (OCR de nota,
-- Dr. Jarvys, classificação de texto de despesa) e alerta o admin por
-- WhatsApp quando um usuário cruza 40 chamadas no mesmo dia. Nunca bloqueia
-- a chamada de IA em si — é só rastreamento + alerta, efeito colateral de
-- observabilidade (ver src/lib/ai-usage-tracking.ts).

CREATE TABLE public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
-- Sem policy pra usuário comum — só service_role acessa (mesmo padrão de
-- outras tabelas internas do projeto, ex: logs_erro_bonificacao).

CREATE INDEX idx_ai_usage_events_user_day ON public.ai_usage_events (user_id, created_at);

-- record_ai_usage_and_check_alert: insere o evento e conta quantos eventos
-- esse user_id teve HOJE (fuso do servidor — date_trunc('day', now())).
-- should_alert só é true no exato cruzamento do limiar de 40 (contagem
-- igual a 40) — nunca dispara de novo em 41, 42... no mesmo dia.
CREATE OR REPLACE FUNCTION public.record_ai_usage_and_check_alert(
  p_event_type text,
  p_user_id uuid
)
RETURNS TABLE(daily_count integer, should_alert boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.ai_usage_events (user_id, event_type)
  VALUES (p_user_id, p_event_type);

  SELECT count(*)
    INTO v_count
    FROM public.ai_usage_events
   WHERE user_id = p_user_id
     AND created_at >= date_trunc('day', now());

  RETURN QUERY SELECT v_count, (v_count = 40);
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_usage_and_check_alert(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_ai_usage_and_check_alert(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_ai_usage_and_check_alert(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_usage_and_check_alert(text, uuid) TO service_role;

COMMENT ON FUNCTION public.record_ai_usage_and_check_alert(text, uuid) IS
  'Ai-Usage-Alert: insere 1 evento de uso de IA e devolve a contagem do dia (fuso do servidor) + should_alert (true só quando a contagem cruza exatamente 40, uma única vez por dia). Nunca bloqueia a chamada de IA — só observabilidade. Chamada por src/lib/ai-usage-tracking.ts via supabaseAdmin.';
