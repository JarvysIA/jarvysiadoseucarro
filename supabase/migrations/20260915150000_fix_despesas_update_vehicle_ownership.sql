-- Retroativo: esta correção já está ativa em produção desde a auditoria de
-- segurança adversarial (achado A3), aplicada originalmente via SQL direto
-- sem migration correspondente. Este arquivo só registra o estado já
-- vigente, não aplica nada novo.
--
-- Achado original: a policy de UPDATE em despesas ("Users update own
-- despesas") conferia apenas auth.uid() = user_id, sem checar se o
-- vehicle_id continuava pertencendo ao mesmo usuário depois do UPDATE —
-- permitia a um usuário editar a própria despesa mudando vehicle_id pra
-- apontar pro veículo de OUTRO usuário, "movendo" a despesa pro histórico
-- da vítima. Isso ainda dispara atualizar_revisao_veiculo (trigger AFTER
-- INSERT OR UPDATE OF km_registro em despesas), que reescreve
-- km_ultima_troca_* do veículo alvo sem checar posse — corrompendo os
-- dados de manutenção da vítima. Mesma classe de bug já corrigida no
-- INSERT desta mesma tabela (item 1 do checklist original de RLS, ver
-- 20260909180000_fix_despesas_insert_vehicle_ownership.sql).
--
-- Confirmado ao vivo nos 3 cenários antes de aplicar: (1) ataque
-- bloqueado — UPDATE mudando vehicle_id pro veículo de outro usuário
-- rejeitado pela policy; (2) mover a despesa entre dois veículos do
-- PRÓPRIO usuário continua funcionando normalmente; (3) editar qualquer
-- outro campo sem tocar vehicle_id continua funcionando normalmente.
ALTER POLICY "Users update own despesas" ON public.despesas
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM veiculos v WHERE v.id = despesas.vehicle_id AND v.user_id = auth.uid())
);
