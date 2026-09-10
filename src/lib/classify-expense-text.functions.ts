import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAiUsageAndMaybeAlert } from "@/lib/ai-usage-tracking";

const SYSTEM_PROMPT = `Você é um classificador de autopeças. Receba o nome de um item digitado pelo usuário. Se o texto já vier com alguma tag entre colchetes (ex: [oleo], [filtro]), REMOVA-A antes de classificar para evitar duplicação.

Siga OBRIGATORIAMENTE este mapeamento e anexe APENAS UMA tag ao final da string (separada por um espaço). Se a linha contiver mais de uma família (ex: "óleo e filtro de ar"), anexe múltiplas tags separadas por espaço.

- Óleo, lubrificantes E filtros de óleo -> anexe [oleo]
- Filtros de ar, cabine e combustível -> anexe [filtro]
- Freios (pastilha, disco, lonas, sapatas) -> anexe [pastilha]
- Arrefecimento (aditivo, radiador, válvula termostática, bomba d'água) -> anexe [arrefecimento]
- Correia dentada e tensores/kit distribuição -> anexe [correia_dentada]
- Correia poly V / acessórios -> anexe [correias]
- Ignição (velas, cabos, bobinas) -> anexe [ignicao]
- Suspensão (amortecedor, bandeja, pivô, bieleta) -> anexe [suspensao]

Se for um serviço genérico (lavagem, alinhamento, balanceamento, mão de obra, revisão genérica), IPVA, multa, seguro ou se você não souber categorizar, NÃO anexe nenhuma tag.

Retorne APENAS a string final atualizada — sem aspas, sem markdown, sem explicação. Apenas o texto puro.`;

export const classifyExpenseTextFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { text: string }) => {
    if (!data?.text || typeof data.text !== "string") {
      throw new Error("text é obrigatório");
    }
    const trimmed = data.text.trim().slice(0, 500);
    return { text: trimmed };
  })
  .handler(async ({ data, context }): Promise<{ ok: true; text: string } | { ok: false; error: string; text: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "LOVABLE_API_KEY não configurada.", text: data.text };
    }
    if (!data.text) {
      return { ok: true, text: "" };
    }

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: data.text },
          ],
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        console.error("[classify-expense-text] gateway error:", resp.status, t.slice(0, 200));
        // Fallback: devolve o texto original limpo de tags
        return { ok: false, error: `Gateway ${resp.status}`, text: stripTags(data.text) };
      }

      const json = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = json.choices?.[0]?.message?.content?.trim();
      if (!raw) {
        return { ok: false, error: "Resposta vazia", text: stripTags(data.text) };
      }

      // Limpa eventuais aspas/backticks
      const cleaned = raw.replace(/^["'`]+|["'`]+$/g, "").trim();
      void recordAiUsageAndMaybeAlert(context.userId, "classify_expense_text");
      return { ok: true, text: cleaned };
    } catch (e) {
      const errMessage = e instanceof Error ? e.message : "erro";
      console.error("[classify-expense-text] exception:", errMessage);
      return {
        ok: false,
        error: errMessage,
        text: stripTags(data.text),
      };
    }
  });

function stripTags(s: string): string {
  return s.replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s+/g, " ").trim();
}
