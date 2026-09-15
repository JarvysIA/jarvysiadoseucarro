-- Security-Audit-Fixes (achado C4): a policy de SELECT em despesas
-- ("Users select despesas of owned vehicle") confere apenas ownership do
-- veículo (EXISTS ... v.user_id = auth.uid()), sem nenhuma referência a
-- claimed_at.
--
-- Fluxo do problema: softDeleteVehicleFn arquiva um veículo mantendo
-- user_id=null e as despesas antigas no mesmo vehicle_id.
-- claimArchivedVehicleFn transfere esse MESMO vehicle_id pra quem
-- "resgata" a placa depois, setando claimed_at=now(). O filtro "só mostra
-- despesas depois do claim" hoje existe SÓ no código da aplicação
-- (getRevendaHistoryFn no server, e também em app.tsx/despesas.tsx no
-- client, comparando created_at >= claimed_at) — nunca em RLS. Uma
-- chamada direta à REST API (ex: GET .../despesas?vehicle_id=eq.X)
-- devolve o histórico completo do dono anterior pro novo dono, incluindo
-- os campos já removidos do client (descrição, valor, oficina, km) que o
-- Histórico Premium R$49,90 deveria vender.
--
-- claimed_at é NULL pro dono original (nunca resgatou o veículo de
-- ninguém) — a policy corrigida mantém o histórico completo visível nesse
-- caso, e só filtra por data quando claimed_at está de fato setado.
ALTER POLICY "Users select despesas of owned vehicle" ON public.despesas
USING (
  EXISTS (
    SELECT 1 FROM public.veiculos v
    WHERE v.id = despesas.vehicle_id
      AND v.user_id = auth.uid()
      AND (v.claimed_at IS NULL OR despesas.created_at >= v.claimed_at)
  )
);
