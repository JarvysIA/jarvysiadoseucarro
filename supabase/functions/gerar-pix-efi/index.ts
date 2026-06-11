// Edge Function: gerar-pix-efi
// Gera cobrança PIX dinâmica via API da Efí Bank (mTLS) e persiste em pagamentos_pix.
// Variáveis de ambiente necessárias:
//   EFI_CLIENT_ID, EFI_CLIENT_SECRET, EFI_CERTIFICATE_BASE64
//   (opcional) EFI_PIX_KEY  -> chave PIX recebedora cadastrada na Efí
//   (opcional) EFI_ENV      -> "production" | "sandbox" (default: production)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injetadas automaticamente)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import forge from "https://esm.sh/node-forge@1.3.1";

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

/**
 * Converte um .p12 (base64) em { certPem, keyPem } PEM.
 * Tenta primeiro sem senha; se falhar, tenta com EFI_CERTIFICATE_PASSWORD (default "").
 */
function p12ToPem(base64: string, password = ""): { certPem: string; keyPem: string } {
  const der = forge.util.decode64(base64);
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);

  let certPem = "";
  let keyPem = "";

  for (const safeContents of p12.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) {
        certPem += forge.pki.certificateToPem(safeBag.cert);
      } else if (
        (safeBag.type === forge.pki.oids.keyBag ||
          safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag) &&
        safeBag.key
      ) {
        keyPem = forge.pki.privateKeyToPem(safeBag.key);
      }
    }
  }

  if (!certPem || !keyPem) {
    throw new Error("Não foi possível extrair certificado/chave do .p12");
  }
  return { certPem, keyPem };
}

async function authEfi(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  client: Deno.HttpClient,
): Promise<string> {
  const basic = btoa(`${clientId}:${clientSecret}`);
  // Escopos necessários para criar/consultar cobranças PIX na Efí.
  // Passar explicitamente evita 403 insufficient_scope quando o token
  // default vem sem permissões de cob.
  const scope =
    Deno.env.get("EFI_OAUTH_SCOPE") ??
    "cob.write cob.read pix.write pix.read";

  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    // @ts-ignore - Deno fetch aceita `client`
    client,
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      scope,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha auth Efí (${res.status}): ${t}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

async function criarCobranca(
  baseUrl: string,
  token: string,
  client: Deno.HttpClient,
  valor: number,
  chavePix: string,
): Promise<{ txid: string; pixCopiaECola: string }> {
  const body = {
    calendario: { expiracao: 3600 },
    valor: { original: valor.toFixed(2) },
    chave: chavePix,
    solicitacaoPagador: "Ativação Jarvys - Licença por veículo",
  };
  const res = await fetch(`${baseUrl}/v2/cob`, {
    method: "POST",
    // @ts-ignore
    client,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 201) {
    const t = await res.text();
    throw new Error(`Falha criar cobrança (${res.status}): ${t}`);
  }
  const cob = await res.json();
  return {
    txid: cob.txid,
    pixCopiaECola: cob.pixCopiaECola ?? cob.location ?? "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { user_id, veiculo_id, valor, codigo_cupom } =
      (await req.json()) as PixRequest;

    if (!user_id || !veiculo_id || typeof valor !== "number" || valor <= 0) {
      return json({ error: "Parâmetros inválidos" }, 400);
    }

    const clientId = Deno.env.get("EFI_CLIENT_ID");
    const clientSecret = Deno.env.get("EFI_CLIENT_SECRET");
    const certB64 = Deno.env.get("EFI_CERTIFICATE_BASE64");
    const certPassword = Deno.env.get("EFI_CERTIFICATE_PASSWORD") ?? "";
    const pixKey = Deno.env.get("EFI_PIX_KEY");
    const env = (Deno.env.get("EFI_ENV") ?? "production").toLowerCase();

    if (!clientId || !clientSecret || !certB64) {
      return json(
        { error: "Credenciais Efí ausentes (EFI_CLIENT_ID / EFI_CLIENT_SECRET / EFI_CERTIFICATE_BASE64)" },
        500,
      );
    }
    if (!pixKey) {
      return json({ error: "EFI_PIX_KEY não configurada" }, 500);
    }

    const baseUrl =
      env === "sandbox"
        ? "https://pix-h.api.efipay.com.br"
        : "https://pix.api.efipay.com.br";

    // mTLS — extrai PEMs do .p12 e cria HttpClient
    const { certPem, keyPem } = p12ToPem(certB64, certPassword);
    const httpClient = Deno.createHttpClient({
      cert: certPem,
      key: keyPem,
    });

    try {
      const token = await authEfi(baseUrl, clientId, clientSecret, httpClient);
      const { txid, pixCopiaECola } = await criarCobranca(
        baseUrl,
        token,
        httpClient,
        valor,
        pixKey,
      );

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: inserted, error: insertError } = await supabase
        .from("pagamentos_pix")
        .insert({
          user_id,
          veiculo_id,
          valor,
          codigo_cupom: codigo_cupom ?? null,
          status: "pendente",
          txid_efi: txid,
          pix_copia_cola: pixCopiaECola,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      return json({
        success: true,
        id: inserted.id,
        pix_copia_cola: pixCopiaECola,
        txid_efi: txid,
      });
    } finally {
      try {
        httpClient.close();
      } catch (_) {
        /* noop */
      }
    }
  } catch (err) {
    console.error("[gerar-pix-efi]", err);
    return json(
      { error: err instanceof Error ? err.message : "Erro desconhecido" },
      500,
    );
  }
});
