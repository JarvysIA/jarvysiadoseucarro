-- Retroativo: esta correção já está ativa em produção desde a auditoria de
-- segurança adversarial (achado M1), aplicada originalmente via SQL direto
-- sem migration correspondente. Este arquivo só registra o estado já
-- vigente, não aplica nada novo.
--
-- Achado original: validar_cupom_indicacao(_codigo) usava
-- "codigo_indicacao ILIKE trim(_codigo)" — ILIKE trata "%" e "_" no input
-- como coringa, sem nenhum escape. Além disso, o REVOKE EXECUTE existente
-- (migration 20260708021438) só revogava de PUBLIC, nunca de anon/
-- authenticated explicitamente — como esses roles herdam privilégio de
-- PUBLIC por padrão no Postgres, mas o histórico de GRANTs deste projeto
-- não garantia isso de forma auditável, o achado tratou como
-- potencialmente chamável sem autenticação. Um chamador anônimo mandando
-- "%", "A%", "AB%" etc. conseguia enumerar UUIDs de perfis reais (o id
-- devolvido pela função) sem nenhuma credencial.
--
-- Fix: troca ILIKE por comparação exata (upper() dos dois lados, sem
-- coringa nenhum) e revoga EXECUTE explicitamente de PUBLIC, anon e
-- authenticated, concedendo só a service_role. Confirmado ao vivo antes
-- de aplicar: coringa "%" agora devolve NULL; busca real com código
-- verdadeiro (inclusive em minúsculas, graças ao upper() nos dois lados)
-- continua funcionando; anon/authenticated bloqueados; service_role
-- livre. gerar-pix-asaas (único chamador real) já usa client service_role
-- pra essa RPC, então não dependia dos grants revogados pra nada
-- legítimo.
CREATE OR REPLACE FUNCTION public.validar_cupom_indicacao(_codigo text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id FROM public.profiles
   WHERE upper(codigo_indicacao) = upper(trim(_codigo))
   LIMIT 1
$function$;

REVOKE EXECUTE ON FUNCTION public.validar_cupom_indicacao(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validar_cupom_indicacao(text) TO service_role;
