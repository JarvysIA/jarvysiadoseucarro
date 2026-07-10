# Build 5.7D-PLAN (v3) — UI de vínculo WhatsApp (onboarding + configurações)

Read-only. Backend já validado no 5.7C2 (`requestWhatsappLinkCodeFn`, `confirmWhatsappLinkCodeFn`, RPC `confirm_whatsapp_link_code`, sender/cron).

**Correções v3:**
1. `WhatsappLinkCard.source` aceita apenas `"onboarding" | "app_settings"` neste build. `"change_number"` fica reservado para o 5.7E (a server function `requestWhatsappLinkCodeFn` ainda não aceita esse valor).
2. `confirmWhatsappLinkCodeFn` **não** retorna `phoneE164` neste build. Após sucesso, usar apenas o `contactId` retornado, reler `whatsapp_contacts` do próprio usuário via RLS e usar o `phone_e164` do contato verificado como fonte canônica para sincronizar `profiles.whatsapp`. O input digitado nunca é fonte final.

## A. Resumo executivo
- Etapa nova de onboarding pós-signup, dedicada, opcional, não bloqueante, com "Agora não".
- Componente único `WhatsappLinkCard` reutilizado no onboarding e no ProfileSettingsModal.
- No ProfileSettingsModal, **um único bloco visual** unificando campo `whatsapp` + status do vínculo. Nunca dois campos de telefone.
- Vínculo não inicia trial e não toca capabilities.

## B. Fluxo atual auditado
- `/signup`: cria conta → confirma carro → insere veículo → persiste `profiles.whatsapp` em E.164 → `navigate({ to: "/dashboard" })`.
- `/welcome`: landing pública pré-login (não muda).
- Não existe etapa pós-signup autenticada hoje.
- `ProfileSettingsModal`: input `WhatsApp` livre ligado a `profiles.whatsapp`, salva no botão "Salvar".
- `/dev-wa-link` existe sem gate.

## C. Local recomendado
- Nova rota autenticada: `src/routes/_authenticated/onboarding-whatsapp.tsx`.
- `/signup`, no sucesso, navega para essa rota em vez de `/dashboard`.
- `/welcome` não muda.
- Não injetar no formulário de `/signup`.

## D. Reaproveitamento de `profiles.whatsapp`
- Ler via `supabase.from("profiles").select("whatsapp")`.
- Usar como valor inicial do input (formato BR amigável).
- Nunca tratar como verificado sem contato correspondente em `whatsapp_contacts`.
- Normalizar no submit via `normalizeBrazilPhoneToE164`.

## E. Estados do `WhatsappLinkCard`
1. `idle` — telefone pré-preenchido, checkbox consentimento (desmarcado), "Enviar código" e "Agora não" (se `allowSkip`).
2. `requesting` — loading; inputs bloqueados; anti-duplo-clique.
3. `awaiting_code` — `phoneMasked` exibido; input 6 dígitos (`inputMode="numeric"`, `autoComplete="one-time-code"`, autoFocus); "Confirmar código"; cooldown 60s; "Reenviar código"; "Corrigir número"; "O código expira em 10 minutos".
4. `confirming` — loading; anti-duplo-submit.
5. `success` — "Seu WhatsApp foi vinculado ao Jarvys com sucesso." + "Continuar"; chama `onLinked?.({ contactId })`.
6. `error` — inline; limpa código em `invalid_or_expired`/`blocked`; sem retry automático.

Props (final deste build):
```
{
  source: "onboarding" | "app_settings";   // "change_number" fora deste build
  initialPhone?: string;
  allowSkip?: boolean;
  onLinked?: (result: { contactId: string }) => void;
  onSkip?: () => void;
  onCancel?: () => void;
}
```

## F. Request/Confirm
- Request: `requestWhatsappLinkCodeFn({ data: { phone, consentGeneralAccepted: true, source } })` via `useServerFn`. State local: `verificationId`, `phoneMasked`, `cooldownSeconds`, `expiresInSeconds`, `sentAt`. Nada em `localStorage`.
- Confirm: `confirmWhatsappLinkCodeFn({ data: { verificationId, code } })`. Botão habilita só com `code.length === 6`. Ao ok, extrair `contactId` do retorno; limpar `code` e `verificationId` da memória.
- Nunca logar `code` ou telefone completo.

## G. Consentimento
- Checkbox obrigatório, desmarcado por padrão. Texto v1 alinhado ao backend:  
  "Aceito receber mensagens do Jarvys pelo WhatsApp sobre manutenção, revisão, despesas do meu veículo e recursos inteligentes do app."
- `source`: `"onboarding"` na etapa pós-signup, `"app_settings"` na ativação inicial via settings. Backend registra novo `whatsapp_consents` a cada request.

## H. Cooldown / reenvio / corrigir número
- Cooldown 60s regressivo; "Reenviar código" desabilitado durante.
- Reenviar: novo request; substitui `verificationId`; limpa `code`; reinicia timers.
- `rate_limited` → mensagem estática, sem retry automático.
- "Corrigir número": volta a `idle`, limpa `verificationId`/`code`; consentimento permanece marcado.

## I. Componente reutilizável
`src/components/WhatsappLinkCard.tsx` (criar no EXEC). Encapsula todo o fluxo. Sem side effects além das duas server functions.

## J. Integração no onboarding pós-signup
- Rota `src/routes/_authenticated/onboarding-whatsapp.tsx`.
- Card centrado:  
  `<WhatsappLinkCard source="onboarding" initialPhone={profile.whatsapp} allowSkip onLinked={handleLinked} onSkip={goDashboard} />`
- Correção do telefone antes da 1ª verificação: usa o número corrigido no request.
- `handleLinked({ contactId })` — ver seção Q (sincronia canônica).
- Depois: `navigate({ to: "/dashboard" })`.
- `onSkip`: `navigate({ to: "/dashboard" })`. Nada criado no backend.
- `/signup` passa a navegar para `/onboarding-whatsapp` em vez de `/dashboard` (única alteração fora do card).

## K. Integração no ProfileSettingsModal — **campo único**
Regra fundamental: **um único campo visível "Celular/WhatsApp"**. `whatsapp_contacts` nunca aparece como segundo telefone.

Fonte de leitura:
- `profiles.whatsapp` — valor a exibir no campo (mascarado quando `linked`/`opted_out`).
- `whatsapp_contacts` do próprio user (RLS SELECT-own), última linha por `created_at desc`:
  ```
  select id, phone_e164, verified_at, unlinked_at, opt_out
  from whatsapp_contacts
  where user_id = auth.uid()
  order by created_at desc
  limit 1
  ```
  Deriva `linkStatus`:
  - `linked` ⇔ `verified_at NOT NULL AND unlinked_at IS NULL AND opt_out = false`
  - `opted_out` ⇔ `opt_out = true AND unlinked_at IS NULL`
  - `none` ⇔ caso contrário

Layout do bloco único (substitui o `Field WhatsApp` atual):

```
Celular/WhatsApp
[(21) 9****-0789]      ← read-only mascarado quando linked/opted_out; editável quando none
──────────────────────
Status:
  • linked     → "WhatsApp vinculado ✓"          (sem botão neste build)
  • opted_out  → "Mensagens desativadas"         (sem botão neste build)
  • none       → "WhatsApp ainda não vinculado"  [Ativar WhatsApp Jarvys]
```

Regras de edição:
- `linked` / `opted_out`: input **read-only** mascarado. Alteração de número apenas via fluxo seguro futuro (5.7E). **Sem botão "Alterar número" neste build.**
- `none`: input editável (comportamento atual preservado). Botão "Ativar WhatsApp Jarvys" abre `WhatsappLinkCard source="app_settings"` inline/submodal, usando o número do input como `initialPhone` (permite corrigir antes de solicitar). O botão "Salvar" do modal continua persistindo `profiles.whatsapp` (comportamento atual), pois ainda não há vínculo a proteger.

Nunca exibir: `assigned_whatsapp_number`, `assigned_instance_id`, nome do provider.

## L. Fluxo "Alterar número"
Fora do escopo deste build. `WhatsappLinkCard` não aceita `source: "change_number"`. UI não expõe botão de swap. Documentado para o Build 5.7E, que precisará:
- estender `requestWhatsappLinkCodeFn` para aceitar `source: "change_number"`;
- criar server function segura de swap que só encerra o vínculo antigo após confirmação do novo.

## M. `/dev-wa-link`
- Plan: manter.
- EXEC: remover `src/routes/dev-wa-link.tsx` após smoke passar.

## N. Copy
- Título: "Ative o Jarvys no WhatsApp"
- Descrição: "Receba lembretes, envie informações do seu veículo e use os recursos do Jarvys pelo WhatsApp."
- Botões: "Enviar código" / "Confirmar código" / "Reenviar código" / "Corrigir número" / "Agora não" / "Continuar" / "Ativar WhatsApp Jarvys".
- Badges: "WhatsApp vinculado ✓" / "Mensagens desativadas" / "WhatsApp ainda não vinculado".
- Erros:
  - `invalid_request` → "Confira o número informado."
  - `cooldown` → "Aguarde antes de solicitar outro código."
  - `rate_limited` → "Muitas tentativas. Aguarde um pouco e tente novamente."
  - `phone_conflict` → "Este número já está vinculado a outra conta Jarvys."
  - `user_has_other_active` → "Você já tem outro número vinculado."
  - `already_linked` → "Este número já está vinculado à sua conta."
  - `invalid_or_expired` → "Código inválido ou expirado. Solicite um novo código."
  - `blocked` → "Limite de tentativas atingido. Solicite um novo código."
  - `no_instance_available` → "O WhatsApp Jarvys está temporariamente indisponível. Tente novamente em alguns minutos."
  - `internal_error` → "Não foi possível concluir agora. Tente novamente."
- Nunca citar Z-API/provedor.

## O. Mobile / acessibilidade
- Telefone: `inputMode="tel"`, `autoComplete="tel"`.
- Código: `inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength=6`, autoFocus após request.
- Labels associados; erro acessível; estado não depende só de cor.
- "Agora não" sempre acessível no onboarding.

## P. Trial e gates
- Sem `ensureTrialStartedFn`. Sem alteração de capabilities. Vínculo disponível a qualquer autenticado.

## Q. Sincronia canônica de `profiles.whatsapp` (correção v3)
Aplica-se ao **primeiro vínculo** (onboarding ou ativação em settings, `linkStatus = none → linked`). `confirmWhatsappLinkCodeFn` retorna `{ ok: true, contactId, ... }` — **não** retorna `phoneE164` neste build.

Passos após `ok`:
1. Extrair `contactId` do retorno.
2. Reler `whatsapp_contacts` do próprio usuário via RLS:
   ```
   select phone_e164
   from whatsapp_contacts
   where id = <contactId>
     and user_id = auth.uid()
     and verified_at is not null
     and unlinked_at is null
   limit 1
   ```
3. Se a linha existir, usar `phone_e164` como fonte canônica.
4. Se `profiles.whatsapp !== phone_e164`, executar `update profiles set whatsapp = <phone_e164> where id = auth.uid()`.
5. Se a releitura falhar (linha ausente por qualquer motivo), **não** sincronizar; deixar `profiles.whatsapp` como estava e prosseguir para `dashboard` — o vínculo já está registrado e o próximo carregamento do ProfileSettings mostrará status correto.
6. Nunca usar o telefone digitado no input como fonte final da sincronização.
7. Não alterar `confirmWhatsappLinkCodeFn` neste build para expor telefone completo.

Depois desse primeiro vínculo, o campo é read-only na UI e a edição só será possível via 5.7E.

Se o usuário editar o campo em `linkStatus = none` e clicar "Salvar" sem ativar, mantém comportamento atual (salva `profiles.whatsapp` livre).

## R. Testes (para o EXEC)
23 cenários do briefing original + adicional:
- (24) ProfileSettings mostra um único campo com badge correto para cada `linkStatus`.
- (25) input read-only quando `linked` ou `opted_out`.
- (26) primeiro vínculo sincroniza `profiles.whatsapp` via releitura RLS por `contactId`, nunca a partir do input digitado.
- (27) se releitura RLS retornar 0 linhas, `profiles.whatsapp` permanece inalterado e o fluxo não quebra.

## S. Riscos e mitigações
- Duplicidade de telefone na UI → um único bloco visual.
- Edição livre sobrescrevendo vínculo → input read-only quando `linked`/`opted_out`.
- Encerrar antigo antes de validar novo → sem UI de swap neste build.
- Reload perde verification → aceitável; usuário refaz após cooldown.
- Código antigo após reenvio → novo request cancela pending; UI limpa input.
- Rate limit loop → sem retry automático.
- Erro técnico vazando → mapa fechado de copies.
- Log de PII → proibido logar `code`/telefone completo.
- `/dev-wa-link` exposto → remoção no EXEC.
- Trial acidental → PLAN proíbe; EXEC não importa `ensureTrialStartedFn`.
- Sincronia de `profiles.whatsapp` com telefone errado → releitura RLS via `contactId` é a única fonte permitida.

## T. Próximo build
**Build 5.7D-EXEC — UI de vínculo WhatsApp**
- Criar `src/components/WhatsappLinkCard.tsx` (props: `source: "onboarding" | "app_settings"`, `initialPhone?`, `allowSkip?`, `onLinked?({ contactId })`, `onSkip?`, `onCancel?`).
- Criar `src/routes/_authenticated/onboarding-whatsapp.tsx`; `/signup` redireciona para lá no sucesso.
- Ajustar `ProfileSettingsModal`: substituir o `Field WhatsApp` atual pelo bloco único (campo + status + ação condicional); input read-only quando `linked`/`opted_out`; botão "Ativar WhatsApp Jarvys" quando `none`. Sem botão "Alterar número" funcional.
- No primeiro vínculo confirmado: reler `whatsapp_contacts` por `contactId` via RLS e atualizar `profiles.whatsapp` a partir de `phone_e164` retornado; jamais a partir do input.
- Remover `src/routes/dev-wa-link.tsx` após smoke.
- Sem novas server functions, sem migration, sem capability change, sem OCR/IA/pagamento/FIPE.

**Build 5.7E (futuro) — Alterar número / opt-out / reativar**
- Estender `requestWhatsappLinkCodeFn` para `source: "change_number"`.
- Server functions seguras de swap, opt-out e reactivate.
- Só então habilitar botão "Alterar número" e ações de opt-out/reativar na UI.

---

**Nota de UX aplicada:** um único campo Celular/WhatsApp será exibido; o contato verificado é representado apenas pelo status do vínculo, sem duplicar o número na interface.

**Nota técnica aplicada:** `WhatsappLinkCard` neste build só aceita `source: "onboarding" | "app_settings"`; sincronia de `profiles.whatsapp` sempre por releitura de `whatsapp_contacts` via `contactId`, nunca a partir do input.

**Build 5.7D-PLAN (v3) executado em modo read-only. Plano da UI de vínculo WhatsApp no onboarding e configurações concluído sem alterar código.**
