import { createServerFn } from "@tanstack/react-start";

const PUXAPLACA_TOKEN = "b792b11a-b553-411f-8d8c-0a2ceb011c5b";

export type FipeHistoryPoint = { mes_referencia: string; valor: number };

/** "R$ 41.095,00" → 41095.00 */
function parseValorBR(raw: any): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  const clean = String(raw ?? "")
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : NaN;
}

function pick(obj: any, keys: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

export const fetchFipeHistoryFn = createServerFn({ method: "POST" })
  .inputValidator((data: { placa: string; codigoFipe: string }) => data)
  .handler(async ({ data }) => {
    const placa = (data.placa || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const codigoFipe = (data.codigoFipe || "").trim();
    if (placa.length < 7 || !codigoFipe) {
      return { ok: false as const, error: "Parâmetros inválidos", historico: [] as FipeHistoryPoint[] };
    }

    try {
      const res = await fetch(`https://api.puxaplaca.app/v2/consulta/${placa}`, {
        method: "GET",
        headers: { Accept: "application/json", token: PUXAPLACA_TOKEN },
      });
      if (!res.ok) {
        return { ok: false as const, error: `HTTP ${res.status}`, historico: [] as FipeHistoricoOut };
      }
      const json: any = await res.json().catch(() => null);
      const arr: any[] = Array.isArray(json?.fipe?.dados) ? json.fipe.dados : [];
      const item = arr.find((it) => {
        const c = pick(it, ["codigo_fipe", "codigoFipe", "codigo"]);
        return c === codigoFipe;
      });
      if (!item) {
        return { ok: false as const, error: "codigo_fipe não encontrado", historico: [] as FipeHistoryPoint[] };
      }
      const rawHist: any[] = Array.isArray(item.historico)
        ? item.historico
        : Array.isArray(item.Historico)
          ? item.Historico
          : [];
      const historico: FipeHistoryPoint[] = rawHist
        .map((h) => ({
          mes_referencia: String(
            pick(h, ["mes_referencia", "mesReferencia", "referencia", "mes"]) || "",
          ),
          valor: parseValorBR(pick(h, ["valor", "Valor", "preco"]) || h?.valor),
        }))
        .filter((p) => p.mes_referencia && Number.isFinite(p.valor))
        .reverse();

      return { ok: true as const, error: null, historico };
    } catch (e: any) {
      return {
        ok: false as const,
        error: e?.message || "Falha de rede",
        historico: [] as FipeHistoryPoint[],
      };
    }
  });

type FipeHistoricoOut = FipeHistoryPoint[];
