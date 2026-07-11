// Build 5.7F2B3 — Erros tipados do Repository do orquestrador WhatsApp.
// Nenhum construtor aceita PII. `context` é opcional e deve carregar apenas
// identificadores técnicos (queueItemId, leaseToken parcial, reasonCode).

export type RepositoryErrorContext = {
  queueItemId?: string;
  workerId?: string;
  reasonCode?: string;
  attempt?: number;
  cause?: string; // mensagem sanitizada, NUNCA PII
};

/** Base para todos os erros do Repository. Nunca inclui phone/body/nome. */
export class RepositoryError extends Error {
  readonly code: string;
  readonly context: RepositoryErrorContext;
  constructor(code: string, message: string, context: RepositoryErrorContext = {}) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
    this.context = context;
  }
}

/** Falha de transporte/rede antes de saber se a RPC processou. Retry é seguro. */
export class TransportError extends RepositoryError {
  constructor(message: string, context: RepositoryErrorContext = {}) {
    super("transport_error", message, context);
    this.name = "TransportError";
  }
}

/**
 * Timeout ou abort ANTES da resposta do servidor. Não sabemos se o commit ocorreu.
 * Caller deve tentar `durable replay` UMA vez com os mesmos inputs — a RPC
 * detecta o processing_queue já finalizado e devolve wasReplay=true.
 */
export class AmbiguousTimeoutError extends RepositoryError {
  constructor(message: string, context: RepositoryErrorContext = {}) {
    super("ambiguous_timeout", message, context);
    this.name = "AmbiguousTimeoutError";
  }
}

/** RPC devolveu payload malformado (sem `ok`, sem `reason` quando ok=false, etc.). */
export class MalformedResponseError extends RepositoryError {
  constructor(message: string, context: RepositoryErrorContext = {}) {
    super("malformed_response", message, context);
    this.name = "MalformedResponseError";
  }
}

/**
 * RPC emitiu reason que não existe na função atualmente instalada. Provável
 * skew entre worker e banco. Caller deve tratar como falha fatal + alerta.
 */
export class UnknownReasonError extends RepositoryError {
  constructor(reasonCode: string, context: RepositoryErrorContext = {}) {
    super("unknown_reason", `unknown reason: ${reasonCode}`, {
      ...context,
      reasonCode,
    });
    this.name = "UnknownReasonError";
  }
}

/**
 * Sinaliza que a RPC devolveu erro interno (RAISE EXCEPTION). Preserva SQLSTATE
 * quando disponível. Nunca inclui statement text ou parâmetros.
 */
export class RpcExceptionError extends RepositoryError {
  readonly sqlState: string | null;
  constructor(sqlState: string | null, message: string, context: RepositoryErrorContext = {}) {
    super("rpc_exception", message, context);
    this.name = "RpcExceptionError";
    this.sqlState = sqlState;
  }
}
