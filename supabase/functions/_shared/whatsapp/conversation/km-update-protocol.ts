// Build 5.7F2E1A.5-MD — Discriminantes puros e desconectados do fluxo de KM.
//
// Este módulo define APENAS o plano de controle:
//   - km_reported: evento T1 (parser reconheceu KM; futuro transition criará draft);
//   - confirm_km_update: handoff T2 (confirmação → executor especializado futuro).
//
// Módulo 100% puro: sem I/O, sem Supabase, sem env, sem clock, sem crypto,
// sem rede, sem logs, sem side-effects. Não importa draft, parser, actions,
// core, Repository, Shadow, worker ou test-service. Não é consumido por
// nenhum runtime neste build.
//
// Os marcadores NÃO carregam payload de domínio (newKm, expectedPreviousKm,
// vehicleId, requestMessageId, isCorrection) nem identificadores de
// infraestrutura (draftId, queueItemId, sourceMessageId, userId, etc.).
// O draft persistido é a fonte dos dados de domínio.

// ---------------------------------------------------------------------------
// Evento T1 — km_reported
// ---------------------------------------------------------------------------

export const KM_REPORTED_EVENT_KIND = "km_reported" as const;

export type KmReportedEventKind = typeof KM_REPORTED_EVENT_KIND;

export type KmReportedEvent = Readonly<{
  readonly kind: typeof KM_REPORTED_EVENT_KIND;
}>;

// ---------------------------------------------------------------------------
// Handoff T2 — confirm_km_update
// ---------------------------------------------------------------------------

export const CONFIRM_KM_UPDATE_HANDOFF_KIND = "confirm_km_update" as const;

export type ConfirmKmUpdateHandoffKind =
  typeof CONFIRM_KM_UPDATE_HANDOFF_KIND;

export type ConfirmKmUpdateHandoff = Readonly<{
  readonly kind: typeof CONFIRM_KM_UPDATE_HANDOFF_KIND;
}>;
