// Sanitização de payload WhatsApp (Build 5.4B - Deno).
// Port do helper criado no Build 5.3. Nunca lança.

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

export function safeString(
  value: unknown,
  maxLength = 4000,
): string | null {
  if (value == null) return null;
  let s: string;
  if (typeof value === "string") s = value;
  else if (typeof value === "number" || typeof value === "boolean") s = String(value);
  else return null;
  s = s.trim();
  if (s === "") return null;
  if (s.length > maxLength) s = s.slice(0, maxLength);
  return s;
}
