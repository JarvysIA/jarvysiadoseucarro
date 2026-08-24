# Corrigir login no navegador externo (preview--jarvysiadoseucarro.lovable.app)

## Situação confirmada

- Dentro do preview interno o login já funciona (o bundle local recebe a configuração pública do backend pelo ambiente do sandbox).
- O endereço externo `preview--jarvysiadoseucarro.lovable.app` não serve o app do sandbox: ele serve um artefato compilado pela esteira de build da plataforma (a resposta é um 302 para a ponte de autenticação da Lovable e depois assets estáticos).
- Hoje a configuração pública (URL do backend + chave publicável) só entra no bundle se as variáveis existirem no ambiente do build. No sandbox elas existem (arquivo de ambiente local, gerado automaticamente). Não há garantia de que esse mesmo arquivo exista na máquina que gera o artefato do endereço externo — e é exatamente lá que o erro "Missing Supabase environment variable(s)" continua aparecendo.
- Agravante atual: quando essas variáveis faltam no build, a configuração adicionada no passo anterior derruba o build de propósito. Resultado prático: o endereço externo continua servindo o artefato antigo e quebrado, em vez de um novo.

## Implementação

1. **Fixar a configuração pública no código-fonte**
   - Criar um módulo pequeno e versionado com a URL do backend e a chave publicável (ambas são valores públicos, projetados para ficar no cliente — nenhum segredo administrativo entra aqui).
   - Nenhum arquivo auto-gerado da integração será tocado.

2. **Usar esse módulo como fonte de verdade no build**
   - Em `vite.config.ts`, a injeção de `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` passa a ser: variável de ambiente quando existir, senão o valor versionado.
   - Assim, qualquer build — sandbox, preview externo ou publicação — sempre produz um bundle com configuração válida.

3. **Trocar a quebra de build por checagem que não deixa passar bundle vazio**
   - Remover o `throw` que hoje aborta o build quando o ambiente está incompleto (ele impede justamente a geração do artefato novo).
   - Manter uma validação de que o valor final injetado não é vazio, agora com fallback garantido, de modo que o cenário de bundle sem configuração deixe de ser possível.

4. **Validar nos dois caminhos**
   - Confirmar build sem erros e conferir que o valor injetado não é vazio, sem imprimir a chave.
   - Testar `/login` e `/signup` localmente e comprovar que a resposta vem do serviço de autenticação (credencial inválida), não do guard de ambiente.
   - Depois do novo artefato ficar disponível, testar o endereço externo com refresh forçado.

## Fora de escopo

Nada de usuários, senhas, RLS, schema, WhatsApp, despesas ou fluxo de manutenção será alterado.

## Resultado esperado

O login no navegador externo passa a alcançar o backend, e o erro "Missing Supabase environment variable(s)" não pode mais reaparecer em nenhum build.
