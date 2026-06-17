## Visão geral

Vou preservar 100% do visual atual (Landing, Splash, Signup, Garagem, Bottom Nav). Toda a evolução é em **lógica + novas telas**, sem mexer no design existente.

Antes de codar preciso confirmar 2 pontos e habilitar o backend.

## Pré-requisitos

1. **Habilitar Lovable Cloud** (banco + auth + storage). Sem isso não há onde salvar `profiles`, `veiculos` nem autenticar.
2. **API de placa**: a BrasilAPI **não** consulta placa de veículo (só FIPE por código). A "Puxa Placa" é paga e exige token. Como ainda não temos credencial, vou implementar a etapa como **loading tecnológico simulado** (2s) que cai direto no fallback manual dentro do modal — assim o fluxo funciona hoje e plugamos a API real depois trocando 1 função.
3. **Admin secreto**: `/master-admin` precisa de proteção. Vou usar tabela `user_roles` + role `admin` (padrão seguro Supabase). Eu te explico como te tornar admin via SQL após o primeiro cadastro.

## Modelagem do banco

**profiles** (1-1 com auth.users)
- id (uuid, PK = auth.users.id)
- nome (text)
- whatsapp (text)
- placa (text)
- status_usuario (text, default 'trial') — 'trial' | 'ativo'
- permite_indicacao (boolean, default false)
- trial_inicio (timestamptz, default now())
- created_at

**veiculos**
- id, user_id (FK profiles), placa, marca, modelo, ano, motorizacao, km_atual (nullable), created_at

**user_roles** (separada, com enum `app_role`) + função `has_role()` security-definer.

RLS: usuário lê/edita só os próprios dados. Admins (via `has_role`) leem/atualizam tudo em `profiles`.

## Passo a passo de implementação

**1. Splash inteligente** — `src/routes/splash.tsx` passa a checar `supabase.auth.getSession()`. Logado → `/app`. Não logado → `/welcome`. (Hoje usa `localStorage`.)

**2. Signup conectado ao Supabase** — `src/routes/signup.tsx` mantém UI idêntica. Submit:
   - `supabase.auth.signUp({ email gerado a partir do whatsapp OU pedir email? veja questão abaixo, password })`
   - Insere em `profiles` (`status_usuario='trial'`, `permite_indicacao=false`)
   - Dispara loading "Lendo placa..." (2s simulados)
   - Abre **CarConfirmModal**

**3. CarConfirmModal** (novo, `src/components/CarConfirmModal.tsx`)
   - Mostra Marca/Modelo/Ano/Motorização (placeholder vazio no fluxo simulado → cai direto no fallback)
   - Botão "Dados incorretos? Preencher manualmente" → abre inputs
   - Campo "KM Atual do Painel (opcional)"
   - "Confirmar e Ir para a Garagem" → insert em `veiculos`, fecha modal, navega para `/app`
   - Estética: fundo grafite, borda neon, mesmo padrão da Splash/Landing

**4. Renomear `/garagem` → `/app`** — mantém todo o layout/carrossel atual. Atualizo `BottomNav`, redirects e o link da Landing.
   - Topo do `/app` lê `profiles.status_usuario`:
     - `trial` → banner "Você tem 30 dias de acesso total grátis"
     - `ativo` → sem banner
   - Aba/seção de Indicações:
     - `trial` → cadeado + CTA "Ative por R$ 9,90"
     - `ativo` → link de afiliado liberado para copiar

**5. `/master-admin`** (oculto, não linkado em nenhum lugar)
   - Protegido por `has_role(uid, 'admin')` — se não for admin, redireciona pra `/`
   - Campo busca por nome/whatsapp
   - Lista profiles com botão "Tornar VIP" → update `status_usuario='ativo'`, `permite_indicacao=true`

## Decisões que preciso confirmar com você

**Q1 — Login:** o Supabase Auth exige **email + senha** (ou OAuth/telefone com SMS pago). Seu form atual tem WhatsApp + Senha, sem email. Como prefere?
- **(a)** Adicionar campo Email no cadastro (mais simples, recomendado)
- **(b)** Gerar email fake interno tipo `5511999999999@jarvys.app` a partir do WhatsApp (login fica "transparente" pro usuário, mas não dá pra recuperar senha por email)
- **(c)** Habilitar login por telefone com SMS (custa por mensagem, precisa configurar provider tipo Twilio)

**Q2 — API de placa:** confirma que tudo bem começarmos com o **loading simulado + fallback manual** (e plugamos a API real depois)? Ou você já tem token de algum serviço (Puxa Placa, Placa Fipe, API Brasil, etc.) pra eu integrar agora?

Me responde essas 2 e eu sigo com a implementação completa.
