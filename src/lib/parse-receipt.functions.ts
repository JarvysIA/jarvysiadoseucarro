import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { trialActive } from "@/lib/plan-capabilities";
import type { ProfileStatus } from "@/lib/profile-status";
import { isActiveVehicleStatus, isArchivedVehicleStatus } from "@/lib/vehicle-status";


export type ReceiptCategory =
  | "oleo"
  | "filtros"
  | "pneus"
  | "freios"
  | "bateria"
  | "outro";

export type ReceiptItem = {
  descricao: string;
  categoria: ReceiptCategory;
  valor: number;
};

export type DespesaCategoria =
  | "Revisão"
  | "Manutenção"
  | "Lavagem"
  | "Combustível"
  | "IPVA"
  | "Multas"
  | "Seguro"
  | "Acessórios";

export const DESPESA_CATEGORIAS: DespesaCategoria[] = [
  "Revisão",
  "Manutenção",
  "Lavagem",
  "Combustível",
  "IPVA",
  "Multas",
  "Seguro",
  "Acessórios",
];

export type ParsedReceipt = {
  data_servico: string | null;
  km_registrada: number | null;
  valor_total: number;
  categoria: DespesaCategoria;
  itens_identificados: ReceiptItem[];
};

const SYSTEM_PROMPT = `Você é um sistema avançado de Inteligência Artificial Automotiva lendo notas fiscais e orçamentos do Brasil, que frequentemente contêm apenas códigos (SKUs), abreviações caóticas ou marcas sem o nome da peça. É muito importante o seu entendimento da leitura pra que você categorize as peças/produtos da forma correta. Cada auto peça, auto Center ou oficina descreve de uma forma diferente. Você tem que entender.

REGRA DE CLASSIFICAÇÃO (campo "categoria") — escolha EXATAMENTE uma das 8 opções:
- "Revisão": manutenção preventiva programada (troca de óleo/filtros/velas/correia/fluidos, revisão de fábrica).
- "Manutenção": conserto imprevisto/corretivo (vidro quebrado, peça estourada, embreagem, suspensão, bateria queimada, freios por desgaste, funilaria, elétrica).
- "Lavagem": lavagem simples/completa, higienização, polimento, enceramento.
- "Combustível": abastecimento em posto (gasolina, etanol, diesel, GNV).
- "IPVA": boleto/guia de imposto do veículo (Detran, Secretaria da Fazenda, IPVA, DPVAT, licenciamento anual, taxa de emplacamento).
- "Multas": infração de trânsito, auto de infração, notificação de penalidade (Detran, prefeitura, PRF, radar).
- "Seguro": apólice de seguro auto, parcela/boleto de seguradora (Porto, Bradesco, Allianz, Azul, HDI, etc.), assistência 24h, seguro de vidros.
- "Acessórios": compra de itens não relacionados a manutenção/reparo mecânico (som automotivo, multimídia, tapetes, capas de banco, película, rodas estéticas, acabamentos, acessórios de personalização).

DIRETRIZ DE CLASSIFICAÇÃO E DEDUÇÃO AUTOMOTIVA (VERSÃO DEFINITIVA):

Regra 1: Dedução Livre (Motor de Busca)
Ao ler os itens, NÃO transcreva apenas o que vê no papel. Use todo o seu conhecimento global (LLM) para DEDUZIR a peça real.
Exemplo: Se ler 'KTB333', escreva 'Kit Correia Dentada Dayco KTB333'. Se ler 'N9313', escreva 'Pastilha de Freio Cobreq N9313'. Se ler 'LZKAR7AD', escreva 'Vela de Ignição NGK'.

Regra 2: Mapeamento de TAGS (OBRIGATÓRIO)
Sempre que você deduzir a família de uma peça, você OBRIGATORIAMENTE deve anexar a respectiva TAG entre colchetes ao final da descrição da peça. Siga rigorosamente esta separação:
- Óleo/Lubrificantes E Filtros de Óleo -> [óleo] (Atenção: Filtro de Óleo obrigatoriamente recebe a tag óleo)
- Filtros de Ar, Cabine/Ar Condicionado e Combustível -> [filtro]
- Freios (Pastilha, disco, lonas, sapatas) -> [pastilha]
- Arrefecimento (Aditivos, radiador, bomba d'água, válvula termostática) -> [arrefecimento]
- Distribuição (Correia dentada, tensores, kits) -> [correia_dentada]
- Ignição (Velas, cabos, bobinas) -> [ignicao]
- Suspensão (Amortecedores, bandejas, pivôs, bieletas) -> [suspensao]

Regra 3: Linhas Compostas e Serviços (Mão de Obra)
Se uma mesma linha da nota contiver itens de categorias diferentes (ex: Troca de óleo e filtro de ar), anexe ambas as tags: [óleo] [filtro].
Se for apenas um serviço ou Mão de Obra (ex: Alinhamento, Balanceamento, Lavagem, Revisão Genérica), NÃO adicione tags. Apenas descreva o serviço de forma clara.

Regra 4: Imutabilidade Financeira (Proibido Alterar)
Você tem liberdade total para deduzir e reescrever o NOME do item, mas é ESTRITAMENTE PROIBIDO deduzir, alterar ou inventar Quantidades e Valores (R$). Eles devem ser transcritos exatamente como constam na imagem.

Regra de Falha (Fallback): Se a imagem estiver completamente ilegível, não invente dados. Preencha a descrição com 'Documento ilegível, por favor preencha manualmente'.

Retorne EXATAMENTE e APENAS um objeto JSON neste formato, sem markdown:
{ "data_servico": "YYYY-MM-DD", "km_registrada": numero_ou_null, "valor_total": numero, "categoria": "Revisão|Manutenção|Lavagem|Combustível|IPVA|Multas|Seguro|Acessórios", "itens_identificados": [{"descricao": "string", "categoria": "oleo|filtros|pneus|freios|bateria|outro", "valor": numero}] }`;


function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export const parseReceiptFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { imageBase64: string; mimeType?: string; vehicleId: string }) => {
      if (!data?.imageBase64 || typeof data.imageBase64 !== "string") {
        throw new Error("imageBase64 é obrigatório");
      }
      if (data.imageBase64.length > 12_000_000) {
        throw new Error("Imagem muito grande (máx ~9MB).");
      }
      if (!data?.vehicleId || typeof data.vehicleId !== "string") {
        throw new Error("vehicleId é obrigatório");
      }
      return {
        imageBase64: data.imageBase64,
        mimeType: data.mimeType || "image/jpeg",
        vehicleId: data.vehicleId,
      };
    },
  )
  .handler(async ({ data, context }): Promise<{ ok: true; receipt: ParsedReceipt } | { ok: false; error: string }> => {
    // Build 8.7E1b: gate server-side de canUseReceiptScanner com contexto de veículo.
    // Regra comercial: vip/enterprise → sempre; trial → trial ativo;
    // ativo → veículo pertencente ao usuário, status='ativo' E ativação real
    // via pagamentos_pix (status='pago', tipo_produto='ativacao', veiculo_id=X).
    // Bloqueia trial expirado, free, archived e veículo não-ativado.
    try {
      // Ownership + status do veículo (RLS já garante user_id = auth.uid()).
      const { data: veic } = await context.supabase
        .from("veiculos")
        .select("id, user_id, status")
        .eq("id", data.vehicleId)
        .maybeSingle();
      if (!veic || veic.user_id !== context.userId) {
        return { ok: false, error: "forbidden" };
      }
      // Bloqueio duro: veículo arquivado nunca usa OCR.
      if (isArchivedVehicleStatus(veic.status)) {
        return { ok: false, error: "paywall" };
      }

      const { data: prof } = await context.supabase
        .from("profiles")
        .select("status_usuario, trial_inicio")
        .eq("id", context.userId)
        .maybeSingle();
      const status = (prof?.status_usuario ?? null) as ProfileStatus | null;
      const trialInicio = (prof?.trial_inicio ?? null) as string | null;

      let allowed = false;
      if (status === "vip" || status === "enterprise") {
        // Qualquer veículo não-archived (já filtrado acima).
        allowed = true;
      } else if (status === "trial") {
        // Trial ativo → qualquer veículo não-archived.
        allowed = trialActive({
          status_usuario: "trial",
          trial_inicio: trialInicio,
          vehicleCount: 0,
          activatedVehicleCount: 0,
        });
      } else if (status === "ativo") {
        // Exige veículo com status='ativo' E ativação comercial real
        // (pagamentos_pix pago, tipo_produto='ativacao', veiculo_id=X).
        if (isActiveVehicleStatus(veic.status)) {
          const { data: pay } = await context.supabase
            .from("pagamentos_pix")
            .select("id")
            .eq("user_id", context.userId)
            .eq("veiculo_id", data.vehicleId)
            .eq("status", "pago")
            .eq("tipo_produto", "ativacao")
            .limit(1)
            .maybeSingle();
          allowed = Boolean(pay);
        }
      }

      if (!allowed) {
        return { ok: false, error: "paywall" };
      }

    } catch (e) {
      console.error("[parse-receipt] paywall check failed");
      return { ok: false, error: "paywall" };
    }


    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "LOVABLE_API_KEY não configurada." };
    }

    const dataUrl = data.imageBase64.startsWith("data:")
      ? data.imageBase64
      : `data:${data.mimeType};base64,${data.imageBase64}`;

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extraia os dados desta nota fiscal/orçamento de oficina e retorne apenas o JSON solicitado.",
                },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        if (resp.status === 429) {
          return { ok: false, error: "Muitas requisições. Tente novamente em alguns segundos." };
        }
        if (resp.status === 402) {
          return { ok: false, error: "Créditos de IA esgotados. Adicione créditos na workspace." };
        }
        console.error("[parse-receipt] gateway error:", resp.status, text.slice(0, 200));
        return { ok: false, error: "Falha ao chamar a IA de visão." };
      }

      const json = await resp.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = json.choices?.[0]?.message?.content?.trim();
      if (!raw) return { ok: false, error: "Resposta vazia da IA." };

      let parsed: ParsedReceipt;
      try {
        parsed = JSON.parse(stripJsonFences(raw)) as ParsedReceipt;
      } catch (e) {
        console.error("[parse-receipt] JSON parse failed:", raw.slice(0, 200));
        return { ok: false, error: "A IA não retornou um JSON válido. Tente outra foto." };
      }

      // Normaliza
      const itens = Array.isArray(parsed.itens_identificados)
        ? parsed.itens_identificados.map((it) => ({
            descricao: String(it?.descricao ?? "Item"),
            categoria: (
              ["oleo", "filtros", "pneus", "freios", "bateria", "outro"].includes(
                String(it?.categoria),
              )
                ? it.categoria
                : "outro"
            ) as ReceiptCategory,
            valor: Number(it?.valor) || 0,
          }))
        : [];

      const categoria: DespesaCategoria = DESPESA_CATEGORIAS.includes(
        parsed.categoria as DespesaCategoria,
      )
        ? (parsed.categoria as DespesaCategoria)
        : "Manutenção";

      return {
        ok: true,
        receipt: {
          data_servico: parsed.data_servico ?? null,
          km_registrada:
            parsed.km_registrada == null ? null : Number(parsed.km_registrada) || null,
          valor_total: Number(parsed.valor_total) || itens.reduce((s, i) => s + i.valor, 0),
          categoria,
          itens_identificados: itens,
        },
      };
    } catch (e) {
      console.error("[parse-receipt] exception:", e);
      return { ok: false, error: e instanceof Error ? e.message : "Erro desconhecido." };
    }
  });
