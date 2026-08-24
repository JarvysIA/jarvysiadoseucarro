# Corrigir autenticação quebrada no preview hospedado

## Diagnóstico confirmado

- O erro afeta login e cadastro antes de qualquer validação específica de usuário.
- Os registros atuais do navegador mostram o erro saindo dos arquivos estáticos hospedados `index-CXKYmSw0.js` e `login-BkBZ-vIm.js`: esse bundle foi gerado sem `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
- O processo local atual possui as variáveis públicas e de servidor. Portanto, reiniciar o servidor local ou trocar senhas não corrige o artefato hospedado que o celular está executando.
- No login, o primeiro `supabase.auth.signInWithPassword` inicializa o cliente e lança o erro.
- No cadastro, o primeiro `supabase.auth.signUp` lança o mesmo erro; o `catch` apenas acrescenta o prefixo “Falha no cadastro”. Nenhuma conta, perfil ou veículo chega a ser gravado nessa tentativa.
- O WebSocket/HMR também falhou no aparelho, mas isso explica apenas por que a tela não recebeu atualizações; não muda o fato de que o bundle hospedado registrado foi compilado sem a configuração pública.

## Implementação

1. **Tornar a injeção das variáveis públicas determinística no build**
   - Ajustar a configuração do Vite para resolver `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` a partir das variáveis públicas já gerenciadas pelo ambiente.
   - Usar apenas URL e chave publicável; nenhum segredo administrativo será exposto.
   - Não editar os arquivos auto-gerados da integração.

2. **Impedir novo bundle silenciosamente quebrado**
   - Adicionar uma validação de configuração no build: se URL ou chave publicável não estiverem disponíveis, o build deve falhar com diagnóstico explícito em vez de produzir JavaScript que quebra somente quando o usuário clica em Entrar/Criar conta.

3. **Gerar um artefato novo do preview**
   - A alteração de configuração forçará a recompilação dos assets, substituindo os hashes registrados no erro por um bundle novo com a configuração pública incorporada.
   - Não alterar usuários, senhas, perfis, RLS, schema ou fluxos de WhatsApp/despesas.

4. **Validar os dois caminhos completos**
   - Confirmar build sem erros e inspecionar o bundle gerado sem registrar valores sensíveis.
   - Testar login com credencial inválida e comprovar que a resposta passa a vir do serviço de autenticação (“credenciais inválidas”), não do guard de ambiente.
   - Testar o início do cadastro até a chamada real de criação e confirmar que o erro de variáveis desapareceu, sem criar dados descartáveis em produção.
   - Verificar que o redirecionamento após autenticação continua apontando para `/app` e que a rota protegida usa `/login`.

## Resultado esperado

Login e cadastro voltam a alcançar o backend no preview hospedado. Se uma credencial específica estiver incorreta, o usuário verá apenas o erro real de autenticação; o erro “Missing Supabase environment variable(s)” não poderá reaparecer em um build válido.
