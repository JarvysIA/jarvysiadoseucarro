/**
 * Remove TAGs entre colchetes da string para exibição visual.
 *
 * CRÍTICO: Esta função é PURAMENTE VISUAL. O estado React e o payload salvo
 * no Supabase DEVEM manter a string original com as tags (ex: "6x Paraflu
 * [arrefecimento]"), pois o banco depende delas para acionar a trigger
 * `atualizar_revisao_veiculo`. Use apenas no JSX de renderização.
 */
export function formatItemName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\s*\[.*?\]\s*/g, " ").replace(/\s+/g, " ").trim();
}
