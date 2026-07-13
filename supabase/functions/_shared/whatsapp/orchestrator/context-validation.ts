// Build 5.7F2E1A.5-MJ0.1 — Guards estruturais de contexto do orquestrador.
//
// Compartilhados entre Repository e Shadow para garantir semântica idêntica
// nas reasons profile_context_invalid e activations_context_invalid.
//
// Regras:
//   - Recebem `unknown`, nunca fazem cast.
//   - Não validam regras comerciais (status_usuario reconhecido, expiração de
//     trial etc.). Isso é responsabilidade de `computeWhatsappVehicleAccessMode`.
//   - Objeto null / não-plain-object é inválido.
//   - Strings vazias são consideradas inválidas onde exigidas.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Shape estrutural mínimo esperado em `public.profiles` para o classificador
 * de acesso ao WhatsApp por veículo. Não avalia valores comerciais.
 */
export type ValidProfileContextRow = {
  id: string;
  status_usuario: string;
  trial_inicio: string | null;
};

export function isValidProfileContextRow(
  value: unknown,
): value is ValidProfileContextRow {
  if (!isPlainObject(value)) return false;
  const { id, status_usuario, trial_inicio } = value;
  if (typeof id !== "string" || id.length === 0) return false;
  if (typeof status_usuario !== "string") return false;
  if (trial_inicio !== null && typeof trial_inicio !== "string") return false;
  return true;
}

/**
 * Shape estrutural mínimo esperado em cada linha de `public.pagamentos_pix`
 * carregada pelo context loader. Apenas `veiculo_id` é obrigatório.
 */
export type ValidActivationContextRow = {
  veiculo_id: string;
};

export function isValidActivationContextRow(
  value: unknown,
): value is ValidActivationContextRow {
  if (!isPlainObject(value)) return false;
  const { veiculo_id } = value;
  if (typeof veiculo_id !== "string" || veiculo_id.length === 0) return false;
  return true;
}
