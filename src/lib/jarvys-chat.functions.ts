import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAiUsageAndMaybeAlert } from "@/lib/ai-usage-tracking";

// Build 8.8E1: limites runtime para o Dr. Jarvys chat.
// Dr. Jarvys app continua LIVRE para usuário logado (regra comercial),
// mas o payload é agora validado antes de qualquer chamada à IA.
const MAX_MESSAGES = 20;
const MAX_CONTENT_CHARS = 4000;
const MAX_VEHICLE_STR = 80;
const MIN_ANO = 1900;
const MAX_ANO = 2100;
const MAX_KM = 10_000_000;

const chatMsgSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_CONTENT_CHARS),
});

const vehicleSchema = z
  .object({
    marca: z.string().max(MAX_VEHICLE_STR).nullable().optional(),
    modelo: z.string().max(MAX_VEHICLE_STR).nullable().optional(),
    ano: z
      .union([
        z.string().max(10),
        z.number().int().min(MIN_ANO).max(MAX_ANO),
      ])
      .nullable()
      .optional()
      .transform((v) => (v == null ? null : typeof v === "number" ? String(v) : v)),
    km: z.number().int().min(0).max(MAX_KM).nullable().optional(),
  })
  .nullable();

const jarvysChatInputSchema = z.object({
  messages: z.array(chatMsgSchema).min(1).max(MAX_MESSAGES),
  vehicle: vehicleSchema,
});

export type ChatMsg = z.infer<typeof chatMsgSchema>;
export type JarvysChatInput = z.infer<typeof jarvysChatInputSchema>;

function buildSystemPrompt(v: JarvysChatInput["vehicle"]): string {
  const marca = v?.marca?.trim() || "—";
  const modelo = v?.modelo?.trim() || "—";
  const ano = (v?.ano ?? "")?.toString().trim() || "—";
  const km = typeof v?.km === "number" ? `${v.km.toLocaleString("pt-BR")} km` : "—";
  return (
    `Você é o Jarvys, uma IA automotiva avançada, atuando como o consultor e mecânico particular do usuário. ` +
    `O usuário está perguntando especificamente sobre o veículo ATUAL dele: ${marca} ${modelo} ${ano} com ${km} rodados. ` +
    `Responda de forma direta, amigável, técnica mas acessível. Nunca dê respostas genéricas; ` +
    `baseie-se sempre nas especificações deste modelo exato de carro. ` +
    `Caso o usuário pergunte ou fale de assuntos completamente distintos do mundo automotivo, ` +
    `responda de forma elegante: "Infelizmente não tenho conhecimento sobre esse assunto." ` +
    `Considere o histórico da conversa como contexto contínuo de uma mesma consulta com o mesmo dono e veículo.`
  );
}

export const jarvysChatFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const parsed = jarvysChatInputSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[jarvys-chat] input inválido");
      throw new Error("Payload inválido.");
    }
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY não configurada.");
    }

    const systemPrompt = buildSystemPrompt(data.vehicle);
    const history = (data.messages || []).slice(-20).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...history],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      if (resp.status === 429) {
        throw new Error("Muitas requisições. Tente novamente em instantes.");
      }
      if (resp.status === 402) {
        throw new Error("Créditos de IA esgotados. Adicione créditos no workspace.");
      }
      console.error("[jarvys-chat] gateway error", resp.status, text.slice(0, 200));
      throw new Error("Falha ao consultar o Jarvys.");
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = json.choices?.[0]?.message?.content?.trim() || "Desculpe, não consegui responder agora.";
    void recordAiUsageAndMaybeAlert(context.userId, "dr_jarvys_chat");
    return { reply };
  });
