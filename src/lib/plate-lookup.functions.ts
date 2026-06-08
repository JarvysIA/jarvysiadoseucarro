import { createServerFn } from "@tanstack/react-start";

const PUXAPLACA_TOKEN = "b792b11a-b553-411f-8d8c-0a2ceb011c5b";

export type FipeHistoricoItem = { mes_referencia: string; valor: string | number };

export type PlateLookupPayload = {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  motorizacao: string;
  chassi: string;
  fipe?: {
    codigo_fipe: string;
    valor: number;
    mes_referencia: string;
    historico: FipeHistoricoItem[];
  } | null;
} | null;

/** Tenta extrair um campo do JSON em vários "shapes" possíveis. */
function pick(obj: any, keys: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

/** "R$ 45.123,50" → 45123.5 */
function parseValorBR(raw: any): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const clean = String(raw ?? "")
    .replace(/[R$\s.]/g, "")
    .replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

function normalize(raw: any): PlateLookupPayload {
  if (!raw || typeof raw !== "object") return null;

  // Estrutura oficial PuxaPlaca: raw.basico.dados / raw.detalheTecnico.dados / raw.chassi.dados
  const basico = raw?.basico?.dados ?? {};
  const detalhe = raw?.detalheTecnico?.dados ?? {};
  const chassiBlock = raw?.chassi?.dados ?? {};

  // Fallbacks genéricos para outras formas de retorno
  const fallbacks = [raw, raw?.veiculo, raw?.dados, raw?.data, raw?.resultado, chassiBlock].filter(Boolean);

  let marca = pick(basico, ["marca", "MARCA", "fabricante"]);
  let modelo =
    pick(detalhe, ["modelo", "MODELO"]) ||
    pick(basico, ["modelo", "MODELO"]);
  // CRÍTICO: SEMPRE priorizar `anoModelo` sobre o ano de fabricação.
  // O valor FIPE e a tabela inteira são vinculados ao ano-modelo.
  let ano =
    pick(basico, ["anoModelo", "ano_modelo", "anoModeloVeiculo"]) ||
    pick(detalhe, ["anoModelo", "ano_modelo"]) ||
    pick(basico, ["ano", "ANO", "ano_fabricacao", "anoFabricacao"]);
  let cor = pick(basico, ["cor", "COR"]);
  let motorizacao =
    pick(detalhe, ["motorizacao", "motor", "cilindrada", "potencia", "combustivel"]) ||
    pick(basico, ["motor", "motorizacao", "cilindrada", "combustivel"]);
  let chassi =
    pick(chassiBlock, ["chassi", "CHASSI", "chassis", "vin", "VIN"]) ||
    pick(detalhe, ["chassi", "CHASSI", "chassis", "vin", "VIN"]) ||
    pick(basico, ["chassi", "CHASSI", "chassis", "vin", "VIN"]);

  for (const c of fallbacks) {
    if (!marca) marca = pick(c, ["marca", "MARCA", "fabricante", "manufacturer"]);
    if (!modelo) modelo = pick(c, ["modelo", "MODELO", "model", "modeloVeiculo"]);
    if (!ano)
      ano = pick(c, ["anoModelo", "ano_modelo", "ano", "ANO", "year"]);
    if (!cor) cor = pick(c, ["cor", "COR", "color", "corVeiculo"]);
    if (!motorizacao)
      motorizacao = pick(c, ["motorizacao", "motor", "cilindrada", "combustivel"]);
    if (!chassi) chassi = pick(c, ["chassi", "CHASSI", "chassis", "vin", "VIN"]);
  }

  // FIPE: extraímos APENAS o `codigo_fipe` da API paga (identificação).
  // O valor atual e o histórico vêm exclusivamente da BrasilAPI gratuita,
  // filtrando pelo anoModelo salvo no veículo (ver refreshFipeFn).
  let fipe: PlateLookupPayload extends infer T ? T extends { fipe?: infer F } ? F : never : never = null as any;
  const fipeFirst = raw?.fipe?.dados?.[0];
  if (fipeFirst && typeof fipeFirst === "object") {
    const codigo = pick(fipeFirst, ["codigo_fipe", "codigoFipe", "codigo"]);
    if (codigo) {
      fipe = {
        codigo_fipe: codigo,
        valor: 0,
        mes_referencia: "",
        historico: [],
      } as any;
    }
  }

  if (!marca && !modelo && !ano && !cor && !fipe) return null;
  return { marca, modelo, ano, cor, motorizacao, chassi, fipe: fipe as any };
}

export const lookupPlateFn = createServerFn({ method: "POST" })
  .inputValidator((data: { placa: string }) => data)
  .handler(async ({ data }) => {
    const placa = (data.placa || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (placa.length < 7) {
      return { ok: false as const, error: "Placa inválida", data: null, raw: null, cached: false as const };
    }

    // 1) CACHE: se a placa já existe no banco e fipe_updated_at < 30 dias,
    // retorna direto sem queimar uma chamada paga.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: cached } = await supabaseAdmin
        .from("veiculos")
        .select("marca,modelo,ano,cor,motorizacao,chassi,codigo_fipe,fipe_valor,fipe_mes_referencia,fipe_updated_at")
        .eq("placa", placa)
        .not("codigo_fipe", "is", null)
        .order("fipe_updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (cached?.fipe_updated_at) {
        const age = Date.now() - new Date(cached.fipe_updated_at).getTime();
        if (age < 30 * 24 * 60 * 60 * 1000) {
          return {
            ok: true as const,
            error: null,
            cached: true as const,
            data: {
              marca: cached.marca || "",
              modelo: cached.modelo || "",
              ano: cached.ano || "",
              cor: cached.cor || "",
              motorizacao: cached.motorizacao || "",
              chassi: cached.chassi || "",
              fipe: cached.codigo_fipe
                ? {
                    codigo_fipe: cached.codigo_fipe,
                    valor: Number(cached.fipe_valor) || 0,
                    mes_referencia: cached.fipe_mes_referencia || "",
                    historico: [] as FipeHistoricoItem[],
                  }
                : null,
            } as PlateLookupPayload,
            raw: null,
          };
        }
      }
    } catch (e) {
      console.warn("[lookupPlateFn cache check]", e);
    }

    // 2) Sem cache → API paga
    const url = `https://api.puxaplaca.app/v2/consulta/${placa}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          token: PUXAPLACA_TOKEN,
        },
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        return {
          ok: false as const,
          error: `HTTP ${res.status}`,
          data: null,
          raw: json ?? text,
          cached: false as const,
        };
      }
      const mapped = normalize(json);
      return { ok: true as const, error: null, data: mapped, raw: json, cached: false as const };
    } catch (e: any) {
      return {
        ok: false as const,
        error: e?.message || "Falha de rede",
        data: null,
        raw: null,
        cached: false as const,
      };
    }
  });
