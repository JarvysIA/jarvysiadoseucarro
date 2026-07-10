// Server-only helpers for WhatsApp link code request flow (Build 5.7C1).
// Do NOT import from client code. Handles CSPRNG code generation and hashing.
import { createHash, randomInt, randomUUID } from "crypto";

export const LINK_CODE_TTL_SECONDS = 600;
export const LINK_CODE_MAX_ATTEMPTS = 5;
export const OUTBOUND_MAX_ATTEMPTS = 2;
export const OUTBOUND_PRIORITY = 100;

export const COOLDOWN_SECONDS = 60;
export const HOURLY_PHONE_LIMIT = 5;
export const DAILY_USER_LIMIT = 10;

export function generateSixDigitCode(): string {
  // CSPRNG — never Math.random.
  const n = randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

export function newVerificationId(): string {
  return randomUUID();
}

export function hashLinkCode(
  pepper: string,
  verificationId: string,
  code: string,
): string {
  const SEP = "\x1f";
  return createHash("sha256")
    .update(pepper + SEP + verificationId + SEP + code)
    .digest("hex");
}

export function maskPhone(phone: string): string {
  if (!phone) return "***";
  if (phone.length < 8) return "***";
  const head = phone.slice(0, Math.min(6, phone.length - 4));
  const tail = phone.slice(-4);
  const middle = "*".repeat(Math.max(0, phone.length - head.length - tail.length));
  return `${head}${middle}${tail}`;
}

export function buildLinkCodeMessage(code: string): string {
  return `Seu código de verificação do Jarvys é: ${code}. Ele expira em 10 minutos. Não compartilhe este código.`;
}
