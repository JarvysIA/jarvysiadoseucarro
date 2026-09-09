-- Guided-Tour: registra, por tourKey, se o usuário já viu o balão guiado
-- daquela tela (ex: {"app": true, "despesas": true}). Novas contas e
-- contas já existentes começam com objeto vazio — todos os tours aparecem
-- na primeira visita a cada tela.
ALTER TABLE public.profiles
  ADD COLUMN tours_vistos jsonb NOT NULL DEFAULT '{}'::jsonb;
