// Security-Audit-Fixes: lógica pura de unlockHistory, separada de
// vehicles.functions.ts (que importa createServerFn/requireSupabaseAuth,
// os quais puxam @supabase/supabase-js) — mesmo motivo de
// saque-padrinho.ts ser um módulo à parte de admin-users.functions.ts:
// permite testar via DI sem depender de um módulo ausente no sandbox.

type VeiculoOwnerRow = { user_id: string };
type VeiculoSelectBuilder = {
  eq(column: string, value: unknown): VeiculoSelectBuilder;
  maybeSingle(): PromiseLike<{ data: VeiculoOwnerRow | null; error: { message: string } | null }>;
};
type VeiculoUpdateBuilder = {
  eq(column: string, value: unknown): PromiseLike<{ error: { message: string } | null }>;
};

type PagamentoRow = { id: string };
type PagamentoSelectBuilder = {
  eq(column: string, value: unknown): PagamentoSelectBuilder;
  limit(n: number): PagamentoSelectBuilder;
  maybeSingle(): PromiseLike<{ data: PagamentoRow | null; error: { message: string } | null }>;
};

export type UnlockHistoryClient = {
  from(table: "veiculos"): {
    select(columns: string): VeiculoSelectBuilder;
    update(row: { history_locked: boolean }): VeiculoUpdateBuilder;
  };
  from(table: "pagamentos_pix"): {
    select(columns: string): PagamentoSelectBuilder;
  };
};

export type UnlockHistoryResult = { ok: true } | { ok: false; erro: string };

/**
 * Destrava o histórico do veículo resgatado (Carfax Reverso paywall).
 *
 * Security-Audit-Fixes: antes só validava ownership e setava
 * history_locked=false direto, sem checar se o Histórico Premium R$49,90
 * foi de fato pago — mesma classe de bypass do achado C3 (RLS/trigger não
 * protegem essa coluna), só que pelo caminho HTTP em vez de REST direto.
 * Agora exige uma linha em pagamentos_pix com status='pago',
 * tipo_produto='historico' e veiculo_id = este veículo antes de destravar.
 *
 * Nota (investigação pós-build, antes de aprovar): unlockHistoryFn (o
 * createServerFn que chama esta função) não tem NENHUM call-site no
 * frontend hoje — busca em todo src/ não encontrou nenhum componente que
 * o invoque. O desbloqueio real em produção acontece inteiramente no
 * servidor, via confirmarPagamento() em
 * supabase/functions/_shared/pagamento-pipeline.ts, chamado pelo webhook
 * Asaas/verificar-pagamentos-asaas com service_role — que já resolve
 * `pag.produto_ref_id ?? pag.veiculo_id` e não passa por esta função.
 * unlockHistoryFn permanece como endpoint HTTP autenticado alcançável
 * mesmo sem botão na UI (createServerFn expõe uma rota), então o fix
 * continua válido como defesa em profundidade — só não é hoje o caminho
 * que desbloqueia o Porta-Luvas Digital pra usuários reais.
 *
 * Por que checar só veiculo_id (sem produto_ref_id) aqui é suficiente:
 * CheckoutPremiumModal.tsx é o ÚNICO lugar em todo o código (frontend ou
 * edge functions) que cria um pagamento tipo_produto='historico' — e ele
 * sempre envia veiculo_id e produto_ref_id com o MESMO valor (o
 * vehicleId do checkout). gerar-pix-asaas ainda reforça isso com um
 * fallback (`body.produto_ref_id ?? veiculo_id`) caso produto_ref_id
 * venha ausente. Não existe nenhum outro criador de pagamento
 * 'historico' com produto_ref_id divergente de veiculo_id — inclusive no
 * "caminho antigo" (veículos com placas repetidas em linhas/ids
 * diferentes, mencionado em hasPremiumHistoryAvailableFn), o desbloqueio
 * sempre mira a linha ATUAL do usuário (mesmo id usado no checkout, no
 * pagamento e neste check), nunca uma linha antiga de outro dono.
 */
export async function unlockHistory(
  vehicleId: string,
  userId: string,
  client: UnlockHistoryClient,
): Promise<UnlockHistoryResult> {
  const { data: row, error } = await client
    .from("veiculos")
    .select("user_id")
    .eq("id", vehicleId)
    .maybeSingle();
  if (error) return { ok: false, erro: error.message };
  if (!row || row.user_id !== userId) return { ok: false, erro: "Acesso negado." };

  const { data: pay, error: payErr } = await client
    .from("pagamentos_pix")
    .select("id")
    .eq("user_id", userId)
    .eq("veiculo_id", vehicleId)
    .eq("status", "pago")
    .eq("tipo_produto", "historico")
    .limit(1)
    .maybeSingle();
  if (payErr) return { ok: false, erro: payErr.message };
  if (!pay) return { ok: false, erro: "Pagamento do Histórico Premium não encontrado para este veículo." };

  const { error: upErr } = await client
    .from("veiculos")
    .update({ history_locked: false })
    .eq("id", vehicleId);
  if (upErr) return { ok: false, erro: upErr.message };
  return { ok: true };
}
