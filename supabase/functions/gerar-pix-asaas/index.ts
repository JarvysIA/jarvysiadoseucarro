// Edge Function: gerar-pix-asaas
// Cria cobrança PIX na Asaas e persiste em pagamentos_pix.
// Reutiliza colunas existentes: txid_efi <- asaas_payment_id, pix_copia_cola <- payload.
// Secrets: ASAAS_API_KEY, ASAAS_ENV ("production" | "sandbox", default production).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PixRequest {
  user_id: string;
  veiculo_id: string;
  valor: number;
  codigo_cupom?: string | null;
  tipo_produto?: "ativacao" | "historico" | null;
  produto_ref_id?: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asaasBaseUrl(): string {
  const env = (Deno.env.get("ASAAS_ENV") ?? "production").toLowerCase();
  return env === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";
}

async function asaasFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetch(`${asaasBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      access_token: apiKey,
      "Content-Type": "application/json",
      "User-Agent": "Jarvys/1.0",
    },
  });
}

async function ensureCustomer(
  apiKey: string,
  supabase: ReturnType<typeof createClient>,
  user_id: string,
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("asaas_customer_id, nome, email, telefone, cpf")
    .eq("id", user_id)
    .maybeSingle();

  if (profile?.asaas_customer_id) return profile.asaas_customer_id as string;

  const body: Record<string, unknown> = {
    name: profile?.nome ?? "Cliente Jarvys",
    email: profile?.email ?? undefined,
    mobilePhone: profile?.telefone ?? undefined,
    cpfCnpj: profile?.cpf ?? undefined,
    externalReference: user_id,
  };

  const res = await asaasFetch(apiKey, "/customers", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Asaas /customers ${res.status}: ${JSON.stringify(raw)}`,
    );
  }
  const customerId = (raw as { id?: string }).id;
  if (!customerId) throw new Error("Asaas customer sem id");

  await supabase
    .from("profiles")
    .update({ asaas_customer_id: customerId })
    .eq("id", user_id);

  return customerId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { user_id, veiculo_id, valor, codigo_cupom, tipo_produto, produto_ref_id } =
      (await req.json()) as PixRequest;
    const tipo = tipo_produto === "historico" ? "historico" : "ativacao";

    if (!user_id || !veiculo_id || typeof valor !== "number" || valor <= 0) {
      return json({ error: "Parâmetros inválidos" }, 400);
    }

    const apiKey = Deno.env.get("ASAAS_API_KEY");
    if (!apiKey) return json({ error: "ASAAS_API_KEY ausente" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const asaas_customer_id = await ensureCustomer(apiKey, supabase, user_id);

    // dueDate = hoje (YYYY-MM-DD)
    const dueDate = new Date().toISOString().slice(0, 10);
    const description =
      tipo === "historico"
        ? "Histórico Premium Jarvys"
        : "Ativação Jarvys - Licença por veículo";

    const payRes = await asaasFetch(apiKey, "/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: asaas_customer_id,
        billingType: "PIX",
        value: Number(valor.toFixed(2)),
        dueDate,
        description,
        externalReference: `${user_id}:${veiculo_id}:${tipo}`,
      }),
    });
    const payJson = await payRes.json().catch(() => ({}));
    if (!payRes.ok) {
      throw new Error(`Asaas /payments ${payRes.status}: ${JSON.stringify(payJson)}`);
    }
    const asaas_payment_id = (payJson as { id?: string }).id;
    if (!asaas_payment_id) throw new Error("Asaas payment sem id");

    const qrRes = await asaasFetch(
      apiKey,
      `/payments/${encodeURIComponent(asaas_payment_id)}/pixQrCode`,
    );
    const qrJson = await qrRes.json().catch(() => ({}));
    if (!qrRes.ok) {
      throw new Error(`Asaas /pixQrCode ${qrRes.status}: ${JSON.stringify(qrJson)}`);
    }
    const payload = (qrJson as { payload?: string }).payload ?? "";
    if (!payload) throw new Error("Asaas pixQrCode sem payload");

    const { data: inserted, error: insertError } = await supabase
      .from("pagamentos_pix")
      .insert({
        user_id,
        veiculo_id,
        valor,
        codigo_cupom: codigo_cupom ?? null,
        tipo_produto: tipo,
        produto_ref_id: produto_ref_id ?? null,
        status: "pendente",
        txid_efi: asaas_payment_id,
        pix_copia_cola: payload,
        metadata: {
          gateway: "asaas",
          asaas_payment_id,
          asaas_customer_id,
        },
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    return json({
      success: true,
      id: inserted.id,
      pix_copia_cola: payload,
      txid_efi: asaas_payment_id,
    });
  } catch (err) {
    console.error("[gerar-pix-asaas]", err);
    return json(
      { error: err instanceof Error ? err.message : "Erro desconhecido" },
      500,
    );
  }
});
