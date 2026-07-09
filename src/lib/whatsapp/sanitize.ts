/**
 * Sanitização de payload WhatsApp (Build 5.3).
 * Nunca lança. Remove chaves sensíveis, limita profundidade e trunca strings.
 */

const SENSITIVE_KEYS = new Set([
  "token",
  "authorization",
  "auth",
  "secret",
  "password",
  "instancetoken",
  "clienttoken",
  "apikey",
  "key",
  "headers",
  "cookie",
  "cookies",
]);

const MAX_DEPTH = 6;
const MAX_STRING = 2000;
const MAX_ARRAY = 50;
const MAX_KEYS = 100;

function truncateString(value: string): string {
  if (value.length <= MAX_STRING) return value;
  return `${value.slice(0, MAX_STRING)}…[truncated]`;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[max-depth]";
  if (value == null) return value;
  const t = typeof value;
  if (t === "string") return truncateString(value as string);
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return `${(value as bigint).toString()}n`;
  if (t === "function" || t === "symbol") return "[unsupported]";

  if (Array.isArray(value)) {
    const arr = value.slice(0, MAX_ARRAY).map((v) => sanitizeValue(v, depth + 1));
    if (value.length > MAX_ARRAY) arr.push(`[+${value.length - MAX_ARRAY} truncated]`);
    return arr;
  }

  if (t === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) {
        out["__truncated__"] = true;
        break;
      }
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitizeValue(v, depth + 1);
      }
      count += 1;
    }
    return out;
  }

  return "[unknown]";
}

export function sanitizeWhatsappPayload(payload: unknown): Record<string, unknown> {
  try {
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
      return { value: sanitizeValue(payload, 0) };
    }
    const result = sanitizeValue(payload, 0);
    if (result && typeof result === "object" && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }
    return { value: result };
  } catch {
    return { error: "[sanitize-failed]" };
  }
}

/**
 * Mascarar telefone em logs. +5521999998888 -> +5521*****8888
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (phone == null) return null;
  const s = String(phone);
  if (s.length < 8) return "***";
  const head = s.slice(0, Math.min(6, s.length - 4));
  const tail = s.slice(-4);
  const middleLen = Math.max(0, s.length - head.length - tail.length);
  return `${head}${"*".repeat(middleLen)}${tail}`;
}
