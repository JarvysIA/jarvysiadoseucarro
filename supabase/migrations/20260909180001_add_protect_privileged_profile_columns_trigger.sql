-- Retroativo: esta correção já está ativa em produção desde o fix do scan
-- de segurança do Lovable (item 2 do checklist), aplicada originalmente via
-- SQL direto sem migration correspondente. Este arquivo só registra o
-- estado já vigente, não aplica nada novo.
--
-- Achado original: RLS controla LINHA (auth.uid() = id), não COLUNA — a
-- policy de UPDATE em profiles permitia a qualquer usuário autenticado
-- alterar is_super_admin/status_usuario/permite_indicacao/codigo_indicacao/
-- referrer_id na própria linha, escalando privilégio. Confirmado explorável
-- ao vivo antes do fix.
CREATE OR REPLACE FUNCTION public.protect_privileged_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  NEW.is_super_admin := OLD.is_super_admin;
  NEW.status_usuario := OLD.status_usuario;
  NEW.permite_indicacao := OLD.permite_indicacao;
  NEW.codigo_indicacao := OLD.codigo_indicacao;
  NEW.referrer_id := OLD.referrer_id;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.protect_privileged_profile_columns() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_protect_privileged_profile_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_privileged_profile_columns();
