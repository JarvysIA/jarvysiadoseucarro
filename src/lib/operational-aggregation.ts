// Operational-Monitoring: agregação pura usada por getOperationalHealthFn
// (contagem de pagamentos por status + detecção de 'pendente' travado).
// Vive fora de admin-users.functions.ts pelo mesmo motivo de
// financial-aggregation.ts: este último importa requireSupabaseAuth (->
// @supabase/supabase-js) no topo, o que quebra em runtime o carregamento
// de qualquer teste que importe diretamente dele neste sandbox.

export function aggregatePaymentsByStatus(
  rows: { status: string }[],
): { status: string; count: number }[] {
  const byStatus = new Map<string, number>();
  for (const r of rows) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  }
  return Array.from(byStatus.entries()).map(([status, count]) => ({ status, count }));
}

// 'pendente' com created_at mais de 1h atrás é sinal de possível
// travamento no fluxo de pagamento (o pagamento nunca confirmou nem
// expirou). now é parametrizável só pra teste determinístico.
export function countStuckPendingPayments(
  rows: { status: string; created_at: string }[],
  nowMs: number = Date.now(),
): number {
  const oneHourAgoMs = nowMs - 60 * 60 * 1000;
  return rows.filter(
    (r) => r.status === "pendente" && new Date(r.created_at).getTime() < oneHourAgoMs,
  ).length;
}
