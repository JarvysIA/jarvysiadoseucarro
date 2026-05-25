import renegadeImg from "@/assets/car-renegade.jpg";
import unoImg from "@/assets/car-uno.jpg";

export type Status = "ok" | "warn" | "bad";

export type ItemKey = "oleo" | "filtros" | "pneus" | "pastilhas" | "arrefecimento";

export type StatusItem = {
  status: Status;
  /** km restantes até a próxima manutenção (negativo = atrasado) */
  remainingKm: number;
};

export type Vehicle = {
  id: string;
  model: string;
  year: string;
  color: string;
  plate: string;
  km: number;
  image: string;
  status: Record<ItemKey, StatusItem>;
};

export const VEHICLES: Vehicle[] = [
  {
    id: "renegade",
    model: "Jeep Renegade",
    year: "2022",
    color: "Preto Carbon",
    plate: "ABC1D23",
    km: 48230,
    image: renegadeImg,
    status: {
      oleo: { status: "ok", remainingKm: 4200 },
      filtros: { status: "warn", remainingKm: 1500 },
      pneus: { status: "ok", remainingKm: 12000 },
      pastilhas: { status: "bad", remainingKm: -300 },
      arrefecimento: { status: "ok", remainingKm: 8000 },
    },
  },
  {
    id: "uno",
    model: "Fiat Uno",
    year: "2018",
    color: "Prata Metálico",
    plate: "DEF5G67",
    km: 92110,
    image: unoImg,
    status: {
      oleo: { status: "bad", remainingKm: -800 },
      filtros: { status: "ok", remainingKm: 5200 },
      pneus: { status: "warn", remainingKm: 1200 },
      pastilhas: { status: "ok", remainingKm: 9000 },
      arrefecimento: { status: "warn", remainingKm: 900 },
    },
  },
];

export const STATUS_LABEL: Record<Status, string> = {
  ok: "Em dia",
  warn: "Alerta",
  bad: "Atrasado",
};

/** Estimativa simples: 1.000 km / mês */
export function predictChangeDate(remainingKm: number, kmPerMonth = 1000): string {
  const months = Math.round(remainingKm / kmPerMonth);
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "");
}

export function formatRemaining(remainingKm: number): string {
  if (remainingKm < 0) {
    return `Atrasado ${Math.abs(remainingKm).toLocaleString("pt-BR")} km`;
  }
  return `Faltam ${remainingKm.toLocaleString("pt-BR")} km`;
}
