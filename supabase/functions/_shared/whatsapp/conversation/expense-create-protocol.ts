// Build expense-create-core-wiring — Discriminantes puros para o fluxo de
// criação de despesa via WhatsApp. Mirror EXATO de km-update-protocol.ts.
//
// Módulo 100% puro: sem I/O, sem Supabase, sem env, sem clock, sem crypto,
// sem rede, sem logs, sem side-effects. Não importa draft, parser, actions,
// core, Repository, Shadow, worker ou test-service.

// ---------------------------------------------------------------------------
// Evento T1 — expense_reported
// ---------------------------------------------------------------------------

export const EXPENSE_REPORTED_EVENT_KIND = "expense_reported" as const;

export type ExpenseReportedEventKind = typeof EXPENSE_REPORTED_EVENT_KIND;

export type ExpenseReportedEvent = Readonly<{
  readonly kind: typeof EXPENSE_REPORTED_EVENT_KIND;
}>;

// ---------------------------------------------------------------------------
// Handoff T2 — confirm_expense_create
// ---------------------------------------------------------------------------

export const CONFIRM_EXPENSE_CREATE_HANDOFF_KIND = "confirm_expense_create" as const;

export type ConfirmExpenseCreateHandoffKind = typeof CONFIRM_EXPENSE_CREATE_HANDOFF_KIND;

export type ConfirmExpenseCreateHandoff = Readonly<{
  readonly kind: typeof CONFIRM_EXPENSE_CREATE_HANDOFF_KIND;
}>;
