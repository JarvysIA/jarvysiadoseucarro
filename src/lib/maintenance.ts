// Motor lógico de manutenção (mock preparatório para o banco).
// Calcula status (semáforo) baseado em quilometragem E tempo decorrido.

export type MaintStatus = "ok" | "warn" | "bad";

export type MaintItemKey =
  | "oleo"
  | "filtros"
  | "pneus"
  | "pastilhas"
  | "arrefecimento";

export type MaintItem = {
  key: MaintItemKey;
  nome: string;
  ultima_troca_km: number;
  validade_km: number;
  ultima_troca_data: string; // ISO date
  validade_meses: number;
};

export type MaintComputed = {
  item: MaintItem;
  status: MaintStatus;
  /** km restantes até o vencimento (negativo = atrasado) */
  remainingKm: number;
  /** meses restantes até o vencimento (negativo = atrasado) */
  remainingMonths: number;
  /** maior percentual entre km e tempo (0..>1) */
  pct: number;
  /** qual dimensão dispara o alerta */
  driver: "km" | "tempo";
};

/** Defaults de validade por item (padrão de mercado em PT-BR). */
export const ITEM_DEFAULTS: Record<
  MaintItemKey,
  { nome: string; validade_km: number; validade_meses: number }
> = {
  oleo: { nome: "Óleo do Motor", validade_km: 10000, validade_meses: 12 },
  filtros: { nome: "Filtros", validade_km: 15000, validade_meses: 12 },
  pneus: { nome: "Pneus", validade_km: 50000, validade_meses: 60 },
  pastilhas: { nome: "Pastilhas de Freio", validade_km: 30000, validade_meses: 36 },
  arrefecimento: { nome: "Arrefecimento", validade_km: 40000, validade_meses: 24 },
};

/** Hash determinístico simples a partir de uma string. */
function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Gera itens de manutenção mockados para um veículo, de forma determinística
 * (mesmo vehicleId = mesmos valores), para o usuário poder testar alterando a KM.
 */
export function buildMaintenanceItems(
  vehicleId: string,
  kmAtual: number,
): MaintItem[] {
  const keys = Object.keys(ITEM_DEFAULTS) as MaintItemKey[];
  return keys.map((key, idx) => {
    const def = ITEM_DEFAULTS[key];
    const seed = seedFromString(`${vehicleId}:${key}`);
    // Distribui "última troca" entre 30% e 110% da validade — gera mix de cores.
    const used = Math.round(def.validade_km * (0.3 + seed * 0.85));
    const ultima_troca_km = Math.max(0, kmAtual - used);
    // Espalha datas de troca entre 1 e validade_meses + 20%
    const monthsAgo = 1 + Math.floor(seed * (def.validade_meses * 1.1));
    const d = new Date();
    d.setMonth(d.getMonth() - monthsAgo);
    // Pequeno offset por idx para evitar colisões idênticas
    d.setDate(d.getDate() - idx);
    return {
      key,
      nome: def.nome,
      ultima_troca_km,
      validade_km: def.validade_km,
      ultima_troca_data: d.toISOString(),
      validade_meses: def.validade_meses,
    };
  });
}

/** Calcula meses decorridos entre duas datas (aproximação). */
function monthsBetween(fromIso: string, to: Date = new Date()): number {
  const from = new Date(fromIso);
  const diffMs = to.getTime() - from.getTime();
  return diffMs / (1000 * 60 * 60 * 24 * 30.4375);
}

/** Calcula o status (semáforo) considerando km E tempo — pior caso vence. */
export function computeStatus(item: MaintItem, kmAtual: number): MaintComputed {
  const usedKm = Math.max(0, kmAtual - item.ultima_troca_km);
  const pctKm = item.validade_km > 0 ? usedKm / item.validade_km : 0;

  const usedMonths = Math.max(0, monthsBetween(item.ultima_troca_data));
  const pctTime = item.validade_meses > 0 ? usedMonths / item.validade_meses : 0;

  const driver: "km" | "tempo" = pctKm >= pctTime ? "km" : "tempo";
  const pct = Math.max(pctKm, pctTime);

  let status: MaintStatus = "ok";
  if (pct >= 1) status = "bad";
  else if (pct >= 0.8) status = "warn";

  const remainingKm = item.validade_km - usedKm;
  const remainingMonths = item.validade_meses - usedMonths;

  return { item, status, remainingKm, remainingMonths, pct, driver };
}

export function formatRemainingKm(remainingKm: number): string {
  const v = Math.round(remainingKm);
  if (v < 0) return `Atrasado ${Math.abs(v).toLocaleString("pt-BR")} km`;
  return `Faltam ${v.toLocaleString("pt-BR")} km`;
}

export function formatRemainingMonths(remainingMonths: number): string {
  const v = Math.round(remainingMonths);
  if (v < 0) return `Atrasado ${Math.abs(v)} ${Math.abs(v) === 1 ? "mês" : "meses"}`;
  if (v === 0) return "Vence este mês";
  return `Faltam ${v} ${v === 1 ? "mês" : "meses"}`;
}

export const STATUS_LABEL_PT: Record<MaintStatus, string> = {
  ok: "Em dia",
  warn: "Alerta",
  bad: "Atrasado",
};
