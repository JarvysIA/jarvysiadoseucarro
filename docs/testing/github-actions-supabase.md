# Jarvys — Ambiente de testes PostgreSQL/Supabase no GitHub Actions

Build: **5.7F2E1A.5-MJ1A-V-ENV-CI**
Workflow: `.github/workflows/jarvys-test-db.yml`
Estado: **IMPLEMENTED_AWAITING_GITHUB_ACTIONS_RUN**

## 1. Propósito

Ambiente PostgreSQL/Supabase **local, isolado e efêmero** que roda no runner
`ubuntu-24.04` do GitHub Actions. Serve como base reutilizável para provar
migrations, constraints, RLS, grants, RPCs `SECURITY DEFINER`, triggers,
filas, locks, concorrência, atomicidade, idempotência e replay do Jarvys —
sem tocar produção.

## 2. Escopo deste build

Somente:

- workflow manual (`workflow_dispatch`);
- Supabase local via CLI fixada;
- seed sintético mínimo (`jarvys_test_meta.local_marker`, `jarvys_test_meta.tx_smoke`);
- guard fail-closed pré + pós-conexão;
- harness `pg.Client` dedicado;
- smoke multi-sessão (2 sessões físicas, PIDs distintos, COMMIT, ROLLBACK,
  zero leaked rows).

## 3. O que ele cobre

- Aplicação de todas as 67 migrations reais desde zero em CI.
- Isolamento transacional entre sessões físicas independentes.
- Prova de que o pipeline pode ser executado com segurança e reprodutibilidade.

## 4. O que ele **não** cobre

Testes que exigem ambiente externo real permanecem manuais:

- Z-API e número oficial do WhatsApp;
- Asaas;
- Placa FIPE;
- provedor de IA;
- OCR externo;
- DNS, SSL, PWA visual;
- iPhone, Android, App Stores.

## 5. Segurança contra produção

- Nenhum `secrets.*`, `vars.*` ou `environment:` no workflow.
- `permissions: contents: read`. `pull_request_target` e `workflow_run` proibidos.
- Sanitização de ambiente aborta o job se qualquer variável produtiva
  conhecida estiver presente (`DATABASE_URL`, `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ZAPI_TOKEN`, `ASAAS_API_KEY`, `OPENAI_API_KEY`, etc.).
- Guard pré-conexão exige `postgresql://postgres:*@{127.0.0.1|localhost|::1}:54322/postgres`
  — sem fallback para `DATABASE_URL`/`SUPABASE_DB_URL`/pooler/remoto.
- Guard pós-conexão exige `current_database=postgres`, `current_user=postgres`,
  endereço loopback/privado e marker `MJ1A_V_ENV_CI_LOCAL_V1`.

## 6. Por que não usa secrets

Nada neste ambiente depende de credenciais externas. Migrations locais rodam
com o superuser efêmero criado pelo `supabase start`; a senha `postgres` só
existe dentro do container do runner descartado ao final. Introduzir secrets
aumentaria a superfície de risco sem ganho técnico.

## 7. Como executar pelo iPhone

1. Abra o app do GitHub → repositório **JarvysIA/jarvysiadoseucarro**.
2. Toque em **Ações**.
3. Selecione **Jarvys Test Database**.
4. Toque em **Executar fluxo de trabalho** (Run workflow).
5. Confirme a branch **main** e inicie.
6. Abra o run em curso e, ao final, leia o **Summary** (Resumo).

Nenhum PAT, token ou senha é solicitado.

## 8. Como interpretar `PASS_ENV_SMOKE`

O smoke terminou com:

- guard pré e pós-conexão aprovados;
- duas sessões físicas com `pg_backend_pid()` distintos;
- isolamento antes do COMMIT confirmado em B;
- visibilidade após COMMIT confirmada em B;
- linha de rollback invisível em B;
- `leaked_rows=0`.

Nesse ponto o ambiente está **funcionalmente ratificado** para o próximo
build (`MJ1A-V`), mas o MJ1A ainda **não** está ratificado end-to-end.

## 9. Como interpretar falha de migration

Se `supabase db reset --local` falhar, o step imprime as últimas ~200
linhas do log com DSN, JWT, keys e senhas redigidos, e falha o job antes
do smoke. **Não corrigir a migration dentro deste workflow.** Abrir build
separado para tratar a migration ofensiva; este workflow permanece intocado.

## 10. Como interpretar falha do guard

- **Preflight REJECT**: `TEST_DATABASE_URL` inválida — não deveria acontecer
  no runner, indicaria mutação indevida do workflow.
- **Postflight REJECT (`marker ausente/divergente`)**: o seed `supabase/seed.sql`
  não foi aplicado — verificar que a etapa `supabase db reset --local` rodou.
- **Postflight REJECT (`inet_server_addr público proibido`)**: alguém alterou
  `TEST_DATABASE_URL` para apontar fora do runner — investigar imediatamente.

## 11. Como interpretar PIDs iguais

`pid_a == pid_b` indica que o harness caiu em Pool ou reaproveitou o socket.
Trate como bug do harness — este build usa `pg.Client` dedicado exatamente
para evitar isso.

## 12. Como interpretar leaked rows

`leaked_rows > 0` significa que UUIDs sintéticos do run permaneceram em
`jarvys_test_meta.tx_smoke` após o cleanup. Como a tabela é exclusiva do
smoke, isso indica falha lógica no cleanup — bloquear novos builds até
inspecionar.

## 13. Como executar novamente

Reexecutar via **Ações → Jarvys Test Database → Executar fluxo de trabalho**.
O ambiente é sempre criado do zero (`supabase start` + `db reset --local`).

## 14. Como remover o workflow

Deletar `.github/workflows/jarvys-test-db.yml`. Opcionalmente também:
- `scripts/test-db/`;
- `supabase/tests/harness/db.ts`;
- `supabase/seed.sql`;
- devDependencies `pg` e `@types/pg` do `package.json`.

Nenhuma migration ou código produtivo depende desses arquivos.

## 15. Sequência posterior

```text
[ENV-CI implementado]  ← este build
       ↓  sincroniza com GitHub e roda o workflow em main
[PASS_ENV_SMOKE]
       ↓  build MJ1A-V (concorrência real do MJ1A)
[PASS_MJ1A_RATIFIED]
       ↓
[MJ2-PLAN]
```

Nenhum passo posterior é iniciado automaticamente.
