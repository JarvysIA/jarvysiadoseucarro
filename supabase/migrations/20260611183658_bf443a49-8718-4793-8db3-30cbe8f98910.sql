
-- Extensão para remover acentos
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Coluna codigo_indicacao
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS codigo_indicacao text;

-- Índice único case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS profiles_codigo_indicacao_unique
  ON public.profiles (lower(codigo_indicacao));

-- Função geradora: [PRIMEIRO_NOME_SEM_ACENTOS_UPPER]-JARVYS-[4 dígitos]
CREATE OR REPLACE FUNCTION public.gerar_codigo_indicacao(_nome text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  primeiro_nome text;
  candidato text;
  tentativa int := 0;
BEGIN
  -- Primeiro nome, sem acentos, somente A-Z, em MAIÚSCULAS
  primeiro_nome := upper(regexp_replace(unaccent(coalesce(split_part(trim(_nome), ' ', 1), '')), '[^A-Za-z]', '', 'g'));
  IF primeiro_nome = '' OR primeiro_nome IS NULL THEN
    primeiro_nome := 'AMIGO';
  END IF;

  LOOP
    candidato := primeiro_nome || '-JARVYS-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    PERFORM 1 FROM public.profiles WHERE lower(codigo_indicacao) = lower(candidato);
    IF NOT FOUND THEN
      RETURN candidato;
    END IF;
    tentativa := tentativa + 1;
    -- Após 50 colisões (improvável), adiciona sufixo extra para garantir saída
    IF tentativa > 50 THEN
      RETURN candidato || '-' || substr(md5(random()::text), 1, 3);
    END IF;
  END LOOP;
END;
$$;

-- Trigger BEFORE INSERT/UPDATE para preencher se vier nulo
CREATE OR REPLACE FUNCTION public.set_codigo_indicacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.codigo_indicacao IS NULL OR NEW.codigo_indicacao = '' THEN
    NEW.codigo_indicacao := public.gerar_codigo_indicacao(NEW.nome);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_codigo_indicacao ON public.profiles;
CREATE TRIGGER trg_set_codigo_indicacao
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_codigo_indicacao();

-- Backfill para usuários existentes
UPDATE public.profiles
SET codigo_indicacao = public.gerar_codigo_indicacao(nome)
WHERE codigo_indicacao IS NULL OR codigo_indicacao = '';
