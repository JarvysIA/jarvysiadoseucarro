# Recuperar o acesso da conta admin adm.fernando@yahoo.com — via link por e-mail

## Diagnóstico já confirmado

- **O preview está funcionando.** `/` e `/login` renderizam normalmente; o erro antigo de
  variáveis do backend não se reproduz mais (as variáveis estão presentes).
- **A conta existe e está saudável**: e-mail confirmado, sem banimento, senha definida,
  último acesso em 10/07/2026, `is_super_admin = true` no perfil.
- **Único provedor vinculado é e-mail/senha** — não há identidade Google nem Apple.
- **Causa**: uma tentativa de login pela própria tela retornou `400 Invalid login
  credentials`. O fluxo funciona; a senha é que não bate.
- A tela "Esqueci minha senha" já existe e chama a recuperação apontando para
  `/reset-password`, que também já existe. Nenhum código novo é necessário para o fluxo.

## Plano (caminho escolhido: link por e-mail)

1. **Verificar o envio de e-mails de autenticação do projeto**
   Checar se o domínio de e-mail e o envio de mensagens de autenticação estão ativos e se
   o limite horário de envio não está estourado (esse limite devolve erro 429 e faz o
   "Enviar link" parecer que não fez nada). Se estiver baixo, ajustar para um valor
   compatível com o uso real.

2. **Disparar a recuperação para adm.fernando@yahoo.com**
   Enviar o link de redefinição pela tela `/forgot-password` do próprio app, para exercitar
   exatamente o caminho que você usaria.

3. **Confirmar a saída do e-mail**
   Verificar nos registros de envio do backend se a mensagem saiu com sucesso para o
   endereço. Se sair com erro, eu te reporto o motivo exato em vez de deixar você esperando
   na caixa de entrada.

4. **Você define a nova senha**
   Ao clicar no link, você cai em `/reset-password` e escolhe a senha nova.

5. **Verificação final**
   Após você confirmar a troca, faço um login de teste no preview e confirmo três coisas:
   entra na `/app`, o `is_super_admin` é reconhecido e `/master-admin` abre.

## Plano B, se o e-mail não chegar

Yahoo filtra bastante. Se o passo 3 mostrar envio bem-sucedido e nada chegar em ~10
minutos (incluindo spam), eu defino uma senha provisória forte diretamente na conta e te
passo, para você trocar depois de entrar.

## Observações técnicas

- Nenhuma alteração de schema, RLS ou lógica de aplicação é necessária: o defeito não está
  no app.
- Não vou vincular Google/Apple a essa conta durante a recuperação — isso pode gerar conta
  duplicada com o mesmo e-mail.
- Melhoria opcional, para depois: hoje a tela de login mostra a mensagem crua do backend
  em inglês ("Invalid login credentials"). Posso traduzir para algo como "E-mail ou senha
  incorretos" se você quiser.
