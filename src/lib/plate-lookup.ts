import type { PlateLookupResult } from "@/components/CarConfirmModal";
import { lookupPlateFn } from "./plate-lookup.functions";
import type { FipeHistoricoItem, FipeOption } from "./plate-lookup.functions";

export type PlateLookupFullResult =
  | (NonNullable<PlateLookupResult> & {
      fipe?: {
        codigo_fipe: string;
        valor: number;
        mes_referencia: string;
        historico: FipeHistoricoItem[];
      } | null;
      fipe_options?: FipeOption[];
    })
  | null;

/**
 * Consulta a placa via API PuxaPlaca (server fn — CORS/token).
 */
export async function lookupPlate(placa: string): Promise<PlateLookupFullResult> {
  try {
    const res = await lookupPlateFn({ data: { placa } });
    console.log("[PuxaPlaca]", res);
    if (!res.ok || !res.data) return null;
    return {
      marca: res.data.marca,
      modelo: res.data.modelo,
      ano: res.data.ano,
      cor: res.data.cor,
      motorizacao: res.data.motorizacao,
      chassi: res.data.chassi,
      fipe: res.data.fipe ?? null,
      fipe_options: (res.data as any).fipe_options ?? [],
    };
  } catch (e) {
    console.error("[PuxaPlaca] erro:", e);
    return null;
  }
}

/** Limpa e normaliza a placa: maiúsculas, apenas A-Z0-9, máx 7 chars. */
export function sanitizePlate(value: string): string {
  return (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
}

/** Aceita placa antiga (AAA0000) ou Mercosul (AAA0A00). */
export const PLATE_REGEX = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;

export function isValidPlate(value: string): boolean {
  return PLATE_REGEX.test(sanitizePlate(value));
}
