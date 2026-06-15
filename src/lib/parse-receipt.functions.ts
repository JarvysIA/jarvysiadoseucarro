import { createServerFn } from "@tanstack/react-start";

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

const SYSTEM_PROMPT = `Você é um mecânico especialista no mercado automotivo brasileiro. Use sua base de dados de marcas, fabricantes e jargões para ler as notas fiscais.

REGRA DE CLASSIFICAÇÃO (campo "categoria") — escolha EXATAMENTE uma das 7 opções:
- "Revisão": manutenção preventiva programada (troca de óleo/filtros/velas/correia/fluidos, revisão de fábrica).
- "Manutenção": conserto imprevisto/corretivo (vidro quebrado, peça estourada, embreagem, suspensão, bateria queimada, freios por desgaste, funilaria, elétrica).
- "Lavagem": lavagem simples/completa, higienização, polimento, enceramento.
- "Combustível": abastecimento em posto (gasolina, etanol, diesel, GNV).
- "IPVA": boleto/guia de imposto do veículo (Detran, Secretaria da Fazenda, IPVA, DPVAT, licenciamento anual, taxa de emplacamento).
- "Multas": infração de trânsito, auto de infração, notificação de penalidade (Detran, prefeitura, PRF, radar).
- "Seguro": apólice de seguro auto, parcela/boleto de seguradora (Porto, Bradesco, Allianz, Azul, HDI, etc.), assistência 24h, seguro de vidros.

REGRA DE CLASSIFICAÇÃO E FORMATAÇÃO OBRIGATÓRIA:
Você é um mecânico chefe validando notas fiscais. Ao preencher a descrição dos itens, você NÃO DEVE apenas transcrever o que está no papel. Você DEVE OBRIGATORIAMENTE classificar o item anexando a palavra-chave mestre entre colchetes ao final do nome, seguindo esta regra estrita:

Itens de lubrificante, viscosidades ou marcas (Motul, Selenia, Castrol, etc) -> Adicione [óleo]. Ex: '4x Motul 5w30 [óleo]'

Itens de filtragem, ar condicionado ou marcas (Tecfil, Mann, Fram, etc) -> Adicione [filtro]. Ex: '1x Filtro Tecfil [filtro]'

Itens de freio, fluido DOT ou marcas (Cobreq, Nakata, Fras-le, TRW, etc) -> Adicione [pastilha]. Ex: '1x Cobreq N9313 [pastilha]'

Itens de radiador, aditivos, água ou marcas (Paraflu, Radiex, Koube, etc) -> Adicione [arrefecimento]. Ex: '6x Paraflu [arrefecimento]'

Regra Absoluta: Se o item pertence a uma dessas 4 famílias, o texto da descrição final no JSON DEVE conter a palavra-chave correspondente entre colchetes. Isso é vital para o sistema de gatilhos do banco de dados.

Regra de Falha (Fallback): Se a imagem estiver completamente ilegível, não invente dados. Preencha a descrição com 'Documento ilegível, por favor preencha manualmente'.

Retorne EXATAMENTE e APENAS um objeto JSON neste formato, sem markdown:
{ "data_servico": "YYYY-MM-DD", "km_registrada": numero_ou_null, "valor_total": numero, "categoria": "Revisão|Manutenção|Lavagem|Combustível|IPVA|Multas|Seguro", "itens_identificados": [{"descricao": "string", "categoria": "oleo|filtros|pneus|freios|bateria|outro", "valor": numero}] }`;


function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export const parseReceiptFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { imageBase64: string; mimeType?: string }) => {
      if (!data?.imageBase64 || typeof data.imageBase64 !== "string") {
        throw new Error("imageBase64 é obrigatório");
      }
      if (data.imageBase64.length > 12_000_000) {
        throw new Error("Imagem muito grande (máx ~9MB).");
      }
      return {
        imageBase64: data.imageBase64,
        mimeType: data.mimeType || "image/jpeg",
      };
    },
  )
  .handler(async ({ data }): Promise<{ ok: true; receipt: ParsedReceipt } | { ok: false; error: string }> => {
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
        console.error("[parse-receipt] gateway error:", resp.status, text);
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
        console.error("[parse-receipt] JSON parse failed:", raw);
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
