## Build 5.6C-PLAN — Cron seguro do sender outbound WhatsApp (read-only)

### A. Resumo executivo
Fila outbound está limpa e segura para automação. Sender está hardened e validado manualmente. Falta apenas espelhar `WHATSAPP_SENDER_SECRET` no Vault e criar o `pg_cron` — ambos ficam para o EXEC. Este plano define a sequência segura.

### B. Estado atual da `whatsapp_outbound_queue`
Total: 2 registros.
- 1 `sent` — smoke real do 5.6B (`185f2aed…`, phone `****0805`, attempts=1, `provider_message_id` presente, `sent_at` OK, body 58 chars).
- 1 `cancelled` — onboarding antigo (`0d7aabfc…`, `error_message=pre_sender_cleanup`).
- `queued`: 0. `sending`: 0. `failed`: 0.
- Nenhum item preso, nenhum `scheduled_at<=now()` pendente.

**Conclusão: fila segura. Liberada para automação.**

### C. Confirmação de fila segura
✅ Sem `queued` não autorizado. ✅ Sem item preso em `sending`. ✅ Smoke real foi `sent` com sucesso.

### D. Auditoria do sender (`whatsapp-send-outbound`)
Confere com o requisito: exige `x-sender-secret` (constant-time `safeEqual`), lê env vars do Deno, valida `ZAPI_*`, `batch_size` clamp 1–5, claim otimista `queued→sending` com increment de `attempts`, valida provider/instance/telefone E.164/text_body/opt_out/daily_limit, chama `sendZapiText` com timeout 8s, aplica backoff 1/5/15/60min, timeout ambíguo vira `failed` (manual review), sem log de credenciais/telefone completo/body. **Nenhuma alteração necessária.**

### E. Estado de `WHATSAPP_SENDER_SECRET`
- Existe como Edge Function Secret (usado pelo sender).
- **Ausente no Vault** (Vault atual: `FIPE_CRON_SECRET`, `PAYMENT_CRON_SECRET`, `WHATSAPP_WORKER_SECRET`).
- Precisa ser espelhado para o cron consumir via `vault.decrypted_secrets`.

### F. Estratégia de bootstrap no Vault
Reutilizar o padrão dos Builds 5.5C / 8.6C:
1. Criar Edge Function temporária `whatsapp-bootstrap-sender-secret`.
2. Protegida por token único `WA_SENDER_BOOT_TOKEN` (secret novo, exclusivo, diferente de todos os outros).
3. Handler lê `Deno.env.get("WHATSAPP_SENDER_SECRET")` e chama `public.upsert_vault_secret('WHATSAPP_SENDER_SECRET', value)`.
4. Nunca retorna nem loga o valor.
5. Executada uma única vez.
6. Neutralizar com 410 Gone imediatamente após confirmação.
7. Deletar `WA_SENDER_BOOT_TOKEN` após bootstrap.

### G. Estratégia do `pg_cron`
```
jobname: whatsapp_send_outbound_every_minute
schedule: * * * * *
comando: net.http_post(
  url := 'https://thbbyjyefozrznocihso.supabase.co/functions/v1/whatsapp-send-outbound?batch_size=5',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'Authorization','Bearer <anon>',
    'x-sender-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='WHATSAPP_SENDER_SECRET')
  ),
  body := '{}'::jsonb
)
```
Regras: nenhum secret/token literal, apenas endpoint público, criação idempotente (`SELECT cron.unschedule('whatsapp_send_outbound_every_minute')` antes se existir).

### H. Cron nasce ativo — mitigação
`pg_cron` no ambiente cria jobs sempre ativos (confirmado: jobs `3`,`4`,`5` todos `active=true`). Não há como criar inativo diretamente. Mitigação:
1. Confirmar `queued=0` imediatamente antes de criar.
2. Criar cron.
3. Em seguida inserir 1 outbound controlado (smoke).
4. Se o smoke falhar → `cron.unschedule('whatsapp_send_outbound_every_minute')` imediatamente.

### I. Sequência segura do smoke automático (EXEC futuro)
1. Auditar fila (deve estar sem `queued`).
2. Bootstrap Vault + neutralizar função temporária + deletar `WA_SENDER_BOOT_TOKEN`.
3. Criar cron idempotente.
4. Inserir 1 outbound para o telefone do operador: “Olá! O envio automático do WhatsApp Jarvys foi ativado com sucesso.”
5. Aguardar até 2 min.
6. Validar: `queued→sending→sent`, `attempts=1`, `sent_at` e `provider_message_id` preenchidos, aparelho recebeu exatamente 1 mensagem, execução seguinte `claimed=0`.
7. Manter cron ativo somente se smoke passar.

### J. Rate limit e limites operacionais
- Teto teórico: 5 msg/min × 60 = 300/h; `daily_message_limit=1000` na instância.
- Sender já reagenda para o próximo dia UTC quando atinge limite.
- Envio bloqueado se `status!='active'` ou `health_status='failed'` ou `contact.opt_out=true`.
- Onboarding a não-vinculados: manter apenas quando gerado pelo worker inbound em resposta a evento real recente (já é o comportamento). Purpose/type na fila fica para build futuro.

### K. Item preso em `sending`
Nenhum atualmente. Reaper fica para build futuro:
- `sending` >10min com `provider_message_id` → marcar para revisão, nunca reenviar.
- Sem `provider_message_id` → tratar como timeout ambíguo, sem reenvio automático no MVP.

### L. Idempotência e timeout ambíguo
Sender já garante: `sent` nunca reenviado; timeout ambíguo vira `failed`; retries só para erros `retryable`; cron ignora `failed/cancelled/sent`. Teste do EXEC: fila vazia → cron rodando → 0 envios; inserir 1 → 1 envio; próxima execução → `claimed=0`.

### M. Funções temporárias
`whatsapp-send-outbound-trigger` está neutralizada (410 Gone). Não será usada pelo cron. Recomenda-se remoção definitiva após publicação. Bootstrap do Vault será função separada, dedicada e neutralizada logo após uso.

### N. Logs e segurança
Sender atual não expõe secret/token/telefone completo/body/URL Z-API. Logs do cron devem conter apenas `jobname`, `request_id` do `pg_net` e `succeeded/failed` — sem headers, sem secret.

### O. Testes do build futuro
1. Vault contém `WHATSAPP_SENDER_SECRET` (nome apenas).
2. `cron.job` tem 1 único job novo, schedule `* * * * *`, comando referencia `vault.decrypted_secrets`, sem literais.
3. Fila vazia → cron não envia.
4. Smoke: 1 outbound → recebido 1×, `sent`, `attempts=1`, `provider_message_id` presente.
5. Execução seguinte: `claimed=0`.
6. Opt-out: item vira `cancelled` sem chamar Z-API.
7. Falha permanente (telefone inválido / instância inativa): `failed/cancelled`, sem chamada Z-API.
8. Logs sem credenciais.
9. Fora de escopo: sem OCR, IA, mídia, despesa, KM, UI, RLS, capabilities, FIPE, pagamentos.

### P. Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Cron nasce ativo | Fila vazia antes; unschedule se smoke falhar |
| Envio duplicado | Claim atômico + `sent` imutável |
| Timeout ambíguo | Já mapeado para `failed` manual review |
| Secret ausente/divergente no Vault | Bootstrap dedicado + validação pós-espelhamento |
| Cron 401 | Testar endpoint com curl antes do smoke |
| Cron duplicado | `unschedule` antes de `schedule` |
| Instância caiu | `status/health_status` gates no sender |
| Item sem consentimento | `opt_out` gate |
| Onboarding indesejado | Manter regra do worker inbound (24h anti-spam) |
| Item preso em `sending` | Reaper futuro; monitoramento manual no MVP |
| Rate limit / ban | `daily_message_limit=1000`, batch=5/min |
| Log com credenciais | Sender já sanitiza; cron não loga headers |
| Bootstrap temporário exposto | Token único + neutralização + delete pós-uso |
| `WA_SENDER_BOOT_TOKEN` esquecido | Passo obrigatório de delete no EXEC |

### Q. Próximo build recomendado
**Build 5.6C-EXEC — Cron seguro do sender outbound**
- Confirmar fila vazia.
- Bootstrap `WHATSAPP_SENDER_SECRET` no Vault + neutralizar função + deletar `WA_SENDER_BOOT_TOKEN`.
- Criar `pg_cron` idempotente.
- Smoke controlado (1 mensagem).
- Validar não duplicidade.
- Manter cron somente se smoke passar.
- Sem OCR, IA, mídia.

---

Build 5.6C-PLAN executado em modo read-only. Plano do cron seguro do sender outbound concluído sem criar cron, sem enviar mensagens e sem alterar código.
