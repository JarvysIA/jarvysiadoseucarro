CREATE OR REPLACE TRIGGER trg_atualizar_revisao_veiculo
  AFTER INSERT OR UPDATE OF km_registro ON public.despesas
  FOR EACH ROW EXECUTE FUNCTION atualizar_revisao_veiculo();