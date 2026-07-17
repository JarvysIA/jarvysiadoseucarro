BEGIN;

ALTER TABLE public.whatsapp_conversation_states
  DROP CONSTRAINT wcs_state_valid;

ALTER TABLE public.whatsapp_conversation_states
  ADD CONSTRAINT wcs_state_valid
  CHECK (state = ANY (ARRAY[
    'idle'::text,
    'identifying_intent'::text,
    'awaiting_vehicle'::text,
    'awaiting_expense_confirmation'::text,
    'awaiting_expense_correction'::text,
    'awaiting_expense_category'::text,
    'awaiting_requested_km'::text,
    'awaiting_km_confirmation'::text,
    'awaiting_km_correction'::text,
    'awaiting_media_classification'::text,
    'awaiting_ocr_confirmation'::text,
    'awaiting_maintenance_confirmation'::text,
    'processing'::text,
    'completed'::text,
    'cancelled'::text,
    'failed'::text,
    'expired'::text
  ]));

COMMIT;