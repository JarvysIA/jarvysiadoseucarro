UPDATE public.veiculos SET status = 'ativo' WHERE status = 'active';
ALTER TABLE public.veiculos ALTER COLUMN status SET DEFAULT 'ativo';