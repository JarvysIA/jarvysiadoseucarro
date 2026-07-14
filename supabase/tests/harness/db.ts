/**
 * Harness PostgreSQL dedicado ao ambiente MJ1A-V-ENV-CI.
 *
 * - Lê TEST_DATABASE_URL SEM fallback.
 * - Reaproveita o guard puro para validar o alvo antes de abrir socket.
 * - Abre `pg.Client` dedicado (nunca Pool: precisamos provar sessões físicas
 *   independentes).
 * - Configura timeouts conservadores.
 * - Fornece helpers begin/commit/rollback/close.
 * - Sanitiza erros: nunca imprime DSN, senha ou secrets.
 *
 * `pg` é devDependency exclusiva do CI de testes. NÃO importar deste módulo
 * a partir de `src/`, edge functions ou qualquer bundle produtivo.
 */

import { Client } from "pg";
import type { QueryResult, QueryResultRow } from "pg";
import { validateTestDatabaseUrlPreflight } from "../../../scripts/test-db/guard";

const STATEMENT_TIMEOUT_MS = 15_000;
const LOCK_TIMEOUT_MS = 5_000;
const IDLE_IN_TX_TIMEOUT_MS = 10_000;

export type Session = {
  readonly label: string;
  readonly backendPid: number;
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
};

function requireTestDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  const pre = validateTestDatabaseUrlPreflight(raw);
  if (!pre.ok) {
    throw new Error(`TEST_DATABASE_URL rejeitado pelo guard: ${pre.reason}`);
  }
  // raw é definitivamente string aqui — preflight não aceita undefined.
  return raw as string;
}

export async function openSession(label: string): Promise<Session> {
  const connectionString = requireTestDatabaseUrl();
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`set statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await client.query(`set lock_timeout = ${LOCK_TIMEOUT_MS}`);
    await client.query(
      `set idle_in_transaction_session_timeout = ${IDLE_IN_TX_TIMEOUT_MS}`,
    );
  } catch (err) {
    await safeEnd(client);
    throw sanitizeError(err, `sessão ${label}: setup de timeouts falhou`);
  }

  let backendPid: number;
  try {
    const r = await client.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    backendPid = Number(r.rows[0]?.pid);
    if (!Number.isFinite(backendPid) || backendPid <= 0) {
      throw new Error(`pg_backend_pid inválido em sessão ${label}`);
    }
  } catch (err) {
    await safeEnd(client);
    throw sanitizeError(err, `sessão ${label}: pg_backend_pid falhou`);
  }

  const session: Session = {
    label,
    backendPid,
    async query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      try {
        return await client.query<T>(sql, params);
      } catch (err) {
        throw sanitizeError(err, `sessão ${label}: query falhou`);
      }
    },
    async begin() {
      await this.query("begin");
    },
    async commit() {
      await this.query("commit");
    },
    async rollback() {
      await this.query("rollback");
    },
    async close() {
      await safeEnd(client);
    },
  };

  return session;
}

async function safeEnd(client: Client): Promise<void> {
  try {
    await client.end();
  } catch {
    /* ignore: fechamento em finally não deve mascarar erro anterior */
  }
}

/**
 * Sanitiza erros do pg: remove DSN, senha e strings suspeitas. Preserva apenas
 * a mensagem básica e o code Postgres, quando presentes.
 */
export function sanitizeError(err: unknown, context: string): Error {
  const anyErr = err as { message?: unknown; code?: unknown };
  const rawMsg = typeof anyErr?.message === "string" ? anyErr.message : "";
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  // Remove qualquer trecho que se pareça com DSN.
  const cleanedMsg = rawMsg
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://[redacted]")
    .replace(/password=[^\s]+/gi, "password=[redacted]");
  const codePart = code ? ` code=${code}` : "";
  return new Error(`${context}: ${cleanedMsg}${codePart}`.trim());
}
