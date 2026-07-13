// Build 5.7F2E1A.5-MJ1A — Renderer puro do prompt Jarvys de KM.
// Sem I/O, sem IA, sem Supabase, sem Deno APIs, sem randomness, sem datas.
// Determinístico e testável em Bun/Deno.

const MAX_LABEL_LEN = 60;
const FALLBACK_LABEL = "carro";

function sanitizeLabel(raw: string): string {
  if (typeof raw !== "string") return FALLBACK_LABEL;
  // Remove caracteres de controle (0x00..0x1F e 0x7F).
  let s = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      s += " ";
    } else {
      s += raw[i];
    }
  }
  // Colapsa whitespace e faz trim.
  s = s.replace(/\s+/g, " ").trim();
  if (s.length === 0) return FALLBACK_LABEL;
  if (s.length > MAX_LABEL_LEN) s = s.slice(0, MAX_LABEL_LEN).trim();
  if (s.length === 0) return FALLBACK_LABEL;
  return s;
}

export function renderKmPromptText(input: {
  readonly vehicleLabel: string;
}): string {
  const label = sanitizeLabel(input.vehicleLabel);
  return `Oi! Pra atualizar o histórico do seu ${label}, me manda a quilometragem atual — só o número, por exemplo: 45320.`;
}
