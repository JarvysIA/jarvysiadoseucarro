// Fix-Voice-Transcription-Gate — versão Deno-compatible de "registra
// evento de uso de IA + verifica se cruzou 40/dia + enfileira alerta pro
// admin", mesma RPC record_ai_usage_and_check_alert já usada pelo lado
// do app (src/lib/ai-usage-tracking.ts). Duplicação deliberada — mesmo
// motivo/padrão já usado em saque-padrinho.ts e whatsapp-notify.ts: o
// arquivo do app importa @/integrations/supabase/client.server (alias
// do TanStack, não resolve em Deno) e vive em src/lib/, fora do bundle
// das edge functions. Fire-and-forget: nunca lança, nunca bloqueia o
// caminho principal que chamou recordAiUsageDeno.

export const AI_USAGE_ALERT_ADMIN_USER_ID = "27d62a75-e90b-48a4-be43-c4342b075708"; // adm.fernando@yahoo.com

export type AiUsageEventTypeDeno = "audio_transcription";

type ContactRow = {
  id: string;
  assigned_provider: string | null;
  assigned_instance_id: string | null;
};

type ContactSelectBuilder = {
  eq: (col: string, val: unknown) => ContactSelectBuilder;
  not: (col: string, op: string, val: unknown) => ContactSelectBuilder;
  maybeSingle: () => Promise<{ data: ContactRow | null; error: { message: string } | null }>;
};

// Client estrutural mínimo — mesmo espírito de AiUsageTrackingClient em
// src/lib/ai-usage-tracking.ts (mesma regra, versão Deno). Narrow de
// propósito pro que esta função realmente usa; não reaproveita
// SupabaseLike de orchestrator/repository.ts porque aquele builder não
// suporta .not().
export type AiUsageTrackingDenoClient = {
  rpc: (
    fn: "record_ai_usage_and_check_alert",
    params: { p_event_type: string; p_user_id: string },
  ) => Promise<{
    data: Array<{ daily_count: number; should_alert: boolean }> | null;
    error: { message: string } | null;
  }>;
  from: {
    (table: "whatsapp_contacts"): { select: (cols: string) => ContactSelectBuilder };
    (table: "whatsapp_outbound_queue"): {
      insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
  };
};

export async function recordAiUsageDeno(
  client: AiUsageTrackingDenoClient,
  userId: string,
  eventType: AiUsageEventTypeDeno,
): Promise<void> {
  try {
    const { data, error } = await client.rpc("record_ai_usage_and_check_alert", {
      p_event_type: eventType,
      p_user_id: userId,
    });
    if (error || !data?.[0]) {
      console.error(JSON.stringify({ tag: "ai-usage-tracking-deno", error: "rpc_error" }));
      return;
    }
    const { should_alert, daily_count } = data[0];
    if (!should_alert) return;

    // Contato de alerta já existe (pré-criado) — busca por
    // user_id/is_primary/verified_at em vez de hardcodar o id.
    const contact = await client
      .from("whatsapp_contacts")
      .select("id, assigned_provider, assigned_instance_id")
      .eq("user_id", AI_USAGE_ALERT_ADMIN_USER_ID)
      .eq("is_primary", true)
      .not("verified_at", "is", null)
      .maybeSingle();
    if (!contact.data || !contact.data.assigned_provider || !contact.data.assigned_instance_id) {
      console.error(JSON.stringify({ tag: "ai-usage-tracking-deno", error: "admin_contact_not_found" }));
      return;
    }

    await client.from("whatsapp_outbound_queue").insert({
      user_id: AI_USAGE_ALERT_ADMIN_USER_ID,
      contact_id: contact.data.id,
      vehicle_id: null,
      provider: contact.data.assigned_provider,
      instance_id: contact.data.assigned_instance_id,
      message_type: "text",
      text_body: `⚠️ Usuário atingiu ${daily_count} chamadas de IA hoje (evento mais recente: ${eventType}). Verifique se é uso legítimo.\nID do usuário: ${userId}`,
      status: "queued",
      purpose: "notification",
    });
  } catch (e) {
    console.error(JSON.stringify({
      tag: "ai-usage-tracking-deno",
      error: "unexpected",
      message: e instanceof Error ? e.message : String(e),
    }));
  }
}
