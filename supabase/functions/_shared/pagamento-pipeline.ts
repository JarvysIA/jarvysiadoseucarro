// Pipeline pós-pagamento idempotente (Asaas).
// Único ponto de verdade chamado por asaas-webhook e verificar-pagamentos-asaas.
// Escopo desta fase: marcar pago, ativação, histórico, vínculo de indicação
// e registro da comissão pendente em metadata.comissao_padrinho.
// NÃO envia PIX, NÃO grava logs_erro_bonificacao, NÃO altera nada fora desses passos.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const COMISSAO_VALOR = 5.0;

export interface ConfirmarPagamentoInput {
  supabase: SupabaseClient;
  pagamento_id: string;
}

export interface ConfirmarPagamentoResult {
  ok: boolean;
  already?: boolean;
  pagamento_id: string;
  tipo_produto?: string;
  comissao_registrada?: boolean;
}

export async function confirmarPagamento(
  { supabase, pagamento_id }: ConfirmarPagamentoInput,
): Promise<ConfirmarPagamentoResult> {
  // 1) Carrega o pagamento
  const { data: pag, error: errSel } = await supabase
    .from("pagamentos_pix")
    .select(
      "id, user_id, veiculo_id, valor, codigo_cupom, tipo_produto, produto_ref_id, status, metadata",
    )
    .eq("id", pagamento_id)
    .maybeSingle();

  if (errSel) throw errSel;
  if (!pag) throw new Error(`pagamento ${pagamento_id} não encontrado`);

  // Idempotência: se já está pago, não reprocessa
  if (pag.status === "pago") {
    return { ok: true, already: true, pagamento_id, tipo_produto: pag.tipo_produto ?? undefined };
  }

  const tipo = pag.tipo_produto === "historico" ? "historico" : "ativacao";

  // 2) Marca como pago
  const { error: errUpd } = await supabase
    .from("pagamentos_pix")
    .update({ status: "pago", data_pagamento: new Date().toISOString() })
    .eq("id", pag.id);
  if (errUpd) throw errUpd;

  // 3) Histórico premium
  if (tipo === "historico") {
    const alvo = pag.produto_ref_id ?? pag.veiculo_id;
    if (alvo) {
      await supabase.from("veiculos").update({ history_locked: false }).eq("id", alvo);
    }
    return { ok: true, pagamento_id, tipo_produto: tipo };
  }

  // 4) Ativação
  if (pag.veiculo_id) {
    await supabase.from("veiculos").update({ status: "active" }).eq("id", pag.veiculo_id);
  }
  if (pag.user_id) {
    await supabase
      .from("profiles")
      .update({ status_usuario: "ativo", permite_indicacao: true })
      .eq("id", pag.user_id);
  }

  // 5) Indicação (somente ativação com cupom)
  let comissao_registrada = false;
  if (pag.codigo_cupom && pag.user_id) {
    const cupom = String(pag.codigo_cupom).trim();

    // Fonte autoritativa do padrinho
    const { data: padrinhoId, error: errRpc } = await supabase.rpc(
      "validar_cupom_indicacao",
      { _codigo: cupom },
    );
    if (errRpc) {
      console.error("[pipeline] validar_cupom_indicacao falhou:", errRpc);
    }

    const padrinho_id = (padrinhoId as string | null) ?? null;

    if (padrinho_id && padrinho_id !== pag.user_id) {
      // Vincula referrer_id no perfil do indicado
      await supabase
        .from("profiles")
        .update({ referrer_id: padrinho_id })
        .eq("id", pag.user_id);

      // Snapshot da chave PIX do padrinho (informativo; sem envio)
      const { data: padrinhoRow } = await supabase
        .from("profiles")
        .select("pix_recebimento")
        .eq("id", padrinho_id)
        .maybeSingle();

      const metaAtual = (pag.metadata as Record<string, unknown> | null) ?? {};
      const jaTem = metaAtual && typeof metaAtual === "object" && "comissao_padrinho" in metaAtual;

      if (!jaTem) {
        const novoMeta = {
          ...metaAtual,
          comissao_padrinho: {
            padrinho_id,
            afilhado_id: pag.user_id,
            pagamento_id: pag.id,
            codigo_cupom: cupom,
            valor: COMISSAO_VALOR,
            chave_pix: padrinhoRow?.pix_recebimento ?? null,
            status: "pendente",
            registrada_em: new Date().toISOString(),
          },
        };
        await supabase
          .from("pagamentos_pix")
          .update({ metadata: novoMeta })
          .eq("id", pag.id);
        comissao_registrada = true;
      }
    }
  }

  return { ok: true, pagamento_id, tipo_produto: tipo, comissao_registrada };
}
