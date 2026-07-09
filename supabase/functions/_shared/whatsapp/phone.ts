// Helpers de telefone Deno-friendly (Build 5.4B).
// Port dos helpers criados no Build 5.3 (src/lib/whatsapp/phone.ts + sanitize.ts).
// Nunca lança. Conservador.

export function normalizeBrazilPhoneToE164(
  input: string | null | undefined,
): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (raw === "") return null;

  // Remove sufixo Z-API tipo "@c.us" ou "@g.us" antes de olhar dígitos.
  const noSuffix = raw.split("@")[0] ?? raw;
  const hadPlus = noSuffix.startsWith("+");
  const digits = noSuffix.replace(/\D+/g, "");
  if (digits === "") return null;

  if (hadPlus) {
    if (digits.length < 10 || digits.length > 15) return null;
    return `+${digits}`;
  }

  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  return null;
}

export function isLikelyE164(phone: string | null | undefined): boolean {
  if (phone == null) return false;
  const s = String(phone);
  if (!s.startsWith("+")) return false;
  const digits = s.slice(1);
  if (digits.length < 10 || digits.length > 15) return false;
  return /^[0-9]+$/.test(digits);
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (phone == null) return null;
  const s = String(phone);
  if (s.length < 8) return "***";
  const head = s.slice(0, Math.min(6, s.length - 4));
  const tail = s.slice(-4);
  const middleLen = Math.max(0, s.length - head.length - tail.length);
  return `${head}${"*".repeat(middleLen)}${tail}`;
}
