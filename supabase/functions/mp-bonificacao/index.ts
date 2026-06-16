// Edge Function: mp-bonificacao
// Transfere bonificação ao padrinho via POST /v1/transfers do Mercado Pago,
// usando X-Idempotency-Key derivada do pagamento (evita duplicidade).
// Bloqueia auto-referral (padrinho == pagador) e exige permite_indicacao=true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALOR_BONIFICACAO = Number(Deno.env.get("MP_BONIFICACAO_VALOR") ?? "5.00");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let pagamento_id: string | null = null;
  try {
    const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!token) return json({ error: "token ausente" }, 500);

    const body = await req.json();
    pagamento_id = body?.pagamento_id ?? null;
    if (!pagamento_id) return json({ error: "pagamento_id obrigatório" }, 400);

    const { data: pag, error: pagErr } = await supabase
      .from("pagamentos_pix")
      .select("id, user_id, codigo_cupom, valor, status, metadata")
      .eq("id", pagamento_id)
      .maybeSingle();

    if (pagErr || !pag) {
      return json({ error: "pagamento não encontrado", details: pagErr?.message }, 404);
    }
    if (pag.status !== "pago") return json({ error: "pagamento não está pago" }, 400);
    if (!pag.codigo_cupom) return json({ ok: true, skipped: "sem cupom" });

    // Já bonificado? (idempotência lógica)
    if ((pag.metadata as Record<string, unknown> | null)?.bonificacao_status === "ok") {
      return json({ ok: true, skipped: "já bonificado" });
    }

    // Localiza padrinho pelo código
    const { data: padrinho } = await supabase
      .from("profiles")
      .select("id, permite_indicacao, chave_pix, codigo_indicacao")
      .filter("codigo_indicacao", "ilike", pag.codigo_cupom)
      .maybeSingle();

    const logErro = async (erro: string, efi_response: unknown = null) => {
      await supabase.from("logs_erro_bonificacao").insert({
        pagamento_id: pag.id,
        padrinho_id: padrinho?.id ?? null,
        codigo_cupom: pag.codigo_cupom,
        valor: VALOR_BONIFICACAO,
        chave_pix: (padrinho as { chave_pix?: string } | null)?.chave_pix ?? null,
        erro,
        efi_response: efi_response as never,
      });
    };

    if (!padrinho) {
      await logErro("padrinho não encontrado");
      return json({ error: "padrinho não encontrado" }, 404);
    }

    // ANTI AUTO-REFERRAL
    if (padrinho.id === pag.user_id) {
      await logErro("auto-referral bloqueado");
      return json({ error: "auto-referral bloqueado" }, 403);
    }
    if (!padrinho.permite_indicacao) {
      await logErro("padrinho não autorizado a receber bonificação");
      return json({ error: "padrinho sem permissão" }, 403);
    }

    const chavePix = (padrinho as { chave_pix?: string }).chave_pix;
    if (!chavePix) {
      await logErro("padrinho sem chave_pix cadastrada");
      return json({ error: "padrinho sem chave_pix" }, 400);
    }

    // Idempotency-Key derivada do pagamento + padrinho
    const idemKey = `bonif-${pag.id}-${padrinho.id}`;

    const mpRes = await fetch("https://api.mercadopago.com/v1/transfers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idemKey,
      },
      body: JSON.stringify({
        amount: Number(VALOR_BONIFICACAO.toFixed(2)),
        currency_id: "BRL",
        description: `Bonificação indicação Jarvys (${pag.codigo_cupom})`,
        receiver: { pix_key: chavePix },
      }),
    });

    const mpData = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok) {
      await logErro(`MP transfer erro ${mpRes.status}`, mpData);
      return json({ error: "falha transfer MP", details: mpData }, 502);
    }

    await supabase
      .from("pagamentos_pix")
      .update({
        metadata: {
          ...(pag.metadata ?? {}),
          bonificacao_status: "ok",
          bonificacao_transfer_id: mpData?.id ?? null,
          bonificacao_padrinho_id: padrinho.id,
          bonificacao_idempotency_key: idemKey,
        },
      })
      .eq("id", pag.id);

    return json({ ok: true, transfer_id: mpData?.id ?? null });
  } catch (e) {
    console.error("[mp-bonificacao] erro:", e);
    try {
      if (pagamento_id) {
        await supabase.from("logs_erro_bonificacao").insert({
          pagamento_id,
          erro: String((e as Error)?.message ?? e),
        });
      }
    } catch { /* noop */ }
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
