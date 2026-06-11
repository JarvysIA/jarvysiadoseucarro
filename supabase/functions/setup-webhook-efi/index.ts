// Edge Function: setup-webhook-efi
// Registra a URL do webhook efi-webhook na API Pix da Efí Bank via PUT /v2/webhook/{chave}.
// Reutiliza a mesma lógica mTLS de gerar-pix-efi.
// Variáveis de ambiente:
//   EFI_CLIENT_ID, EFI_CLIENT_SECRET, EFI_CERTIFICATE_BASE64, EFI_PIX_KEY
//   (opcional) EFI_CERTIFICATE_PASSWORD, EFI_ENV ("production" | "sandbox")
//   (opcional) EFI_WEBHOOK_URL  -> sobrescreve a URL padrão

import forge from "https://esm.sh/node-forge@1.3.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
  const scope =
    Deno.env.get("EFI_OAUTH_SCOPE") ??
    "cob.write cob.read pix.write pix.read webhook.write webhook.read";

  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    // @ts-ignore - Deno fetch aceita `client`
    client,
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials", scope }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha auth Efí (${res.status}): ${t}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const clientId = Deno.env.get("EFI_CLIENT_ID");
    const clientSecret = Deno.env.get("EFI_CLIENT_SECRET");
    const certB64 = Deno.env.get("EFI_CERTIFICATE_BASE64");
    const certPassword = Deno.env.get("EFI_CERTIFICATE_PASSWORD") ?? "";
    const pixKey = Deno.env.get("EFI_PIX_KEY");
    const env = (Deno.env.get("EFI_ENV") ?? "production").toLowerCase();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    if (!clientId || !clientSecret || !certB64) {
      return json(
        { error: "Credenciais Efí ausentes (EFI_CLIENT_ID / EFI_CLIENT_SECRET / EFI_CERTIFICATE_BASE64)" },
        500,
      );
    }
    if (!pixKey) return json({ error: "EFI_PIX_KEY não configurada" }, 500);

    const baseUrl =
      env === "sandbox"
        ? "https://pix-h.api.efipay.com.br"
        : "https://pix.api.efipay.com.br";

    const webhookUrl =
      Deno.env.get("EFI_WEBHOOK_URL") ??
      `${supabaseUrl}/functions/v1/efi-webhook`;

    const { certPem, keyPem } = p12ToPem(certB64, certPassword);
    const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });

    try {
      const token = await authEfi(baseUrl, clientId, clientSecret, httpClient);

      const putUrl = `${baseUrl}/v2/webhook/${encodeURIComponent(pixKey)}`;
      const res = await fetch(putUrl, {
        method: "PUT",
        // @ts-ignore
        client: httpClient,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          // Header recomendado pela Efí para pular o handshake (mTLS já garante).
          "x-skip-mtls-checking": "false",
        },
        body: JSON.stringify({ webhookUrl }),
      });

      const text = await res.text();
      let efiBody: unknown = text;
      try {
        efiBody = text ? JSON.parse(text) : null;
      } catch (_) {
        /* mantém texto */
      }

      return json(
        {
          ok: res.ok,
          status: res.status,
          webhookUrl,
          pixKey,
          env,
          efiResponse: efiBody,
        },
        res.ok ? 200 : res.status,
      );
    } finally {
      try {
        httpClient.close();
      } catch (_) {
        /* noop */
      }
    }
  } catch (err) {
    console.error("[setup-webhook-efi]", err);
    return json(
      { error: err instanceof Error ? err.message : "Erro desconhecido" },
      500,
    );
  }
});
