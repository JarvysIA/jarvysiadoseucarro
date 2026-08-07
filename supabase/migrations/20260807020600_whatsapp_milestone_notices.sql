-- Build MJ2C — Infra backend-only de estado de aviso de marco de revisão
-- preventiva via WhatsApp (whatsapp_milestone_notices). Tabela + 1 RPC
-- SECURITY DEFINER (service_role). Nenhuma policy cliente. Não conectada
-- ao worker/sender/core. Snooze é sempre 15 dias fixos.

CREATE TABLE public.whatsapp_milestone_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.veiculos(id),
  user_id uuid NOT NULL,
  milestone_km integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'notified', 'snoozed', 'dismissed')),
  notified_at timestamptz,
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, milestone_km)
);

ALTER TABLE public.whatsapp_milestone_notices OWNER TO postgres;

ALTER TABLE public.whatsapp_milestone_notices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_milestone_notices FROM PUBLIC;
REVOKE ALL ON public.whatsapp_milestone_notices FROM anon;
REVOKE ALL ON public.whatsapp_milestone_notices FROM authenticated;

COMMENT ON TABLE public.whatsapp_milestone_notices IS
  'Build MJ2C — Estado de aviso de marco de revisão preventiva via WhatsApp (pending/notified/snoozed/dismissed), UNIQUE por (vehicle_id, milestone_km). Acesso exclusivo por função SECURITY DEFINER de service_role; não é acessível ao cliente. Ainda desconectada do runtime.';

-- ============================================================
-- RPC: record_whatsapp_milestone_notice
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_whatsapp_milestone_notice(
  p_user_id uuid,
  p_vehicle_id uuid,
  p_milestone_km integer,
  p_action text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle record;
  v_row record;
BEGIN
  -- Validação de invariantes
  IF p_user_id IS NULL OR p_vehicle_id IS NULL OR p_milestone_km IS NULL
     OR p_milestone_km <= 0 OR p_action IS NULL
     OR p_action NOT IN ('notified', 'snooze', 'dismiss') THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  -- Ownership: veículo precisa existir e pertencer ao user_id
  SELECT id, user_id, status INTO v_vehicle
    FROM public.veiculos
    WHERE id = p_vehicle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind','rejected','reason','vehicle_not_found');
  END IF;

  IF v_vehicle.user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('kind','rejected','reason','vehicle_not_owned');
  END IF;

  -- Upsert atômico
  INSERT INTO public.whatsapp_milestone_notices (
    vehicle_id, user_id, milestone_km, status, notified_at, snoozed_until, dismissed_at
  ) VALUES (
    p_vehicle_id, p_user_id, p_milestone_km,
    CASE p_action
      WHEN 'notified' THEN 'notified'
      WHEN 'snooze' THEN 'snoozed'
      WHEN 'dismiss' THEN 'dismissed'
    END,
    CASE WHEN p_action = 'notified' THEN now() ELSE NULL END,
    CASE WHEN p_action = 'snooze' THEN now() + interval '15 days' ELSE NULL END,
    CASE WHEN p_action = 'dismiss' THEN now() ELSE NULL END
  )
  ON CONFLICT (vehicle_id, milestone_km) DO UPDATE SET
    status = EXCLUDED.status,
    notified_at = COALESCE(public.whatsapp_milestone_notices.notified_at, EXCLUDED.notified_at),
    snoozed_until = CASE WHEN p_action = 'snooze' THEN EXCLUDED.snoozed_until
                          ELSE public.whatsapp_milestone_notices.snoozed_until END,
    dismissed_at = CASE WHEN p_action = 'dismiss' THEN EXCLUDED.dismissed_at
                         ELSE public.whatsapp_milestone_notices.dismissed_at END
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'kind','recorded',
    'id', v_row.id,
    'status', v_row.status,
    'notifiedAt', v_row.notified_at,
    'snoozedUntil', v_row.snoozed_until,
    'dismissedAt', v_row.dismissed_at
  );
END;
$function$;

-- REVOKE explícito — Supabase auto-concede EXECUTE a anon/authenticated
-- em toda função nova. Sem isso, qualquer usuário autenticado poderia
-- chamar esta RPC diretamente.
REVOKE EXECUTE ON FUNCTION public.record_whatsapp_milestone_notice FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_whatsapp_milestone_notice FROM anon, authenticated;
