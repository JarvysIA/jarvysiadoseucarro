-- Fix-Profile-Additional-Columns (achados A2 e M7 da auditoria adversarial):
-- protect_privileged_profile_columns já congelava is_super_admin/
-- status_usuario/permite_indicacao/codigo_indicacao/referrer_id, mas não
-- cobria trial_inicio nem asaas_customer_id.
--
-- A2: trialActive() trata trial_inicio IS NULL como "trial sempre ativo"
-- (plan-capabilities.ts:99). Um usuário podia fazer PATCH direto setando
-- trial_inicio=null depois de expirado pra resetar o acesso
-- indefinidamente — a policy de UPDATE em profiles só confere
-- auth.uid()=id, sem restrição de coluna.
--
-- M7: asaas_customer_id é gravável pelo client hoje (sem nenhum trigger
-- protegendo); um usuário poderia setar o id de outro cliente Asaas,
-- fazendo cobranças saírem sob o registro alheio.
--
-- Investigação (Passo 0 desta build) confirmou:
--   - trial_inicio: único writer client-side é ensureTrialStartedFn
--     (trial.functions.ts), que grava NULL -> timestamp condicionado a
--     `IS NULL` na própria query — write de mão única. Congelar sempre
--     quebraria esse fluxo; a regra certa é congelar só depois de já
--     estar setado (OLD IS NOT NULL). Enquanto NULL, deixar passar não é
--     risco: NULL já é o estado de acesso mais aberto que existe.
--   - asaas_customer_id: nenhum writer client-side existe — só
--     gerar-pix-asaas/index.ts, via service_role. Congelar sempre é
--     seguro.
--   - cpf: tem writers client-side legítimos e sem trava de
--     imutabilidade (ProfileSettingsModal, CpfRequiredModal) — NÃO foi
--     incluído nesta migration.
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
    NEW.asaas_customer_id := NULL;
    NEW.trial_inicio := NULL;
    RETURN NEW;
  END IF;

  NEW.is_super_admin := OLD.is_super_admin;
  NEW.status_usuario := OLD.status_usuario;
  NEW.permite_indicacao := OLD.permite_indicacao;
  NEW.codigo_indicacao := OLD.codigo_indicacao;
  NEW.referrer_id := OLD.referrer_id;
  NEW.asaas_customer_id := OLD.asaas_customer_id;

  -- trial_inicio: congela só depois de setado uma vez. Enquanto NULL,
  -- deixa passar o valor que o client mandou — é a única escrita
  -- legítima real (ensureTrialStartedFn, condicionada a IS NULL na
  -- própria query) e não representa risco: NULL já é o estado de acesso
  -- mais aberto possível (trialActive() trata NULL como "sempre ativo"),
  -- então nada incentiva um usuário malicioso a mexer nisso enquanto
  -- ainda é NULL.
  IF OLD.trial_inicio IS NOT NULL THEN
    NEW.trial_inicio := OLD.trial_inicio;
  END IF;

  RETURN NEW;
END;
$function$;
