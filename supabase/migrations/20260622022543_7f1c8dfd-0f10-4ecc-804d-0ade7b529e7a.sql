CREATE OR REPLACE FUNCTION public.solicitar_saque_indicacao(_chave_pix text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid;
  v_chave    text;
  v_minimo   numeric;
  v_disp     numeric;
  v_valor    numeric;
  v_mov_id   uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTORIZADO';
  END IF;

  v_chave := nullif(btrim(coalesce(_chave_pix, '')), '');
  IF v_chave IS NULL THEN
    RAISE EXCEPTION 'CHAVE_PIX_INVALIDA';
  END IF;

  v_minimo := public.get_indicacao_saque_minimo();

  SELECT saldo_disponivel
    INTO v_disp
    FROM public.carteiras_indicacao
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CARTEIRA_NAO_ENCONTRADA';
  END IF;

  IF v_disp < v_minimo THEN
    RAISE EXCEPTION 'SALDO_INSUFICIENTE';
  END IF;

  v_valor := v_disp;

  INSERT INTO public.movimentacoes_indicacao
    (padrinho_id, valor, tipo, status, descricao, referencia)
  VALUES
    (v_user_id, v_valor, 'saque', 'reservado',
     'Solicitação de saque PIX',
     'saque_' || gen_random_uuid()::text)
  RETURNING id INTO v_mov_id;

  UPDATE public.carteiras_indicacao
     SET saldo_disponivel = saldo_disponivel - v_valor,
         saldo_reservado  = saldo_reservado  + v_valor
   WHERE user_id = v_user_id;

  UPDATE public.profiles
     SET pix_recebimento = v_chave
   WHERE id = v_user_id
     AND coalesce(pix_recebimento, '') <> v_chave;

  INSERT INTO public.notificacoes_indicacao
    (user_id, tipo, titulo, mensagem, payload)
  VALUES (
    v_user_id,
    'saque_solicitado',
    'Saque solicitado',
    'Sua solicitação de saque PIX de R$ ' || to_char(v_valor, 'FM999990D00') || ' foi registrada.',
    jsonb_build_object(
      'valor', v_valor,
      'chave_pix', v_chave,
      'movimentacao_id', v_mov_id
    )
  );

  RETURN jsonb_build_object(
    'movimentacao_id', v_mov_id,
    'valor', v_valor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_saque_indicacao(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solicitar_saque_indicacao(text) TO authenticated;