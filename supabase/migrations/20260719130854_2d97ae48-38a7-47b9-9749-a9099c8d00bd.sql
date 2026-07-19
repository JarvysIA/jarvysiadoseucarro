CREATE OR REPLACE FUNCTION public.execute_whatsapp_km_update_with_expense_link(
  p_draft_id uuid,
  p_conversation_state_id uuid,
  p_confirmation_message_id uuid,
  p_source_message_id uuid,
  p_queue_item_id uuid,
  p_user_id uuid,
  p_contact_id uuid,
  p_vehicle_id uuid,
  p_expected_previous_km integer,
  p_new_km integer,
  p_is_correction boolean,
  p_correction_confirmed boolean,
  p_correction_reason text,
  p_expected_state_version bigint,
  p_orchestrator_version text,
  p_linked_despesa_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_kind text;
BEGIN
  v_result := public.execute_whatsapp_km_update(
    p_draft_id, p_conversation_state_id, p_confirmation_message_id,
    p_source_message_id, p_queue_item_id, p_user_id, p_contact_id,
    p_vehicle_id, p_expected_previous_km, p_new_km, p_is_correction,
    p_correction_confirmed, p_correction_reason, p_expected_state_version,
    p_orchestrator_version
  );

  v_kind := v_result ->> 'kind';

  IF p_linked_despesa_id IS NOT NULL AND v_kind IN ('applied', 'no_op', 'replayed') THEN
    UPDATE public.despesas
       SET km_registro = p_new_km
     WHERE id = p_linked_despesa_id
       AND vehicle_id = p_vehicle_id
       AND user_id = p_user_id
       AND km_registro IS NULL;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.execute_whatsapp_km_update_with_expense_link(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, integer,
  boolean, boolean, text, bigint, text, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.execute_whatsapp_km_update_with_expense_link(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, integer,
  boolean, boolean, text, bigint, text, uuid
) TO postgres, sandbox_exec, service_role;