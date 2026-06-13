ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_status_usuario_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_status_usuario_check
CHECK (LOWER(status_usuario) IN ('trial', 'ativo', 'vip', 'enterprise'));
