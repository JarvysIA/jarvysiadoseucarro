GRANT EXECUTE ON FUNCTION public.execute_whatsapp_km_update_with_expense_link(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, integer,
  boolean, boolean, text, bigint, text, uuid
) TO postgres, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.execute_whatsapp_km_update_with_expense_link(' ||
      'uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, integer, ' ||
      'boolean, boolean, text, bigint, text, uuid) TO sandbox_exec';
  END IF;
END $$;