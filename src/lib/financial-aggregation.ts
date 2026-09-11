// Financial-Dashboard: agregação pura usada por getFinancialSummaryFn.
// Vive fora de admin-users.functions.ts (que importa requireSupabaseAuth,
// e por tabela transitiva @supabase/supabase-js no topo do arquivo) pra
// poder ser testada sem cair no mesmo erro de resolução de módulo que
// quebra o carregamento do arquivo neste sandbox — mesmo precedente de
// audit-log.ts / ai-usage-tracking.ts / vehicle-image-cache.ts.

export function aggregateRevenueByType(
  rows: { tipo_produto: string; valor: number }[],
): { tipo: string; valor: number }[] {
  const byType = new Map<string, number>();
  for (const r of rows) {
    byType.set(r.tipo_produto, (byType.get(r.tipo_produto) ?? 0) + r.valor);
  }
  return Array.from(byType.entries()).map(([tipo, valor]) => ({ tipo, valor }));
}

export function aggregateAiUsageByType(
  rows: { event_type: string }[],
): { tipo: string; count: number }[] {
  const byType = new Map<string, number>();
  for (const r of rows) {
    byType.set(r.event_type, (byType.get(r.event_type) ?? 0) + 1);
  }
  return Array.from(byType.entries()).map(([tipo, count]) => ({ tipo, count }));
}

export function currentMonthCompetencia(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function nextMonthStart(competencia: string): string {
  const [y, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(y as number, m as number, 1)).toISOString().slice(0, 10);
}
