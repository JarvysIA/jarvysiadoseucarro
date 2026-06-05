import { createServerFn } from "@tanstack/react-start";

const PUXAPLACA_TOKEN = "b792b11a-b553-411f-8d8c-0a2ceb011c5b";

export type PlateLookupPayload = {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  motorizacao: string;
  chassi: string;
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
  let ano = pick(basico, [
    "ano",
    "ANO",
    "ano_modelo",
    "anoModelo",
    "ano_fabricacao",
    "anoFabricacao",
  ]);
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
    if (!ano) ano = pick(c, ["ano", "ANO", "ano_modelo", "anoModelo", "year"]);
    if (!cor) cor = pick(c, ["cor", "COR", "color", "corVeiculo"]);
    if (!motorizacao)
      motorizacao = pick(c, ["motorizacao", "motor", "cilindrada", "combustivel"]);
    if (!chassi) chassi = pick(c, ["chassi", "CHASSI", "chassis", "vin", "VIN"]);
  }

  if (!marca && !modelo && !ano && !cor) return null;
  return { marca, modelo, ano, cor, motorizacao, chassi };
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
