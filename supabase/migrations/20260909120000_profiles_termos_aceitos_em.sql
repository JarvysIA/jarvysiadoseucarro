-- LGPD-Tecnico: registra quando o usuário aceitou os Termos de Uso e a
-- Política de Privacidade no cadastro. NULL para contas já existentes
-- (não retroativo) — só novos cadastros passam a preencher.
ALTER TABLE public.profiles
  ADD COLUMN termos_aceitos_em timestamptz NULL;
