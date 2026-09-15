-- Security-Audit-Fixes (achado C3): a policy de UPDATE em veiculos
-- ("Users can update their own vehicles") confere apenas auth.uid() =
-- user_id, sem nenhuma restrição de coluna — RLS controla LINHA, não
-- COLUNA. Isso permitia ao próprio dono, via UPDATE direto na REST API,
-- reescrever colunas privilegiadas da própria linha: destravar o Histórico
-- Premium (history_locked=false) sem pagar os R$49,90, ativar o veículo
-- (status='ativo') sem pagar os R$29,90 e sem respeitar o limite de
-- veículos por plano, fabricar km_ultima_troca_* pra simular manutenção em
-- dia sem nenhuma despesa real por trás, e reescrever claimed_at/user_id/
-- placa/chassi pra confundir o fluxo de resgate (claim) de veículo
-- arquivado.
--
-- Lista de colunas confirmada via varredura de todo o código cliente
-- (Passo 0 desta build) que escreve em public.veiculos:
--
--   Congeladas (sem writer legítimo do lado do cliente, ou com valor de
--   segurança/paywall direto):
--     status, history_locked, claimed_at, user_id, placa, chassi,
--     image_url, fipe_historico (as duas últimas são colunas mortas —
--     nada no app lê ou escreve nelas hoje; foram superadas por foto_url
--     e historico_fipe respectivamente),
--     jarvys_technical_profile, jarvys_technical_profile_confidence,
--     jarvys_technical_profile_source, jarvys_technical_profile_updated_at
--     (escritas hoje só via supabaseAdmin em
--     vehicle-technical-profile.functions.ts — service_role, nunca
--     cliente),
--     marca, modelo, ano, cor, motorizacao, vehicle_signature,
--     codigo_marca, codigo_modelo, cilindradas, ano_modelo,
--     combustivel_fipe, modelo_fipe (confirmado na varredura do Passo 0:
--     nenhum writer client-side pós-criação para estas colunas — só são
--     setadas no INSERT inicial do veículo; congelar no UPDATE fecha o
--     ambiguity flag levantado naquele relatório sem risco identificado de
--     quebrar edição legítima).
--     km_ultima_troca_oleo/filtros/pastilhas/arrefecimento — congeladas
--     EXCETO quando pg_trigger_depth() > 1, i.e. quando a própria escrita
--     vem de DENTRO do trigger trg_atualizar_revisao_veiculo (cascade
--     legítimo de uma despesa de manutenção real inserida pelo usuário).
--     Um UPDATE direto do cliente em veiculos entra neste trigger com
--     profundidade 1 e tem esses valores revertidos ao OLD.
--
--   Deixadas livres (confirmado writer legítimo do lado do cliente, via
--   supabase/context.supabase RLS-subject):
--     km_atual (NewExpenseModal, app.tsx saveKm/handleSaveMaintenance),
--     foto_url (app.tsx geração/regeneração de imagem IA),
--     historico_fipe, fipe_valor, fipe_mes_referencia, fipe_updated_at,
--     codigo_fipe, placafipe_hash (refreshFipeFn, FipeCard.tsx, signup.tsx,
--     AddVehicleModal.tsx — refreshFipeFn já tem seu próprio gate de
--     entitlement por plano antes de escrever).
CREATE OR REPLACE FUNCTION public.proteger_colunas_privilegiadas_veiculo()
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
    -- Estado inicial seguro: um INSERT feito pelo próprio usuário nunca
    -- nasce ativado/destravado/resgatado ou com KMs de manutenção
    -- herdados. proteger_cadastro_veiculo (trigger irmão, mesmo evento)
    -- cuida do limite de veículos por plano; este trigger garante que os
    -- valores de entrada não pulem esse controle.
    NEW.history_locked := true;
    NEW.claimed_at := NULL;
    NEW.km_ultima_troca_oleo := NULL;
    NEW.km_ultima_troca_filtros := NULL;
    NEW.km_ultima_troca_pastilhas := NULL;
    NEW.km_ultima_troca_arrefecimento := NULL;
    NEW.image_url := NULL;
    NEW.fipe_historico := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: congela colunas privilegiadas no valor anterior.
  NEW.status := OLD.status;
  NEW.history_locked := OLD.history_locked;
  NEW.claimed_at := OLD.claimed_at;
  NEW.user_id := OLD.user_id;
  NEW.placa := OLD.placa;
  NEW.chassi := OLD.chassi;
  NEW.image_url := OLD.image_url;
  NEW.fipe_historico := OLD.fipe_historico;
  NEW.jarvys_technical_profile := OLD.jarvys_technical_profile;
  NEW.jarvys_technical_profile_confidence := OLD.jarvys_technical_profile_confidence;
  NEW.jarvys_technical_profile_source := OLD.jarvys_technical_profile_source;
  NEW.jarvys_technical_profile_updated_at := OLD.jarvys_technical_profile_updated_at;
  NEW.marca := OLD.marca;
  NEW.modelo := OLD.modelo;
  NEW.ano := OLD.ano;
  NEW.cor := OLD.cor;
  NEW.motorizacao := OLD.motorizacao;
  NEW.vehicle_signature := OLD.vehicle_signature;
  NEW.codigo_marca := OLD.codigo_marca;
  NEW.codigo_modelo := OLD.codigo_modelo;
  NEW.cilindradas := OLD.cilindradas;
  NEW.ano_modelo := OLD.ano_modelo;
  NEW.combustivel_fipe := OLD.combustivel_fipe;
  NEW.modelo_fipe := OLD.modelo_fipe;

  -- km_ultima_troca_*: só o cascade de trg_atualizar_revisao_veiculo
  -- (rodando aninhado DENTRO deste mesmo UPDATE em veiculos —
  -- pg_trigger_depth() > 1 no momento em que ESTE trigger executa) pode
  -- alterá-las. Um UPDATE direto do cliente entra aqui com profundidade 1
  -- e tem esses valores revertidos ao OLD.
  IF pg_trigger_depth() <= 1 THEN
    NEW.km_ultima_troca_oleo := OLD.km_ultima_troca_oleo;
    NEW.km_ultima_troca_filtros := OLD.km_ultima_troca_filtros;
    NEW.km_ultima_troca_pastilhas := OLD.km_ultima_troca_pastilhas;
    NEW.km_ultima_troca_arrefecimento := OLD.km_ultima_troca_arrefecimento;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.proteger_colunas_privilegiadas_veiculo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_proteger_colunas_privilegiadas_veiculo ON public.veiculos;
CREATE TRIGGER trg_proteger_colunas_privilegiadas_veiculo
BEFORE INSERT OR UPDATE ON public.veiculos
FOR EACH ROW
EXECUTE FUNCTION public.proteger_colunas_privilegiadas_veiculo();
