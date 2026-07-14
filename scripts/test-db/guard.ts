/**
 * Guard fail-closed para TEST_DATABASE_URL.
 *
 * Responsabilidades:
 *   - validação pré-conexão (parse puro, sem socket);
 *   - validação pós-conexão (query no banco local + marker sintético).
 *
 * Nunca lê DATABASE_URL, SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * pooler ou qualquer variável remota como fallback. Se TEST_DATABASE_URL não estiver
 * definida ou não puder ser comprovada como local, aborta.
 *
 * Nunca imprime a URL completa nem a senha. Apenas campos sanitizados.
 */

export const LOCAL_MARKER = "MJ1A_V_ENV_CI_LOCAL_V1";

export type PreflightAccepted = {
  ok: true;
  protocol: string;
  host: string;
  port: number;
  database: string;
  user: string;
};

export type PreflightRejected = {
  ok: false;
  reason: string;
  protocol: string | null;
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
};

export type PreflightResult = PreflightAccepted | PreflightRejected;

const ALLOWED_PROTOCOLS = new Set(["postgresql:", "postgres:"]);
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const REQUIRED_PORT = 54322;
const REQUIRED_DATABASE = "postgres";
const REQUIRED_USER = "postgres";

// Domínios remotos do Supabase que jamais podem aparecer.
const REMOTE_DOMAIN_SUFFIXES = [
  ".supabase.co",
  ".supabase.com",
  ".supabase.net",
  ".pooler.supabase.com",
];

function reject(
  reason: string,
  fields: Partial<Omit<PreflightRejected, "ok" | "reason">> = {},
): PreflightRejected {
  return {
    ok: false,
    reason,
    protocol: fields.protocol ?? null,
    host: fields.host ?? null,
    port: fields.port ?? null,
    database: fields.database ?? null,
    user: fields.user ?? null,
  };
}

function sanitizeHost(raw: string | null): string | null {
  if (raw === null) return null;
  // URL parser retorna IPv6 entre colchetes em url.hostname? Não: hostname já vem sem colchetes.
  return raw.toLowerCase();
}

function isRemoteHost(host: string): boolean {
  for (const suffix of REMOTE_DOMAIN_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Parse puro. Não abre socket. Não lê fallback.
 */
export function validateTestDatabaseUrlPreflight(
  raw: string | undefined | null,
): PreflightResult {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return reject("TEST_DATABASE_URL ausente ou vazio");
  }

  // Bloqueia fallbacks explicitamente detectáveis: se o valor for igual a outras
  // variáveis produtivas conhecidas, ainda assim rejeitamos pelo próprio conteúdo.
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return reject("URL malformada");
  }

  const protocol = parsed.protocol;
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    return reject("Protocolo inválido: exige postgresql: ou postgres:", {
      protocol,
    });
  }

  const host = sanitizeHost(parsed.hostname || null);
  if (!host) {
    return reject("Hostname ausente", { protocol });
  }

  if (isRemoteHost(host)) {
    return reject("Hostname remoto proibido (Supabase remoto/pooler)", {
      protocol,
      host,
    });
  }

  if (!ALLOWED_HOSTS.has(host)) {
    return reject("Hostname não-local (exige 127.0.0.1, localhost ou ::1)", {
      protocol,
      host,
    });
  }

  const portStr = parsed.port;
  if (!portStr) {
    return reject("Porta ausente", { protocol, host });
  }
  const port = Number.parseInt(portStr, 10);
  if (!Number.isFinite(port) || port <= 0) {
    return reject("Porta inválida", { protocol, host });
  }
  if (port !== REQUIRED_PORT) {
    return reject(`Porta inesperada: exige ${REQUIRED_PORT}`, {
      protocol,
      host,
      port,
    });
  }

  // pathname vem como "/postgres" — remove a barra.
  const database = parsed.pathname.replace(/^\/+/, "");
  if (!database) {
    return reject("Database ausente", { protocol, host, port });
  }
  if (database !== REQUIRED_DATABASE) {
    return reject(`Database inesperado: exige ${REQUIRED_DATABASE}`, {
      protocol,
      host,
      port,
      database,
    });
  }

  const user = parsed.username;
  if (!user) {
    return reject("Usuário ausente", { protocol, host, port, database });
  }
  if (user !== REQUIRED_USER) {
    return reject(`Usuário inesperado: exige ${REQUIRED_USER}`, {
      protocol,
      host,
      port,
      database,
      user,
    });
  }

  return {
    ok: true,
    protocol,
    host,
    port,
    database,
    user,
  };
}

export function formatPreflightResult(r: PreflightResult): string {
  if (r.ok) {
    return `guard preflight OK protocol=${r.protocol} host=${r.host} port=${r.port} database=${r.database} user=${r.user}`;
  }
  return `guard preflight REJECT reason="${r.reason}" protocol=${r.protocol ?? "-"} host=${r.host ?? "-"} port=${r.port ?? "-"} database=${r.database ?? "-"} user=${r.user ?? "-"}`;
}

/**
 * Postflight: recebe um pg.Client já conectado (via harness) e prova que
 * estamos no banco local com o marker sintético presente.
 *
 * Usa `any` para não amarrar este arquivo ao tipo do pg — o driver é
 * devDependency e não deve vazar para bundles produtivos.
 */
export type PostflightAccepted = {
  ok: true;
  database: string;
  user: string;
  serverAddr: string | null;
  serverPort: number | null;
  backendPid: number;
  marker: string;
};

export type PostflightRejected = {
  ok: false;
  reason: string;
};

export type PostflightResult = PostflightAccepted | PostflightRejected;

const ALLOWED_SERVER_ADDR_PREFIXES = [
  "127.",
  "10.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",
];

function isPrivateOrLoopbackAddr(addr: string | null): boolean {
  if (addr === null || addr === "") return true; // Unix socket: aceitável
  if (addr === "::1") return true;
  for (const p of ALLOWED_SERVER_ADDR_PREFIXES) {
    if (addr.startsWith(p)) return true;
  }
  return false;
}

export async function validateConnectionPostflight(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { query: (sql: string) => Promise<{ rows: any[] }> },
): Promise<PostflightResult> {
  const identity = await client.query(
    "select current_database() as db, current_user as usr, inet_server_addr()::text as addr, inet_server_port() as port, pg_backend_pid() as pid",
  );
  const row = identity.rows[0] ?? {};
  const db = String(row.db ?? "");
  const usr = String(row.usr ?? "");
  const addr = row.addr === null || row.addr === undefined ? null : String(row.addr);
  const port =
    row.port === null || row.port === undefined ? null : Number(row.port);
  const pid = Number(row.pid);

  if (db !== REQUIRED_DATABASE) {
    return { ok: false, reason: `current_database inesperado: ${db}` };
  }
  if (usr !== REQUIRED_USER) {
    return { ok: false, reason: `current_user inesperado: ${usr}` };
  }
  if (!isPrivateOrLoopbackAddr(addr)) {
    return { ok: false, reason: `inet_server_addr público proibido: ${addr}` };
  }
  if (port !== null && (!Number.isFinite(port) || port <= 0)) {
    return { ok: false, reason: `inet_server_port inválido: ${port}` };
  }

  // Marker sintético: o schema/tabela é criado pelo seed. Ausência = ambiente errado.
  let markerRow: { rows: { marker?: string }[] };
  try {
    markerRow = await client.query(
      "select marker from jarvys_test_meta.local_marker limit 1",
    );
  } catch {
    return {
      ok: false,
      reason: "marker ausente: jarvys_test_meta.local_marker inacessível",
    };
  }
  const marker = markerRow.rows[0]?.marker ?? "";
  if (marker !== LOCAL_MARKER) {
    return { ok: false, reason: `marker divergente: ${marker || "vazio"}` };
  }

  return {
    ok: true,
    database: db,
    user: usr,
    serverAddr: addr,
    serverPort: port,
    backendPid: pid,
    marker,
  };
}

export function formatPostflightResult(r: PostflightResult): string {
  if (r.ok) {
    return `guard postflight OK database=${r.database} user=${r.user} server_addr=${r.serverAddr ?? "-"} server_port=${r.serverPort ?? "-"} backend_pid=${r.backendPid} marker=${r.marker}`;
  }
  return `guard postflight REJECT reason="${r.reason}"`;
}
