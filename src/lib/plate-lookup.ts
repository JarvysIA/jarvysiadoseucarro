import type { PlateLookupResult } from "@/components/CarConfirmModal";

/**
 * Placeholder for real plate lookup (BrasilAPI/Puxa Placa).
 * Currently simulates a 1.6s scan and returns null so the modal
 * falls back to manual entry. Replace this function with a real
 * fetch when the API token is available.
 */
export async function lookupPlate(_plate: string): Promise<PlateLookupResult> {
  await new Promise((r) => setTimeout(r, 1600));
  return null;
}
