-- Retroativo: esta correção já está ativa em produção desde a auditoria de
-- RLS (item 1 do checklist de segurança), aplicada originalmente via SQL
-- direto sem migration correspondente. Este arquivo só registra o estado
-- já vigente, não aplica nada novo.
--
-- Achado original: a policy de INSERT em despesas conferia apenas
-- auth.uid() = user_id, sem checar se o vehicle_id pertencia a esse mesmo
-- usuário — permitia a um usuário inserir uma despesa fabricada apontando
-- para o veículo de outro usuário (injeção cruzada).
ALTER POLICY "Users insert own despesas" ON public.despesas
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM veiculos v WHERE v.id = despesas.vehicle_id AND v.user_id = auth.uid())
);
