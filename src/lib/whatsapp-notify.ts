// WhatsApp-Hooks-Financeiros: helper genérico de enfileiramento de
// WhatsApp, reaproveitado pelos hooks financeiros/FIPE (pedido de saque,
// saque efetivado, FIPE mensal atualizada). Fire-and-forget — nunca
// lança, nunca bloqueia o caminho principal (mesmo espírito de
// ai-usage-tracking.ts/audit-log.ts).
//
// Mesma query de achar o contato certo já estabelecida em
// whatsapp-maintenance-alerts/index.ts (whatsapp_contacts com is_primary=
// true, verified_at NOT NULL, opt_out=false; instância ativa correspondente
// em whatsapp_provider_instances) — só que pra um único user_id por vez
// (não em lote), já que estes 3 hooks disparam um evento por usuário, não
// um job em massa.

type ContactRow = {
  id: string;
  user_id: string;
  assigned_provider: string | null;
  assigned_instance_id: string | null;
};

type ContactSelectBuilder = {
  eq(column: string, value: unknown): ContactSelectBuilder;
  not(column: string, operator: string, value: unknown): ContactSelectBuilder;
  maybeSingle(): Promise<{ data: ContactRow | null; error: { message: string } | null }>;
};

type InstanceRow = { provider: string; instance_id: string; status: string };

type InstanceSelectBuilder = {
  eq(column: string, value: unknown): InstanceSelectBuilder;
  maybeSingle(): Promise<{ data: InstanceRow | null; error: { message: string } | null }>;
};

export type WhatsappNotifyClient = {
  from(table: "whatsapp_contacts"): {
    select(columns: string): ContactSelectBuilder;
  };
  from(table: "whatsapp_provider_instances"): {
    select(columns: string): InstanceSelectBuilder;
  };
  from(table: "whatsapp_outbound_queue"): {
    insert(row: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
  };
};

export async function enqueueWhatsappNotification(
  client: WhatsappNotifyClient,
  userId: string,
  text: string,
): Promise<void> {
  try {
    const { data: contact, error: contactError } = await client
      .from("whatsapp_contacts")
      .select("id, user_id, assigned_provider, assigned_instance_id")
      .eq("user_id", userId)
      .eq("is_primary", true)
      .eq("opt_out", false)
      .not("verified_at", "is", null)
      .maybeSingle();
    if (contactError) {
      console.error("[whatsapp-notify] contact_error", contactError.message);
      return;
    }
    if (!contact || !contact.assigned_provider || !contact.assigned_instance_id) {
      console.error("[whatsapp-notify] no_verified_contact", userId);
      return;
    }

    const { data: instance, error: instanceError } = await client
      .from("whatsapp_provider_instances")
      .select("provider, instance_id, status")
      .eq("provider", contact.assigned_provider)
      .eq("instance_id", contact.assigned_instance_id)
      .eq("status", "active")
      .maybeSingle();
    if (instanceError) {
      console.error("[whatsapp-notify] instance_error", instanceError.message);
      return;
    }
    if (!instance) {
      console.error("[whatsapp-notify] no_active_instance", userId);
      return;
    }

    const { error: insertError } = await client.from("whatsapp_outbound_queue").insert({
      user_id: userId,
      contact_id: contact.id,
      provider: instance.provider,
      instance_id: instance.instance_id,
      message_type: "text",
      text_body: text,
      status: "queued",
      purpose: "notification",
    });
    if (insertError) {
      console.error("[whatsapp-notify] insert_error", insertError.message);
    }
  } catch (e) {
    console.error("[whatsapp-notify] unexpected", e instanceof Error ? e.message : String(e));
  }
}
