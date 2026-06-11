// Edge Function: efi-webhook
// Recebe notificações da Efí Bank quando uma cobrança PIX é paga.
// A Efí envia POST com body { pix: [{ txid, endToEndId, valor, horario, ... }] }.
// Para cada txid, marcamos o pagamento como 'pago' e ativamos a licença do veículo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PixItem {
  txid?: string;
  endToEndId?: string;
  valor?: string;
  horario?: string;
}

interface EfiWebhookPayload {
  pix?: PixItem[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // A Efí faz uma chamada de validação em GET/HEAD para o endpoint do webhook.
  if (req.method === "GET" || req.method === "HEAD") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const raw = await req.text();
    let payload: EfiWebhookPayload = {};
    try {
      payload = raw ? (JSON.parse(raw) as EfiWebhookPayload) : {};
    } catch (_) {
      console.warn("[efi-webhook] body não é JSON válido:", raw);
    }

    const pixArr = Array.isArray(payload.pix) ? payload.pix : [];
    console.log(`[efi-webhook] recebido ${pixArr.length} evento(s) pix`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    for (const item of pixArr) {
      const txid = item?.txid;
      if (!txid) {
        console.warn("[efi-webhook] item sem txid, ignorando", item);
        continue;
      }

      // Localiza o pagamento pelo txid
      const { data: pagamento, error: selErr } = await supabase
        .from("pagamentos_pix")
        .select("id, veiculo_id, status")
        .eq("txid_efi", txid)
        .maybeSingle();

      if (selErr) {
        console.error(`[efi-webhook] erro buscando txid ${txid}:`, selErr);
        continue;
      }
      if (!pagamento) {
        console.warn(`[efi-webhook] txid ${txid} não encontrado no banco`);
        continue;
      }

      // Marca o pagamento como pago
      const { error: updPagErr } = await supabase
        .from("pagamentos_pix")
        .update({ status: "pago" })
        .eq("id", pagamento.id);

      if (updPagErr) {
        console.error(
          `[efi-webhook] erro atualizando pagamento ${pagamento.id}:`,
          updPagErr,
        );
        continue;
      }

      // Ativa a licença no veículo correspondente
      if (pagamento.veiculo_id) {
        const { error: updVeiErr } = await supabase
          .from("veiculos")
          .update({ status: "ativo" })
          .eq("id", pagamento.veiculo_id);

        if (updVeiErr) {
          console.error(
            `[efi-webhook] erro ativando veículo ${pagamento.veiculo_id}:`,
            updVeiErr,
          );
        } else {
          console.log(
            `[efi-webhook] veículo ${pagamento.veiculo_id} ativado via txid ${txid}`,
          );
        }
      }
    }

    return new Response(JSON.stringify({ received: pixArr.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[efi-webhook] erro inesperado", err);
    // Mesmo em erro interno, respondemos 200 para evitar reentregas infinitas
    // enquanto investigamos — ajuste se quiser que a Efí refaça a chamada.
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
