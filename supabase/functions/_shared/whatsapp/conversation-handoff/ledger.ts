// C5 — Wrappers TypeScript para o ledger at-most-once do Conversation
// Handoff (migration whatsapp_conversation_handoff_ledger). Toda escrita
// passa pelas 4 RPCs SECURITY DEFINER — nunca .insert/.update/.delete/
// .upsert diretos. Reaproveita só o tipo estrutural SupabaseLike do
// repository do orquestrador (nunca a classe inteira, que é específica de
// fila/lease). Sem Supabase real, sem I/O próprio além de client.rpc(...)
// — a única chamada de rede é a que o client injetado já faz por dentro.
//
// Fail-closed sempre: qualquer erro de RPC (retornado em res.error ou
// lançado como exceção) vira o retorno seguro (null/false), nunca
// propaga mensagem, código SQL ou stack de erro em lugar nenhum.
//
// reserveConversationHandoffExecution também devolve resultStatus
// (pré-requisito do C7, migration
// ...ledger_result_status_and_outbound_lookup) — omitido (não
// undefined) enquanto reserved/invoking, presente quando
// completed/failed.

import type { SupabaseLike } from "../orchestrator/repository.ts";

export const CONVERSATION_HANDOFF_RESERVATION_TTL_SECONDS = 45;

export type ConversationHandoffLedgerResultStatus =
  | "success"
  | "blocked"
  | "transient_failure"
  | "permanent_failure";

export type ConversationHandoffLedgerReservation = Readonly<{
  id: string;
  status: "reserved" | "invoking" | "completed" | "failed";
  isNewReservation: boolean;
  resultStatus?: ConversationHandoffLedgerResultStatus;
}>;

const RESERVATION_STATUSES: ReadonlySet<string> = new Set([
  "reserved",
  "invoking",
  "completed",
  "failed",
]);

const RESULT_STATUSES: ReadonlySet<string> = new Set([
  "success",
  "blocked",
  "transient_failure",
  "permanent_failure",
]);

function isValidReservationRow(row: unknown): row is {
  id: string;
  status: string;
  is_new_reservation: boolean;
  result_status: string | null;
} {
  if (typeof row !== "object" || row === null) return false;
  const candidate = row as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id !== "" &&
    typeof candidate.status === "string" &&
    RESERVATION_STATUSES.has(candidate.status) &&
    typeof candidate.is_new_reservation === "boolean" &&
    (candidate.result_status === null ||
      (typeof candidate.result_status === "string" && RESULT_STATUSES.has(candidate.result_status)))
  );
}

function parseReservationRow(raw: unknown): ConversationHandoffLedgerReservation | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const row = raw[0];
  if (!isValidReservationRow(row)) return null;
  return {
    id: row.id,
    status: row.status as ConversationHandoffLedgerReservation["status"],
    isNewReservation: row.is_new_reservation,
    ...(row.result_status === null
      ? {}
      : { resultStatus: row.result_status as ConversationHandoffLedgerResultStatus }),
  };
}

function parseBooleanResult(raw: unknown): boolean {
  return typeof raw === "boolean" ? raw : false;
}

export async function reserveConversationHandoffExecution(
  client: SupabaseLike,
  params: Readonly<{
    sourceMessageId: string;
    segment: "primary" | "supplemental";
    contactId: string;
    userId: string;
    vehicleId: string | null;
    ttlSeconds: number;
  }>,
): Promise<ConversationHandoffLedgerReservation | null> {
  try {
    const res = await client.rpc("reserve_conversation_handoff_execution", {
      p_source_message_id: params.sourceMessageId,
      p_segment: params.segment,
      p_contact_id: params.contactId,
      p_user_id: params.userId,
      p_vehicle_id: params.vehicleId,
      p_ttl_seconds: params.ttlSeconds,
    });
    if (res.error) return null;
    return parseReservationRow(res.data);
  } catch {
    return null;
  }
}

export async function markConversationHandoffInvoking(
  client: SupabaseLike,
  id: string,
): Promise<boolean> {
  try {
    const res = await client.rpc("mark_conversation_handoff_invoking", { p_id: id });
    if (res.error) return false;
    return parseBooleanResult(res.data);
  } catch {
    return false;
  }
}

export async function completeConversationHandoffExecution(
  client: SupabaseLike,
  id: string,
  resultStatus: ConversationHandoffLedgerResultStatus,
): Promise<boolean> {
  try {
    const res = await client.rpc("complete_conversation_handoff_execution", {
      p_id: id,
      p_result_status: resultStatus,
    });
    if (res.error) return false;
    return parseBooleanResult(res.data);
  } catch {
    return false;
  }
}

export async function failConversationHandoffExecution(
  client: SupabaseLike,
  id: string,
  resultStatus: Exclude<ConversationHandoffLedgerResultStatus, "success">,
): Promise<boolean> {
  try {
    const res = await client.rpc("fail_conversation_handoff_execution", {
      p_id: id,
      p_result_status: resultStatus,
    });
    if (res.error) return false;
    return parseBooleanResult(res.data);
  } catch {
    return false;
  }
}
