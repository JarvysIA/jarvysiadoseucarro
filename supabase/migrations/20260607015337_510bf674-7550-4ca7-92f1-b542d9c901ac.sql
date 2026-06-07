
-- 1) Despesas: incluir "Acessórios" na lista de categorias permitidas
ALTER TABLE public.despesas DROP CONSTRAINT IF EXISTS despesas_categoria_check;
ALTER TABLE public.despesas
  ADD CONSTRAINT despesas_categoria_check
  CHECK (categoria = ANY (ARRAY[
    'Revisão','Manutenção','Lavagem','Combustível',
    'IPVA','Multas','Seguro','Acessórios'
  ]));

-- 2) fipe_history: reforçar grants (idempotente). Tabela e políticas já existem.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fipe_history TO authenticated;
GRANT ALL ON public.fipe_history TO service_role;
