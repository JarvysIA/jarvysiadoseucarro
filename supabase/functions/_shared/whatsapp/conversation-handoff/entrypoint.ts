// C7 — Entrypoint que monta a pipeline completa do handoff `conversation`:
// C1 (contrato) + C2A (contrato agregado) + C2B (executor) + C3 (adapter
// Dr. Jarvys) + C4 (autorização) + C5 (ledger at-most-once) + C6 (outbound
// persistido). Não reimplementa NENHUMA regra desses 7 módulos — só
// compõe. Ainda desconectado do runtime real (core.ts, orchestrator/*,
// whatsapp-process-inbound) — isso é C8. Toda I/O passa pelos módulos já
// existentes via o client estrutural (SupabaseLike) injetado; este
// arquivo nunca chama fetch/Supabase/banco diretamente.
//
// Fluxo:
// 1) Valida o command recebido de novo (mesmo já vindo tipado) — nunca
//    confia cegamente em quem chama.
// 2) Resolve autorização (C4) UMA vez para o par (userId, vehicleId).
// 3) Se bloqueado: enfileira a mensagem de bloqueio (upsell ou "veículo
//    não encontrado") e retorna, sem tocar no ledger nem chamar a IA.
// 4) Se autorizado: monta um invoker "guardado" pelo ledger (C5) — cada
//    chamada de segmento primeiro reserva no ledger; só invoca a IA de
//    verdade (C3) numa reserva genuinamente nova; em qualquer replay
//    (reserva já viva, já completed, já failed) NUNCA chama a IA de
//    novo — devolve o resultado já persistido ou um resultado incerto
//    controlado, deixando o executor (C2B) classificar como incerto via
//    exceção (o mesmo mecanismo que o C2B já usa para exceção/resultado
//    inválido do invoker real).
// 5) Traduz o resultado agregado do executor (C2B) num outcome de alto
//    nível + o texto final a enviar, e enfileira esse texto (C6) sob a
//    chave de idempotência FINAL (distinta da chave de idempotência de
//    cada segmento, usada internamente pelo ledger/outbound de C5/C6).

import {
  validateConversationExecutionResult,
  type ConversationExecutionResult,
} from "./contract.ts";
import {
  validateConversationHandoffExecutionCommandV1,
  type ConversationHandoffExecutionCommandV1,
  type ConversationHandoffExecutionResultV1,
} from "./execution-contract.ts";
import { executeConversationHandoffV1, type ConversationHandoffInvokerV1 } from "./executor.ts";
import { createAskDrJarvysInvoker } from "./dr-jarvys-adapter.ts";
import { resolveConversationHandoffAuthorization } from "./dr-jarvys-authorization.ts";
import {
  CONVERSATION_HANDOFF_RESERVATION_TTL_SECONDS,
  completeConversationHandoffExecution,
  failConversationHandoffExecution,
  markConversationHandoffInvoking,
  reserveConversationHandoffExecution,
  type ConversationHandoffLedgerResultStatus,
} from "./ledger.ts";
import {
  buildConversationHandoffIdempotencyKey,
  enqueueConversationHandoffOutbound,
  getConversationHandoffOutboundByKey,
  type ConversationHandoffOutboundResult,
} from "./outbound.ts";
import type { SupabaseLike } from "../orchestrator/repository.ts";
import type { DrJarvysVehicleContext } from "../dr-jarvys/ask-dr-jarvys.ts";

// ------------------------------------------------------------
// Textos fixos — nunca gerados por IA.
// ------------------------------------------------------------

export const CONVERSATION_HANDOFF_ACTIVATION_LINK_BASE = "https://jarvys.com.br/app";

export function buildConversationHandoffActivationLink(suggestedVehicleId?: string): string {
  return suggestedVehicleId
    ? `${CONVERSATION_HANDOFF_ACTIVATION_LINK_BASE}?ativar=${suggestedVehicleId}`
    : CONVERSATION_HANDOFF_ACTIVATION_LINK_BASE;
}

export function buildConversationHandoffActivationUpsellText(suggestedVehicleId?: string): string {
  const link = buildConversationHandoffActivationLink(suggestedVehicleId);
  return `Essa conversa livre com o Jarvys é liberada nos planos ativos! Ative seu veículo e desbloqueie isso e muito mais: ${link}`;
}

export const CONVERSATION_HANDOFF_VEHICLE_NOT_FOUND_TEXT =
  "Não consegui identificar esse veículo, tenta de novo.";

export const CONVERSATION_HANDOFF_TRANSIENT_FAILURE_TEXT =
  "Não consegui responder agora. Pode tentar de novo em alguns instantes?";

// ------------------------------------------------------------
// Chave de idempotência FINAL — distinta da chave por segmento já
// existente em outbound.ts (buildConversationHandoffIdempotencyKey,
// reaproveitada tal como está, nunca reimplementada aqui).
// ------------------------------------------------------------

export function buildConversationHandoffFinalIdempotencyKey(sourceMessageId: string): string {
  return `conversation-handoff:${sourceMessageId}:final`;
}

// ------------------------------------------------------------
// Tipos públicos
// ------------------------------------------------------------

export type ConversationHandoffEntrypointOutcome =
  | "blocked_authorization_required"
  | "blocked_vehicle_required"
  | "primary_succeeded"
  | "primary_failed"
  | "completed"
  | "partially_completed"
  | "uncertain";

export type ConversationHandoffEntrypointResult = Readonly<{
  outcome: ConversationHandoffEntrypointOutcome;
  outboundResult: ConversationHandoffOutboundResult | null;
}>;

// ------------------------------------------------------------
// Mapeamento de result_status persistido (ledger) de volta para um
// ConversationExecutionResult "sintético" nos casos de replay onde a
// execução já terminou sem sucesso. O ledger só persiste o status
// grosso (success|blocked|transient_failure|permanent_failure), nunca
// o reason fino original — então esse mapeamento é necessariamente
// perdedor de informação quando existe mais de um reason válido por
// status. Decisão, documentada em vez de travar o build:
//   - "transient_failure" → reason "temporarily_unavailable": único
//     valor válido do tipo, sem ambiguidade nenhuma.
//   - "permanent_failure" → reason "invalid_request": é o ÚNICO reason
//     que dr-jarvys-adapter.ts (C3) de fato produz na prática (ver
//     PERMANENT_FAILURE_ERRORS ali) — "unsupported_request" existe no
//     tipo mas nunca é emitido pelo invoker real deste build.
//   - "blocked" → reason "authorization_required": este resultStatus
//     nunca é escrito pelo invoker guardado abaixo na prática, porque
//     mapAskDrJarvysResult (C3) nunca produz status:"blocked" — só
//     success/transient_failure/permanent_failure. Mantido por
//     completude defensiva (o tipo do ledger permite genericamente os
//     4 valores), mas este ramo é código morto em relação ao invoker
//     real atual; o reason escolhido é arbitrário entre os 2 válidos
//     só para satisfazer o tipo de retorno.
function mapPersistedResultStatusToExecutionResult(
  resultStatus: ConversationHandoffLedgerResultStatus,
): Exclude<ConversationExecutionResult, { status: "success" }> {
  if (resultStatus === "blocked") {
    return { status: "blocked", reason: "authorization_required" };
  }
  if (resultStatus === "transient_failure") {
    return { status: "transient_failure", reason: "temporarily_unavailable" };
  }
  return { status: "permanent_failure", reason: "invalid_request" };
}

// ------------------------------------------------------------
// Invoker guardado pelo ledger — a única ponte entre o executor (C2B)
// e a IA real (C3), com garantia de at-most-once via C5.
// ------------------------------------------------------------

function createLedgerGuardedInvoker(
  client: SupabaseLike,
  vehicleContext: DrJarvysVehicleContext | undefined,
): ConversationHandoffInvokerV1 {
  const realInvoker = createAskDrJarvysInvoker(vehicleContext);

  return async (segmentCommand) => {
    const segmentKey = buildConversationHandoffIdempotencyKey(
      segmentCommand.sourceMessageId,
      segmentCommand.segment,
    );

    const reservation = await reserveConversationHandoffExecution(client, {
      sourceMessageId: segmentCommand.sourceMessageId,
      segment: segmentCommand.segment,
      contactId: segmentCommand.contactId,
      userId: segmentCommand.userId,
      vehicleId: segmentCommand.vehicleId,
      ttlSeconds: CONVERSATION_HANDOFF_RESERVATION_TTL_SECONDS,
    });

    if (reservation === null) {
      throw new Error("ledger_reserve_failed");
    }

    if (reservation.status === "failed") {
      // Sweep prévio (invoking expirado) ou falha anterior — NUNCA
      // chama a IA de novo para este segmento (Opção A, já travada no C5).
      const fallback: ConversationExecutionResult = {
        status: "transient_failure",
        reason: "temporarily_unavailable",
      };
      return fallback;
    }

    if (reservation.status === "completed") {
      if (reservation.resultStatus === "success") {
        const lookup = await getConversationHandoffOutboundByKey(client, segmentKey);
        if (lookup && lookup.found) {
          const success: ConversationExecutionResult = {
            status: "success",
            responseText: lookup.textBody,
          };
          return success;
        }
        // completed+success mas o texto cru não é recuperável — incerto,
        // nunca reexecuta a IA (mesmo espírito da Opção A).
        throw new Error("ledger_completed_text_unrecoverable");
      }
      if (reservation.resultStatus === undefined) {
        // Invariante do ledger diz que completed sempre tem
        // resultStatus — nunca confiar cegamente nisso vindo de outro
        // módulo/boundary.
        throw new Error("ledger_completed_missing_result_status");
      }
      return mapPersistedResultStatusToExecutionResult(reservation.resultStatus);
    }

    if (!reservation.isNewReservation) {
      // reserved/invoking vivo de outro processo concorrente — não
      // sabemos o desfecho; deixa o executor classificar como incerto.
      throw new Error("ledger_reservation_in_progress");
    }

    // Reserva nova de verdade — segue o caminho normal.
    const marked = await markConversationHandoffInvoking(client, reservation.id);
    if (!marked) {
      throw new Error("ledger_mark_invoking_failed");
    }

    const rawResult = await realInvoker(segmentCommand);
    // Valida o formato antes de decidir o que persistir/completar —
    // reaproveita o validator do C1, nunca reimplementa a regra. O
    // executor (C2B) também valida de novo o retorno deste invoker —
    // essa segunda validação é esperada (defesa em profundidade do
    // C2B), não uma duplicação de regra de negócio.
    const validated = validateConversationExecutionResult(rawResult);
    if (!validated.ok) {
      await failConversationHandoffExecution(client, reservation.id, "permanent_failure");
      throw new Error("ledger_invoke_result_invalid");
    }

    if (validated.value.status === "success") {
      // Mesmo se o enqueue do texto cru falhar, ainda completamos o
      // ledger com o status real — a persistência do texto cru (C6) é
      // um problema de recuperação futura, separado da execução da IA
      // em si (C5 já sabe que a execução teve sucesso independente
      // disso).
      await enqueueConversationHandoffOutbound(client, {
        idempotencyKey: segmentKey,
        contactId: segmentCommand.contactId,
        userId: segmentCommand.userId,
        vehicleId: segmentCommand.vehicleId,
        textBody: validated.value.responseText,
      });
      await completeConversationHandoffExecution(client, reservation.id, "success");
    } else {
      await completeConversationHandoffExecution(client, reservation.id, validated.value.status);
    }

    return validated.value;
  };
}

// ------------------------------------------------------------
// Tradução do resultado agregado do executor (C2B) em outcome + texto.
// ------------------------------------------------------------

function translateExecutionResult(
  result: ConversationHandoffExecutionResultV1,
): Readonly<{ outcome: ConversationHandoffEntrypointOutcome; text: string }> {
  switch (result.status) {
    case "primary_succeeded":
      return { outcome: "primary_succeeded", text: result.primaryResult.responseText };
    case "primary_failed":
      return { outcome: "primary_failed", text: CONVERSATION_HANDOFF_TRANSIENT_FAILURE_TEXT };
    case "primary_outcome_uncertain":
      return { outcome: "uncertain", text: CONVERSATION_HANDOFF_TRANSIENT_FAILURE_TEXT };
    case "completed":
      return {
        outcome: "completed",
        text: `${result.primaryResult.responseText}\n\n${result.supplementalResult.responseText}`,
      };
    case "partially_completed":
      return { outcome: "partially_completed", text: result.primaryResult.responseText };
    case "supplemental_outcome_uncertain":
      // Reaproveita o mesmo outcome/mensagem de partially_completed —
      // "só manda o que funcionou", mesmo tratamento nos dois casos
      // (decisão do PLAN, não reaberta aqui).
      return { outcome: "partially_completed", text: result.primaryResult.responseText };
  }
}

// ------------------------------------------------------------
// Entrypoint público
// ------------------------------------------------------------

export async function executeConversationHandoffEntrypoint(
  client: SupabaseLike,
  command: ConversationHandoffExecutionCommandV1,
): Promise<ConversationHandoffEntrypointResult> {
  const validated = validateConversationHandoffExecutionCommandV1(command);
  if (!validated.ok) {
    // Comando estruturalmente inválido é erro de programação de quem
    // chama, não um resultado de negócio — não há outcome pra isso.
    throw new Error(`invalid_conversation_handoff_execution_command:${validated.code}`);
  }
  const validCommand = validated.value;

  const authorization = await resolveConversationHandoffAuthorization(
    client,
    validCommand.primary.userId,
    validCommand.primary.vehicleId,
  );

  if (!authorization.authorized) {
    const outcome: ConversationHandoffEntrypointOutcome =
      authorization.reason === "authorization_required"
        ? "blocked_authorization_required"
        : "blocked_vehicle_required";
    const text =
      authorization.reason === "authorization_required"
        ? buildConversationHandoffActivationUpsellText(authorization.suggestedVehicleId)
        : CONVERSATION_HANDOFF_VEHICLE_NOT_FOUND_TEXT;

    const outboundResult = await enqueueConversationHandoffOutbound(client, {
      idempotencyKey: buildConversationHandoffFinalIdempotencyKey(
        validCommand.primary.sourceMessageId,
      ),
      contactId: validCommand.primary.contactId,
      userId: validCommand.primary.userId,
      vehicleId: validCommand.primary.vehicleId,
      textBody: text,
    });

    return { outcome, outboundResult };
  }

  const invoker = createLedgerGuardedInvoker(client, authorization.vehicleContext);
  const executionResult = await executeConversationHandoffV1(validCommand, invoker);
  const { outcome, text } = translateExecutionResult(executionResult);

  const outboundResult = await enqueueConversationHandoffOutbound(client, {
    idempotencyKey: buildConversationHandoffFinalIdempotencyKey(
      validCommand.primary.sourceMessageId,
    ),
    contactId: validCommand.primary.contactId,
    userId: validCommand.primary.userId,
    vehicleId: validCommand.primary.vehicleId,
    textBody: text,
  });

  return { outcome, outboundResult };
}
