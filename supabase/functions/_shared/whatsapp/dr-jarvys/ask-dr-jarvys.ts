// Camada de IA conversacional do Dr. Jarvys — responde livremente sobre
// o carro do usuário e automobilismo em geral, sinaliza quando o assunto
// está fora de escopo (o texto de redirecionamento é responsabilidade do
// chamador, nunca da IA — ver regra 9). Mesmo padrão de isolamento de
// receipt-ocr/parse-receipt.ts e voice-transcription/parse-voice-message.ts
// (Builds OCR-1/VOICE-1): sem Supabase, sem gate comercial, sem
// integração com WhatsApp — função pura de I/O externo, wiring fica para
// um build futuro (item 10).

export type DrJarvysVehicleContext = {
  brand?: string;
  model?: string;
  year?: string | number;
};

export type AskDrJarvysInput = {
  userText: string;
  vehicleContext?: DrJarvysVehicleContext;
};

export type AskDrJarvysResult =
  | { ok: true; inScope: true; response: string }
  | { ok: true; inScope: false }
  | { ok: false; error: string };

export const OUT_OF_SCOPE_TEXT =
  "Sobre esse assunto eu não entendo — por aqui eu só ajudo com carro e automobilismo 🚗 Pode perguntar sobre isso!";

const MAX_USER_TEXT_CHARS = 4000;
const MAX_RESPONSE_CHARS = 1500;
const CHAT_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const CHAT_MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `Você é o Dr. Jarvys, assistente automotivo brasileiro dentro de um
app de gestão de veículos. Fala português do Brasil, tom direto,
simpático e objetivo — como um mecânico de confiança, não como um
robô formal.

ESCOPO — responda livremente SOMENTE sobre:
- O carro do usuário (se houver contexto de veículo fornecido).
- Automobilismo e mercado automotivo em geral: mecânica, manutenção,
  peças, marcas, modelos, lançamentos, corridas (F1, Stock Car, etc.),
  curiosidades sobre carros.

FORA DE ESCOPO — qualquer coisa que não seja sobre carro/automobilismo,
INCLUSIVE outros veículos que não sejam automóveis (barco, avião,
moto aquática, etc. NÃO contam como automobilismo). Também fora de
escopo: assuntos pessoais do usuário sem relação com carro, notícias
gerais, qualquer outro tópico.

Retorne SEMPRE e APENAS um JSON, sem markdown, neste formato exato:
{"inScope": true ou false, "response": "texto da resposta, só se inScope for true, senão null"}

Se inScope for true:
- Responda em no máximo 3-4 frases curtas (isso vai para o WhatsApp,
  não é um artigo).
- Não invente dados técnicos específicos do carro do usuário que você
  não recebeu no contexto — se não souber algo específico do veículo
  dele, diga isso e sugira confirmar com um mecânico ou o manual.
- No máximo 1 emoji na resposta inteira.
- Nunca dê conselho que possa ser perigoso (ex: instruções que
  comprometam segurança do veículo) sem recomendar avaliação
  profissional.

Se inScope for false:
- O campo "response" deve ser null. NÃO tente escrever você mesmo o
  texto de redirecionamento — isso é tratado fora do seu escopo.`;

function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

// Leitura de Deno.env via globalThis (mesmo padrão de actions/deps.ts,
// actions/expense-deps.ts, receipt-ocr/parse-receipt.ts e
// voice-transcription/parse-voice-message.ts) — evita ReferenceError ao
// importar este módulo fora do Deno (ex: bun test).
type DenoEnvLike = { get(name: string): string | undefined };
type DenoGlobalLike = { env?: DenoEnvLike };

function readDenoEnv(name: string): string | undefined {
  const denoGlobal = (globalThis as unknown as { Deno?: DenoGlobalLike }).Deno;
  return denoGlobal?.env?.get(name);
}

function buildVehicleContextLine(
  vehicleContext: DrJarvysVehicleContext | undefined,
): string | null {
  if (!vehicleContext) return null;
  const parts = [
    vehicleContext.brand,
    vehicleContext.model,
    vehicleContext.year === undefined || vehicleContext.year === null
      ? undefined
      : String(vehicleContext.year),
  ].filter((x): x is string => typeof x === "string" && x.trim() !== "");
  if (parts.length === 0) return null;
  return `Veículo do usuário: ${parts.join(" ")}.`;
}

export async function askDrJarvys(input: AskDrJarvysInput): Promise<AskDrJarvysResult> {
  const userText = input?.userText;
  if (!userText || typeof userText !== "string" || userText.trim() === "") {
    return { ok: false, error: "userText é obrigatório" };
  }
  if (userText.length > MAX_USER_TEXT_CHARS) {
    return { ok: false, error: "Mensagem muito longa." };
  }

  const apiKey = readDenoEnv("LOVABLE_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "LOVABLE_API_KEY não configurada no ambiente Deno." };
  }

  const vehicleContextLine = buildVehicleContextLine(input.vehicleContext);
  const userMessage = vehicleContextLine ? `${vehicleContextLine}\n\n${userText}` : userText;

  try {
    const resp = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
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
      console.error("[ask-dr-jarvys] gateway error:", resp.status, text);
      return { ok: false, error: "Falha ao consultar o Dr. Jarvys." };
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      return { ok: false, error: "Resposta inválida do Dr. Jarvys." };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFences(raw));
    } catch (e) {
      return { ok: false, error: "Resposta inválida do Dr. Jarvys." };
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { inScope?: unknown }).inScope !== "boolean"
    ) {
      return { ok: false, error: "Resposta inválida do Dr. Jarvys." };
    }

    const inScope = (parsed as { inScope: boolean }).inScope;

    if (!inScope) {
      return { ok: true, inScope: false };
    }

    const response = (parsed as { response?: unknown }).response;
    if (typeof response !== "string" || response.trim() === "") {
      return { ok: false, error: "Resposta inválida do Dr. Jarvys." };
    }

    const truncated =
      response.length > MAX_RESPONSE_CHARS ? response.slice(0, MAX_RESPONSE_CHARS) : response;

    return { ok: true, inScope: true, response: truncated };
  } catch (e) {
    const errMessage = e instanceof Error ? e.message : "Erro desconhecido.";
    console.error("[ask-dr-jarvys] exception:", errMessage);
    return { ok: false, error: errMessage };
  }
}
