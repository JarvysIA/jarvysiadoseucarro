// Build 5.7F2D3A — Roteamento durável Legado ↔ Orquestrador.
// Módulo puro: sem I/O, sem banco, sem env, sem fetch, sem provider.
// Fonte única de detecção de opt-out e de decisão de ownership da fila.

export type RouteOwner = "legacy" | "orchestrator";

// Conjunto canônico de comandos de opt-out (match exato após normalização).
export const OPT_OUT_COMMANDS: ReadonlySet<string> = new Set([
  "SAIR",
  "PARAR",
  "CANCELAR",
  "NAO QUERO",
  "REMOVER",
  "STOP",
]);

const STRIP_ACCENTS_RE = /[\u0300-\u036f]/g;

// Normalização idêntica à do worker legado:
//   NFD → strip accents → uppercase → collapse spaces → trim.
export function normalizeForRouting(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(STRIP_ACCENTS_RE, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Match exato contra o conjunto canônico (sem substring).
export function isRoutingOptOut(text: string | null | undefined): boolean {
  const n = normalizeForRouting(text);
  if (n === "") return false;
  return OPT_OUT_COMMANDS.has(n);
}

export type RouteOwnerInput = {
  messageType: string | null | undefined;
  textBody: string | null | undefined;
  orchestratorMode: string | null | undefined;
};

// Decisão de ownership. Regras, nesta ordem:
//   1) messageType != 'text' → legacy   (mídia, audio, video, file, system, unknown, etc.)
//   2) opt-out reconhecido   → legacy   (opt-out permanece 100% no legado nesta fase)
//   3) orchestratorMode ∈ {'test','active'} → orchestrator
//   4) qualquer outro caso (off, shadow, null, desconhecido) → legacy (fallback seguro)
export function decideRouteOwner(input: RouteOwnerInput): RouteOwner {
  const messageType = (input.messageType ?? "").toString();
  if (messageType !== "text" && messageType !== "audio") return "legacy";

  if (isRoutingOptOut(input.textBody)) return "legacy";

  const mode = (input.orchestratorMode ?? "").toString();
  if (mode === "test" || mode === "active") return "orchestrator";

  return "legacy";
}
