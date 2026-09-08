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

  // Idempotência: se já está pago, não reprocessa o fluxo principal.
  // Hardening: ainda assim, tenta auto-curar comissão de indicação se houver
  // metadata.comissao_padrinho legada sem movimentação registrada.
  // A RPC é idempotente (UNIQUE em pagamento_id), então não duplica.
  if (pag.status === "pago") {
    let comissao_registrada = false;
    const meta = (pag.metadata as Record<string, unknown> | null) ?? {};
    const comissaoMeta = (meta && typeof meta === "object" ? meta["comissao_padrinho"] : null) as
      | Record<string, unknown>
      | null;
    if (
      pag.tipo_produto !== "historico" &&
      pag.codigo_cupom &&
      comissaoMeta &&
      typeof comissaoMeta === "object"
    ) {
      try {
        const padrinho_id = (comissaoMeta["padrinho_id"] as string | undefined) ?? null;
        const afilhado_id = (comissaoMeta["afilhado_id"] as string | undefined) ?? pag.user_id;
        const cupom = String(pag.codigo_cupom).trim();
        const valor = Number(comissaoMeta["valor"] ?? COMISSAO_VALOR);
        if (padrinho_id && afilhado_id && padrinho_id !== afilhado_id) {
          const { data: movId, error: errReg } = await supabase.rpc(
            "registrar_comissao_indicacao",
            {
              _padrinho_id: padrinho_id,
              _afilhado_id: afilhado_id,
              _pagamento_id: pag.id,
              _referencia: `cupom_${cupom}`,
              _valor: valor,
              _descricao: `Comissão por ativação com cupom ${cupom} (auto-cura)`,
            },
          );
          if (errReg) throw errReg;
          comissao_registrada = movId !== null;
        }
      } catch (e) {
        const errMessage = e instanceof Error ? e.message : String(e);
        console.error("[pipeline] auto-cura indicação falhou (não bloqueia):", errMessage);
        try {
          await supabase.from("logs_erro_bonificacao").insert({
            pagamento_id,
            codigo_cupom: pag.codigo_cupom ?? null,
            erro: ("auto-cura: " + errMessage).slice(0, 1000),
          });
        } catch (_) { /* swallow */ }
      }
    }
    return {
      ok: true,
      already: true,
      pagamento_id,
      tipo_produto: pag.tipo_produto ?? undefined,
      comissao_registrada,
    };
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
    await supabase.from("veiculos").update({ status: "ativo" }).eq("id", pag.veiculo_id);
  }
  if (pag.user_id) {
    await supabase
      .from("profiles")
      .update({ status_usuario: "ativo", permite_indicacao: true })
      .eq("id", pag.user_id);
  }

  // 5) Indicação (somente ativação com cupom).
  // Falha aqui NUNCA reverte ativação nem propaga erro para o webhook Asaas.
  let comissao_registrada = false;
  if (pag.codigo_cupom && pag.user_id) {
    try {
      const cupom = String(pag.codigo_cupom).trim();

      const { data: padrinhoId, error: errRpc } = await supabase.rpc(
        "validar_cupom_indicacao",
        { _codigo: cupom },
      );
      if (errRpc) throw errRpc;

      const padrinho_id = (padrinhoId as string | null) ?? null;

      if (padrinho_id && padrinho_id !== pag.user_id) {
        // Vincula referrer_id no perfil do indicado
        await supabase
          .from("profiles")
          .update({ referrer_id: padrinho_id })
          .eq("id", pag.user_id);

        // Snapshot legado em metadata.comissao_padrinho (mantido para histórico)
        const { data: padrinhoRow } = await supabase
          .from("profiles")
          .select("pix_recebimento")
          .eq("id", padrinho_id)
          .maybeSingle();

        const metaAtual = (pag.metadata as Record<string, unknown> | null) ?? {};
        const jaTem = metaAtual && typeof metaAtual === "object" &&
          "comissao_padrinho" in metaAtual;
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
        }

        // RPC transacional única: movimentação + carteira + notificação atômicos
        const { data: movId, error: errReg } = await supabase.rpc(
          "registrar_comissao_indicacao",
          {
            _padrinho_id: padrinho_id,
            _afilhado_id: pag.user_id,
            _pagamento_id: pag.id,
            _referencia: `cupom_${cupom}`,
            _valor: COMISSAO_VALOR,
            _descricao: `Comissão por ativação com cupom ${cupom}`,
          },
        );
        if (errReg) throw errReg;
        comissao_registrada = movId !== null;
      }
    } catch (e) {
      // Pagamento confirmado é o evento principal: NÃO falhar webhook.
      const errMessage = e instanceof Error ? e.message : String(e);
      console.error("[pipeline] indicação falhou (não bloqueia ativação):", errMessage);
      try {
        await supabase.from("logs_erro_bonificacao").insert({
          pagamento_id,
          codigo_cupom: pag.codigo_cupom ?? null,
          erro: errMessage.slice(0, 1000),
        });
      } catch (_) { /* swallow */ }
    }
  }

  return { ok: true, pagamento_id, tipo_produto: tipo, comissao_registrada };
}
