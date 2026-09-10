// Ai-Usage-Alert: registra cada chamada de IA feita pelo app e avisa o
// admin por WhatsApp quando um usuário cruza 40 chamadas no mesmo dia.
// Nunca bloqueia nada — é um efeito colateral de observabilidade, não
// parte do fluxo de negócio. Qualquer falha aqui dentro é engolida e
// logada; nunca deve lançar nem atrasar perceptivelmente o caminho
// principal que chamou recordAiUsageAndMaybeAlert.

export const AI_USAGE_ALERT_ADMIN_USER_ID = "27d62a75-e90b-48a4-be43-c4342b075708"; // adm.fernando@yahoo.com

export type AiUsageEventType = "ocr_receipt" | "dr_jarvys_chat" | "classify_expense_text";

type ContactRow = {
  id: string;
  assigned_provider: string | null;
  assigned_instance_id: string | null;
};

type ContactSelectBuilder = {
  eq: (col: string, val: unknown) => ContactSelectBuilder;
  not: (col: string, op: string, val: unknown) => ContactSelectBuilder;
  maybeSingle: () => Promise<{ data: ContactRow | null }>;
};

// Estrutural, não o Database type completo — mesmo espírito de
// VehicleImageAdminClient em vehicle-image-cache.ts: só o subconjunto que
// esta função realmente usa, pra permitir DI em teste (client real via
// dynamic import por padrão; client mockado só quando deps.client é
// passado — nunca mock.module(), mesmo precedente já estabelecido em
// vehicle-image.functions.test.ts).
export type AiUsageTrackingClient = {
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

export async function recordAiUsageAndMaybeAlert(
  userId: string,
  eventType: AiUsageEventType,
  deps?: { client?: AiUsageTrackingClient },
): Promise<void> {
  try {
    const client: AiUsageTrackingClient =
      deps?.client ??
      ((await import("@/integrations/supabase/client.server"))
        .supabaseAdmin as unknown as AiUsageTrackingClient);

    const { data, error } = await client.rpc("record_ai_usage_and_check_alert", {
      p_event_type: eventType,
      p_user_id: userId,
    });
    if (error || !data?.[0]) {
      console.error("[ai-usage-tracking] rpc_error", error?.message ?? "sem retorno");
      return;
    }
    const { should_alert, daily_count } = data[0];
    if (!should_alert) return;

    // Contato de alerta já existe (pré-criado) — busca por
    // user_id/is_primary/verified_at em vez de hardcodar o id.
    const { data: contact } = await client
      .from("whatsapp_contacts")
      .select("id, assigned_provider, assigned_instance_id")
      .eq("user_id", AI_USAGE_ALERT_ADMIN_USER_ID)
      .eq("is_primary", true)
      .not("verified_at", "is", null)
      .maybeSingle();
    if (!contact || !contact.assigned_provider || !contact.assigned_instance_id) {
      console.error("[ai-usage-tracking] admin_contact_not_found");
      return;
    }

    await client.from("whatsapp_outbound_queue").insert({
      user_id: AI_USAGE_ALERT_ADMIN_USER_ID,
      contact_id: contact.id,
      vehicle_id: null,
      provider: contact.assigned_provider,
      instance_id: contact.assigned_instance_id,
      message_type: "text",
      text_body: `⚠️ Usuário atingiu ${daily_count} chamadas de IA hoje (evento mais recente: ${eventType}). Verifique se é uso legítimo.\nID do usuário: ${userId}`,
      status: "queued",
      purpose: "notification",
    });
  } catch (e) {
    console.error("[ai-usage-tracking] unexpected", e instanceof Error ? e.message : String(e));
  }
}
