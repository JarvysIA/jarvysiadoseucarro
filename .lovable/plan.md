# Recuperar o acesso da conta admin adm.fernando@yahoo.com

## O que eu já verifiquei (agora, no ambiente real)

- **O preview está funcionando.** Abri `/` e `/login` no navegador: as duas páginas
  renderizam normalmente, sem erro de JavaScript. O erro de "variáveis do backend
  ausentes" que apareceu era antigo — as variáveis foram recarregadas e estão presentes.
- **A conta existe e está saudável**: e-mail confirmado, sem banimento, sem exclusão,
  com senha definida, último acesso em 10/07/2026. O perfil tem `is_super_admin = true`,
  então o Painel Master continua liberado assim que você entrar.
- **O único provedor vinculado é e-mail/senha.** Não existe identidade Google nem Apple
  ligada a essa conta.
- **A causa está confirmada**: enviei uma tentativa de login pela própria tela e o backend
  respondeu `400 Invalid login credentials`. Ou seja, o fluxo funciona — o que não bate é
  a senha. Se você estiver clicando em "Continuar com Google/Apple", o segundo motivo
  possível é a conta não ter essa identidade vinculada.

## Plano

1. **Redefinição de senha por e-mail (caminho padrão, sem tocar em código)**
   Usar a tela "Esqueci minha senha" que já existe no app. Ela envia o link para
   adm.fernando@yahoo.com e leva para `/reset-password`, onde você define a nova senha.
   Antes disso, confirmo que o envio de e-mail de recuperação está ativo no backend.

2. **Se o e-mail não chegar (Yahoo costuma filtrar)**
   Defino uma senha nova diretamente na conta admin, via operação administrativa no
   backend, e você troca depois de entrar. Preciso apenas que você me diga a senha
   desejada (ou eu gero uma provisória forte e te passo).

3. **Verificação final**
   Faço o login de teste no preview com a nova senha e confirmo três coisas: entra na
   `/app`, o `is_super_admin` é reconhecido e a rota `/master-admin` abre.

## Observações técnicas

- Nenhuma alteração de schema, RLS ou código de aplicação é necessária: o defeito não
  está no app.
- Vincular Google a essa conta não é o caminho recomendado agora — o Supabase só liga a
  identidade social automaticamente em condições específicas, e mexer nisso durante a
  recuperação pode gerar conta duplicada com o mesmo e-mail.
- Se quiser, depois da recuperação eu incluo um aviso mais claro na tela de login para
  "Invalid login credentials" (hoje a mensagem crua do backend aparece em inglês).

## Decisão que preciso de você

Prefere o **caminho 1** (link por e-mail) ou o **caminho 2** (eu já defino uma senha
provisória)? Se não responder, sigo pelo caminho 1 e, se o e-mail não chegar, passo ao 2.
