// Cliente para as Edge Functions consultar-placa / consultar-historico-fipe
import { supabase } from "@/integrations/supabase/client";

export type PlacaFipeOption = {
  codigo_fipe: string;
  modelo: string;
  valor: number;
  combustivel?: string;
  ano_modelo?: string;
  mes_referencia?: string;
  desvalorizometro: string; // hash usado pelo endpoint de histórico
  codigo_marca?: string;
  codigo_modelo?: string;
};

export type PlacaFipeVehicleInfo = {
  cilindradas?: string;
  marca?: string;
  modelo?: string;
  ano?: string;
  ano_modelo?: string;
  cor?: string;
  motor?: string;
  combustivel?: string;
  chassi?: string;
};

export type PlacaFipeLookup = {
  ok: boolean;
  fipe: PlacaFipeOption[];
  informacoes_veiculo: PlacaFipeVehicleInfo | null;
  error?: string;
};

function parseValor(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  let clean = s.replace(/R\$/gi, "").replace(/\s/g, "");
  if (clean.includes(",")) clean = clean.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

function pick(o: any, keys: string[]): string {
  if (!o) return "";
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

export async function lookupPlacaFipe(placa: string): Promise<PlacaFipeLookup> {
  try {
    const { data, error } = await supabase.functions.invoke("consultar-placa", {
      body: { placa },
    });
    if (error) {
      console.error("[consultar-placa] error:", error);
      return { ok: false, fipe: [], informacoes_veiculo: null, error: error.message };
    }
    const fipeArr: any[] = Array.isArray(data?.fipe) ? data.fipe : [];
    const fipe: PlacaFipeOption[] = fipeArr
      .map((it) => {
        const codigo = pick(it, ["codigo_fipe", "codigoFipe", "codigo"]);
        const hash = pick(it, [
          "desvalorizometro",
          "hash",
          "hash_desvalorizometro",
          "id_desvalorizometro",
        ]);
        if (!codigo) return null;
        return {
          codigo_fipe: codigo,
          modelo: pick(it, ["modelo", "texto_modelo", "descricao"]),
          valor: parseValor(it?.valor ?? it?.preco),
          combustivel: pick(it, ["combustivel", "texto_combustivel"]),
          ano_modelo: pick(it, ["ano_modelo", "anoModelo", "ano"]),
          mes_referencia: pick(it, ["mes_referencia", "mesReferencia", "referencia"]),
          desvalorizometro: hash,
          codigo_marca: pick(it, ["codigo_marca", "codigoMarca"]) || undefined,
          codigo_modelo: pick(it, ["codigo_modelo", "codigoModelo"]) || undefined,
        } as PlacaFipeOption;
      })
      .filter((x): x is PlacaFipeOption => x !== null);

    const info = data?.informacoes_veiculo ?? null;
    return { ok: !!data?.ok, fipe, informacoes_veiculo: info };
  } catch (e) {
    console.error("[lookupPlacaFipe] exception", e);
    return { ok: false, fipe: [], informacoes_veiculo: null, error: (e as Error).message };
  }
}

export type HistoricoFipePoint = {
  mes_ano_extenso: string;
  mes: string | number | null;
  ano: number | null;
  valor: number;
  codigo_fipe?: string | null;
};

export async function consultarHistoricoFipe(hash: string): Promise<HistoricoFipePoint[]> {
  if (!hash) return [];
  try {
    const { data, error } = await supabase.functions.invoke("consultar-historico-fipe", {
      body: { hash },
    });
    if (error) {
      console.error("[consultar-historico-fipe] error:", error);
      return [];
    }
    const hist: any[] = Array.isArray(data?.historico) ? data.historico : [];
    // Backend já normaliza, mas garantimos número aqui também.
    return hist
      .map((h) => ({
        mes_ano_extenso: String(h?.mes_ano_extenso || ""),
        mes: h?.mes ?? null,
        ano: h?.ano ?? null,
        valor: typeof h?.valor === "number" ? h.valor : parseValor(h?.valor),
        codigo_fipe: h?.codigo_fipe ?? null,
      }))
      .filter((p) => p.mes_ano_extenso && p.valor > 0);
  } catch (e) {
    console.error("[consultarHistoricoFipe] exception", e);
    return [];
  }
}

/* ============================================================
 * Adapter: Placa FIPE → CarConfirmModal (signup)
 * ============================================================ */

export type CarConfirmFipeOption = {
  codigo_fipe: string;
  modelo: string;
  valor: number;
  combustivel?: string;
  ano_modelo?: string;
  mes_referencia?: string;
  placafipe_hash: string;
  codigo_marca?: string;
  codigo_modelo?: string;
};

export type LookupPlateViaPlacaFipeResult = {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  motorizacao: string;
  chassi: string;
  cilindradas?: string;
  fipe_options: CarConfirmFipeOption[];
} | null;

/**
 * Consulta a placa exclusivamente via Placa FIPE e adapta para o
 * shape consumido pelo CarConfirmModal. NUNCA escolhe versão sozinho —
 * devolve sempre o array completo de fipe_options.
 */
export async function lookupPlateViaPlacaFipe(
  placa: string,
): Promise<LookupPlateViaPlacaFipeResult> {
  const r = await lookupPlacaFipe(placa);
  if (!r.ok || !r.informacoes_veiculo) return null;
  const info = r.informacoes_veiculo;
  return {
    marca: info.marca ?? "",
    modelo: info.modelo ?? "",
    ano: info.ano_modelo ?? info.ano ?? "",
    cor: info.cor ?? "",
    motorizacao: info.motor ?? "",
    chassi: info.chassi ?? "",
    cilindradas: info.cilindradas ?? undefined,
    fipe_options: r.fipe
      .filter((o) => o.codigo_fipe && o.desvalorizometro)
      .map((o) => ({
        codigo_fipe: o.codigo_fipe,
        modelo: o.modelo,
        valor: o.valor,
        combustivel: o.combustivel,
        ano_modelo: o.ano_modelo,
        mes_referencia: o.mes_referencia,
        placafipe_hash: o.desvalorizometro,
        codigo_marca: o.codigo_marca,
        codigo_modelo: o.codigo_modelo,
      })),
  };
}

