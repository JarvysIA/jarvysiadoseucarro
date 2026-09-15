-- Retroativo: esta correção já está ativa em produção desde a auditoria de
-- segurança adversarial (achado C2), aplicada originalmente via SQL direto
-- sem migration correspondente. Este arquivo corrige a migration anterior
-- (20260909180001), que só documentava a versão BEFORE UPDATE da função —
-- a versão realmente vigente em produção também roda BEFORE INSERT, texto
-- capturado ao vivo do banco (pg_get_functiondef) para este arquivo.
--
-- Achado original: o trigger BEFORE UPDATE em profiles bloqueava
-- auto-promoção via UPDATE, mas nada rodava em INSERT — nenhum trigger em
-- auth.users pré-cria a linha de profiles, então a própria aplicação insere
-- a linha inicial. Um INSERT direto com is_super_admin=true (ou
-- status_usuario='vip', etc.) escalava privilégio no exato momento do
-- cadastro, sem nunca passar por um UPDATE. Confirmado explorável ao vivo
-- antes do fix.
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

  IF TG_OP = 'INSERT' THEN
    NEW.is_super_admin := false;
    NEW.status_usuario := 'trial';
    NEW.permite_indicacao := false;
    NEW.codigo_indicacao := NULL;
    NEW.referrer_id := NULL;
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

DROP TRIGGER IF EXISTS trg_protect_privileged_profile_columns ON public.profiles;
CREATE TRIGGER trg_protect_privileged_profile_columns
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_privileged_profile_columns();
