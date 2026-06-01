import { createServerFn } from "@tanstack/react-start";

const PUXAPLACA_TOKEN = "b792b11a-b553-411f-8d8c-0a2ceb011c5b";

export type PlateLookupPayload = {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  motorizacao: string;
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

function normalize(raw: any): PlateLookupPayload {
  if (!raw || typeof raw !== "object") return null;
  // pode vir no root, em .veiculo, .dados, .data, .resultado
  const candidates = [raw, raw.veiculo, raw.dados, raw.data, raw.resultado].filter(Boolean);

  let marca = "";
  let modelo = "";
  let ano = "";
  let cor = "";
  let motorizacao = "";

  for (const c of candidates) {
    if (!marca) marca = pick(c, ["marca", "MARCA", "fabricante", "manufacturer"]);
    if (!modelo) modelo = pick(c, ["modelo", "MODELO", "model", "modeloVeiculo"]);
    if (!ano)
      ano = pick(c, [
        "ano",
        "ANO",
        "ano_modelo",
        "anoModelo",
        "ano_fabricacao",
        "anoFabricacao",
        "year",
      ]);
    if (!cor) cor = pick(c, ["cor", "COR", "color", "corVeiculo"]);
    if (!motorizacao)
      motorizacao = pick(c, [
        "motorizacao",
        "motor",
        "cilindrada",
        "potencia",
        "combustivel",
      ]);
  }

  if (!marca && !modelo && !ano && !cor) return null;
  return { marca, modelo, ano, cor, motorizacao };
}

export const lookupPlateFn = createServerFn({ method: "POST" })
  .inputValidator((data: { placa: string }) => data)
  .handler(async ({ data }) => {
    const placa = (data.placa || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (placa.length < 7) {
      return { ok: false as const, error: "Placa inválida", data: null, raw: null };
    }
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
        };
      }
      const mapped = normalize(json);
      return { ok: true as const, error: null, data: mapped, raw: json };
    } catch (e: any) {
      return {
        ok: false as const,
        error: e?.message || "Falha de rede",
        data: null,
        raw: null,
      };
    }
  });
