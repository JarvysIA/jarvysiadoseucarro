/**
 * Utilitários puros de placa (sem rede, sem dependências externas).
 */

/** Limpa e normaliza a placa: maiúsculas, apenas A-Z0-9, máx 7 chars. */
export function sanitizePlate(value: string): string {
  return (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
}

/** Aceita placa antiga (AAA0000) ou Mercosul (AAA0A00). */
export const PLATE_REGEX = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;

export function isValidPlate(value: string): boolean {
  return PLATE_REGEX.test(sanitizePlate(value));
}
