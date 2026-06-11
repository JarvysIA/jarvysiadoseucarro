// Edge Function: verificar-pagamentos-pix
// Busca ativa (polling) — roda a cada 5 min via pg_cron.
// 1. Lista pagamentos_pix pendentes da última 1h
// 2. Consulta GET /v2/cob/{txid} na Efí (mTLS)
// 3. Se CONCLUIDA -> marca pago + ativa veículo + envia bonificação R$5 ao padrinho
// 4. Pagamentos pendentes > 1h -> status "expirado"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import forge from "https://esm.sh/node-forge@1.3.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const BONIFICACAO_VALOR = 5.0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
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
  for (const sc of p12.safeContents) {
    for (const bag of sc.safeBags) {
      if (bag.type === forge.pki.oids.certBag && bag.cert) {
        certPem += forge.pki.certificateToPem(bag.cert);
      } else if (
        (bag.type === forge.pki.oids.keyBag ||
          bag.type === forge.pki.oids.pkcs8ShroudedKeyBag) &&
        bag.key
      ) {
        keyPem = forge.pki.privateKeyToPem(bag.key);
      }
    }
  }
  if (!certPem || !keyPem) throw new Error("Falha ao extrair cert/key do .p12");
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
    "cob.write cob.read pix.write pix.read gn.pix.send.write gn.pix.send.read";
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    // @ts-ignore
    client,
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials", scope }),
  });
  if (!res.ok) throw new Error(`Auth Efí ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function consultarCobranca(
  baseUrl: string,
  token: string,
  client: Deno.HttpClient,
  txid: string,
): Promise<{ status: string; raw: unknown }> {
  const res = await fetch(`${baseUrl}/v2/cob/${encodeURIComponent(txid)}`, {
    // @ts-ignore
    client,
    headers: { Authorization: `Bearer ${token}` },
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Consulta cob ${res.status}: ${JSON.stringify(raw)}`);
  return { status: (raw as { status?: string }).status ?? "", raw };
}

async function enviarPixBonificacao(
  baseUrl: string,
  token: string,
  client: Deno.HttpClient,
  chavePixPagadora: string,
  chavePixFavorecido: string,
  valor: number,
): Promise<{ ok: boolean; raw: unknown; status: number }> {
  // POST /v2/gn/pix/enviar — envia PIX da conta Efí para uma chave externa.
  const body = {
    valor: valor.toFixed(2),
    pagador: { chave: chavePixPagadora, infoPagador: "Bonificação Jarvys - Indicação" },
    favorecido: { chave: chavePixFavorecido },
  };
  const res = await fetch(`${baseUrl}/v2/gn/pix/enviar`, {
    method: "POST",
    // @ts-ignore
    client,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => ({}));
  return { ok: res.ok, raw, status: res.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const clientId = Deno.env.get("EFI_CLIENT_ID");
    const clientSecret = Deno.env.get("EFI_CLIENT_SECRET");
    const certB64 = Deno.env.get("EFI_CERTIFICATE_BASE64");
    const certPassword = Deno.env.get("EFI_CERTIFICATE_PASSWORD") ?? "";
    const pixKey = Deno.env.get("EFI_PIX_KEY");
    const env = (Deno.env.get("EFI_ENV") ?? "production").toLowerCase();

    if (!clientId || !clientSecret || !certB64 || !pixKey) {
      return json({ error: "Credenciais Efí ausentes" }, 500);
    }

    const baseUrl =
      env === "sandbox"
        ? "https://pix-h.api.efipay.com.br"
        : "https://pix.api.efipay.com.br";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Expira pendentes com mais de 1h
    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: expiraveis } = await supabase
      .from("pagamentos_pix")
      .update({ status: "expirado" })
      .eq("status", "pendente")
      .lt("created_at", umaHoraAtras)
      .select("id");

    // 2. Busca pendentes da última 1h
    const { data: pendentes, error: errPend } = await supabase
      .from("pagamentos_pix")
      .select("id, user_id, veiculo_id, valor, codigo_cupom, txid_efi, created_at")
      .eq("status", "pendente")
      .gte("created_at", umaHoraAtras)
      .not("txid_efi", "is", null);

    if (errPend) throw errPend;

    const resumo = {
      verificados: 0,
      pagos: 0,
      bonificacoes_ok: 0,
      bonificacoes_falha: 0,
      expirados: expiraveis?.length ?? 0,
      detalhes: [] as Array<Record<string, unknown>>,
    };

    if (!pendentes || pendentes.length === 0) return json({ ok: true, ...resumo });

    // mTLS + token (reutilizados para todos)
    const { certPem, keyPem } = p12ToPem(certB64, certPassword);
    const httpClient = Deno.createHttpClient({ cert: certPem, key: keyPem });

    try {
      const token = await authEfi(baseUrl, clientId, clientSecret, httpClient);

      for (const pag of pendentes) {
        resumo.verificados++;
        const det: Record<string, unknown> = { id: pag.id, txid: pag.txid_efi };
        try {
          const { status } = await consultarCobranca(baseUrl, token, httpClient, pag.txid_efi!);
          det.efiStatus = status;

          if (status === "CONCLUIDA") {
            // a) Marca pago + ativa veículo (status="active" — nomenclatura EN exigida pelo frontend)
            await supabase
              .from("pagamentos_pix")
              .update({ status: "pago" })
              .eq("id", pag.id);
            await supabase
              .from("veiculos")
              .update({ status: "active" })
              .eq("id", pag.veiculo_id);
            // Libera flags do perfil: remove tarja de trial e destrava link de indicação
            await supabase
              .from("profiles")
              .update({ status_usuario: "ativo", permite_indicacao: true })
              .eq("id", pag.user_id);
            resumo.pagos++;
            det.atualizado = true;

            // b/c) Bonificação ao padrinho (se cupom)
            if (pag.codigo_cupom) {
              const cupom = pag.codigo_cupom.trim().toLowerCase();
              const isUuid =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                  cupom,
                );
              console.log("[bonificacao] Buscando padrinho para o cupom:", cupom, "isUuid:", isUuid);

              let padrinho:
                | { id: string; pix_recebimento: string | null }
                | null = null;
              let padrinhoErro: unknown = null;

              if (isUuid) {
                const r = await supabase
                  .from("profiles")
                  .select("id, pix_recebimento")
                  .eq("id", cupom)
                  .maybeSingle();
                padrinho = r.data as typeof padrinho;
                padrinhoErro = r.error;
              } else {
                const r = await supabase
                  .from("profiles")
                  .select("id, pix_recebimento")
                  .ilike("id", `${cupom}%`)
                  .limit(1)
                  .maybeSingle();
                padrinho = r.data as typeof padrinho;
                padrinhoErro = r.error;
              }

              console.log("[bonificacao] Resultado da busca do padrinho:", {
                cupom,
                padrinho,
                padrinhoErro,
              });

              if (!padrinho) {
                // Cupom existente mas padrinho não encontrado — sempre registrar
                resumo.bonificacoes_falha++;
                det.bonificacao = "padrinho_nao_encontrado";
                const { error: logErr } = await supabase
                  .from("logs_erro_bonificacao")
                  .insert({
                    pagamento_id: pag.id,
                    codigo_cupom: pag.codigo_cupom,
                    valor: BONIFICACAO_VALOR,
                    erro: "Cupom existente mas padrinho nao encontrado no banco",
                    efi_response: padrinhoErro
                      ? ({ supabase_error: String(padrinhoErro) } as Record<string, unknown>)
                      : null,
                  });
                if (logErr) console.error("[bonificacao] Falha ao gravar log:", logErr);
              } else if (padrinho.pix_recebimento) {
                const envio = await enviarPixBonificacao(
                  baseUrl,
                  token,
                  httpClient,
                  pixKey,
                  padrinho.pix_recebimento,
                  BONIFICACAO_VALOR,
                );
                if (envio.ok) {
                  resumo.bonificacoes_ok++;
                  det.bonificacao = "ok";
                } else {
                  resumo.bonificacoes_falha++;
                  det.bonificacao = "falha";
                  await supabase.from("logs_erro_bonificacao").insert({
                    pagamento_id: pag.id,
                    padrinho_id: padrinho.id,
                    codigo_cupom: pag.codigo_cupom,
                    valor: BONIFICACAO_VALOR,
                    chave_pix: padrinho.pix_recebimento,
                    erro: `HTTP ${envio.status}`,
                    efi_response: envio.raw as Record<string, unknown>,
                  });
                }
              } else {
                resumo.bonificacoes_falha++;
                det.bonificacao = "sem_chave_pix";
                await supabase.from("logs_erro_bonificacao").insert({
                  pagamento_id: pag.id,
                  padrinho_id: padrinho.id,
                  codigo_cupom: pag.codigo_cupom,
                  valor: BONIFICACAO_VALOR,
                  erro: "Padrinho sem pix_recebimento cadastrado",
                });
              }
            }
          }
        } catch (e) {
          det.erro = e instanceof Error ? e.message : String(e);
        }
        resumo.detalhes.push(det);
      }
    } finally {
      try {
        httpClient.close();
      } catch (_) {
        /* noop */
      }
    }

    return json({ ok: true, ...resumo });
  } catch (err) {
    console.error("[verificar-pagamentos-pix]", err);
    return json(
      { error: err instanceof Error ? err.message : "Erro desconhecido" },
      500,
    );
  }
});
