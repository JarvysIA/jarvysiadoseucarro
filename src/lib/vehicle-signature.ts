export type VehicleSignatureInput = {
  codigoFipe?: string | null;
  anoModelo?: number | string | null;
};

export function normalizeAnoModelo(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  let parsed: number | null = null;

  if (typeof value === "number") {
    parsed = Number.isFinite(value) ? Math.trunc(value) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    // Handle formats like "2010/2011" by extracting the last valid year
    const parts = trimmed.split(/\s*[\/,-]\s*/);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i].trim();
      const num = Number(part);
      if (Number.isInteger(num) && num >= 1900 && num <= 2100) {
        parsed = num;
        break;
      }
    }

    if (parsed === null) {
      const num = Number(trimmed);
      if (Number.isInteger(num) && num >= 1900 && num <= 2100) {
        parsed = num;
      }
    }
  }

  if (parsed !== null && parsed >= 1900 && parsed <= 2100) {
    return parsed;
  }

  return null;
}

export function buildVehicleSignature(
  input: VehicleSignatureInput
): string | null {
  const codigoFipe = input.codigoFipe?.trim() ?? "";
  if (!codigoFipe) {
    return null;
  }

  const anoModelo = normalizeAnoModelo(input.anoModelo);

  if (anoModelo === null) {
    // Decision for Build 3.1: when anoModelo is invalid/absent,
    // return only the codigoFipe without the pipe separator.
    return codigoFipe;
  }

  return `${codigoFipe}|${anoModelo}`;
}
