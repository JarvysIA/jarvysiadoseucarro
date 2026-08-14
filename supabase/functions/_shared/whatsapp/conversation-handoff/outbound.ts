// C6 — Wrapper TypeScript para o outbound persistido do Conversation
// Handoff (migration whatsapp_conversation_handoff_outbound). Reaproveita
// a whatsapp_outbound_queue existente via RPCs SECURITY DEFINER — nunca
// .insert/.update/.delete/.upsert diretos. Reaproveita só o tipo
// estrutural SupabaseLike do repository do orquestrador (nunca a classe
// inteira, que é específica de fila/lease). Sem Supabase real, sem I/O
// próprio além de client.rpc(...) — a única chamada de rede é a que o
// client injetado já faz por dentro.
//
// Fail-closed sempre: qualquer erro de RPC (retornado em res.error ou
// lançado como exceção) vira o retorno seguro (null), nunca propaga
// mensagem, código SQL ou stack de erro em lugar nenhum.
//
// getConversationHandoffOutboundByKey (pré-requisito do C7, migration
// ...ledger_result_status_and_outbound_lookup) é só leitura — busca o
// texto já persistido de uma resposta pela idempotency_key, sem nunca
// enfileirar nem escrever nada.

import type { SupabaseLike } from "../orchestrator/repository.ts";

export type ConversationHandoffOutboundSegment = "primary" | "supplemental";

export function buildConversationHandoffIdempotencyKey(
  sourceMessageId: string,
  segment: ConversationHandoffOutboundSegment,
): string {
  return `conversation-handoff:${sourceMessageId}:${segment}`;
}

export type ConversationHandoffOutboundRejectResult =
  | "invalid_idempotency_key"
  | "invalid_text"
  | "contact_not_found"
  | "contact_opted_out"
  | "contact_context_mismatch"
  | "contact_not_linked"
  | "vehicle_not_found"
  | "idempotency_context_mismatch";

export type ConversationHandoffOutboundResult =
  | Readonly<{
      result: "created" | "replayed";
      outboundMessageId: string;
      outboundQueueId: string;
    }>
  | Readonly<{ result: ConversationHandoffOutboundRejectResult }>;

const REJECT_RESULTS: ReadonlySet<string> = new Set([
  "invalid_idempotency_key",
  "invalid_text",
  "contact_not_found",
  "contact_opted_out",
  "contact_context_mismatch",
  "contact_not_linked",
  "vehicle_not_found",
  "idempotency_context_mismatch",
]);

function isRejectResult(value: string): value is ConversationHandoffOutboundRejectResult {
  return REJECT_RESULTS.has(value);
}

function parseOutboundResult(raw: unknown): ConversationHandoffOutboundResult | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const result = row.result;
  if (typeof result !== "string") return null;

  if (result === "created" || result === "replayed") {
    const outboundMessageId = row.outbound_message_id;
    const outboundQueueId = row.outbound_queue_id;
    if (
      typeof outboundMessageId !== "string" ||
      outboundMessageId === "" ||
      typeof outboundQueueId !== "string" ||
      outboundQueueId === ""
    ) {
      return null;
    }
    return { result, outboundMessageId, outboundQueueId };
  }

  if (isRejectResult(result)) {
    return { result };
  }

  return null;
}

export async function enqueueConversationHandoffOutbound(
  client: SupabaseLike,
  params: Readonly<{
    idempotencyKey: string;
    contactId: string;
    userId: string;
    vehicleId: string | null;
    textBody: string;
  }>,
): Promise<ConversationHandoffOutboundResult | null> {
  try {
    const res = await client.rpc("enqueue_conversation_handoff_outbound", {
      p_idempotency_key: params.idempotencyKey,
      p_contact_id: params.contactId,
      p_user_id: params.userId,
      p_vehicle_id: params.vehicleId,
      p_text_body: params.textBody,
    });
    if (res.error) return null;
    return parseOutboundResult(res.data);
  } catch {
    return null;
  }
}

export type ConversationHandoffOutboundLookupResult =
  | Readonly<{
      found: true;
      textBody: string;
      outboundMessageId: string;
      outboundQueueId: string;
    }>
  | Readonly<{ found: false }>;

function parseOutboundLookupResult(raw: unknown): ConversationHandoffOutboundLookupResult | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return { found: false };
  const row = raw[0];
  if (typeof row !== "object" || row === null) return null;
  const candidate = row as Record<string, unknown>;
  const textBody = candidate.text_body;
  const outboundMessageId = candidate.outbound_message_id;
  const outboundQueueId = candidate.outbound_queue_id;
  if (
    typeof textBody !== "string" ||
    textBody === "" ||
    typeof outboundMessageId !== "string" ||
    outboundMessageId === "" ||
    typeof outboundQueueId !== "string" ||
    outboundQueueId === ""
  ) {
    return null;
  }
  return { found: true, textBody, outboundMessageId, outboundQueueId };
}

export async function getConversationHandoffOutboundByKey(
  client: SupabaseLike,
  idempotencyKey: string,
): Promise<ConversationHandoffOutboundLookupResult | null> {
  try {
    const res = await client.rpc("get_conversation_handoff_outbound_by_key", {
      p_idempotency_key: idempotencyKey,
    });
    if (res.error) return null;
    return parseOutboundLookupResult(res.data);
  } catch {
    return null;
  }
}
