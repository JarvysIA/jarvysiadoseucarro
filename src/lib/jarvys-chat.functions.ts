import { createServerFn } from "@tanstack/react-start";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export type JarvysPlanTier = "free" | "vip" | "super_vip";

export type JarvysChatInput = {
  messages: ChatMsg[];
  vehicle: {
    marca?: string | null;
    modelo?: string | null;
    ano?: string | null;
    km?: number | null;
  } | null;
  planTier?: JarvysPlanTier | null;
};

function buildSystemPrompt(
  v: JarvysChatInput["vehicle"],
  planTier?: JarvysPlanTier | null,
): string {
  const marca = v?.marca?.trim() || "—";
  const modelo = v?.modelo?.trim() || "—";
  const ano = v?.ano?.trim() || "—";
  const km = typeof v?.km === "number" ? `${v.km.toLocaleString("pt-BR")} km` : "—";
  const tierLine =
    planTier === "super_vip"
      ? `Este usuário possui o nível 👑 SUPER VIP (cortesia máxima do CEO). Trate-o com exclusividade total, atenção VIP premium, respostas mais aprofundadas e um tom levemente mais caloroso e personalizado.`
      : planTier === "vip"
        ? `Este usuário possui o nível ⭐ VIP. Trate-o com cordialidade exclusiva, agradecendo brevemente quando fizer sentido pela parceria.`
        : `Este usuário está no plano padrão.`;
  return (
    `Você é o Jarvys, uma IA automotiva avançada, atuando como o consultor e mecânico particular do usuário. ` +
    `O usuário está perguntando especificamente sobre o veículo ATUAL dele: ${marca} ${modelo} ${ano} com ${km} rodados. ` +
    `${tierLine} ` +
    `Responda de forma direta, amigável, técnica mas acessível. Nunca dê respostas genéricas; ` +
    `baseie-se sempre nas especificações deste modelo exato de carro. ` +
    `Caso o usuário pergunte ou fale de assuntos completamente distintos do mundo automotivo, ` +
    `responda de forma elegante: "Infelizmente não tenho conhecimento sobre esse assunto." ` +
    `Considere o histórico da conversa como contexto contínuo de uma mesma consulta com o mesmo dono e veículo.`
  );
}

export const jarvysChatFn = createServerFn({ method: "POST" })
  .inputValidator((data: JarvysChatInput) => data)
  .handler(async ({ data }) => {
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
      console.error("[jarvys-chat] gateway error", resp.status, text);
      throw new Error("Falha ao consultar o Jarvys.");
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = json.choices?.[0]?.message?.content?.trim() || "Desculpe, não consegui responder agora.";
    return { reply };
  });
