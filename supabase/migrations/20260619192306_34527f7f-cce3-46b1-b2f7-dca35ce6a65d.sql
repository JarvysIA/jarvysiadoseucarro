
REVOKE EXECUTE ON FUNCTION public.registrar_comissao_indicacao(uuid,uuid,uuid,text,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.liberar_comissoes_indicacao() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.criar_carteira_indicacao() FROM PUBLIC, anon, authenticated;
