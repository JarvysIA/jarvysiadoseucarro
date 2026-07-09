/**
 * Helpers puros de telefone (Build 5.3). Sem side effects.
 */

/**
 * Normaliza telefone brasileiro em E.164 (+55...). Conservador — retorna null
 * se input não parece um telefone válido. Nunca lança.
 */
export function normalizeBrazilPhoneToE164(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (raw === "") return null;

  const hadPlus = raw.startsWith("+");
  const digits = raw.replace(/\D+/g, "");
  if (digits === "") return null;

  // Se veio com '+', respeitar o país informado (após limpeza).
  if (hadPlus) {
    if (digits.length < 10 || digits.length > 15) return null;
    return `+${digits}`;
  }

  // 55 + DDD(2) + número(8|9) => 12 ou 13 dígitos.
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }

  // Sem 55: DDD(2) + número(8|9) => 10 ou 11 dígitos.
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  return null;
}

/**
 * true se a string parece estar em E.164: '+' seguido de 10..15 dígitos.
 */
export function isLikelyE164(phone: string | null | undefined): boolean {
  if (phone == null) return false;
  const s = String(phone);
  if (!s.startsWith("+")) return false;
  const digits = s.slice(1);
  if (digits.length < 10 || digits.length > 15) return false;
  return /^[0-9]+$/.test(digits);
}
