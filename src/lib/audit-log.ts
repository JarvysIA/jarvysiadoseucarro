// Audit-Log (item 15): registra ações administrativas/sensíveis do
// sistema. Nunca deve lançar nem bloquear o caminho principal — mesmo
// espírito fire-and-forget de ai-usage-tracking.ts.

export type AuditAction = "user_status_updated" | "account_deactivated";

type AuditLogClient = {
  from: (table: "audit_log") => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
};

export async function recordAuditEvent(
  client: AuditLogClient,
  event: {
    actorId: string;
    action: AuditAction;
    targetId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { error } = await client.from("audit_log").insert({
      actor_id: event.actorId,
      action: event.action,
      target_id: event.targetId ?? null,
      details: event.details ?? {},
    });
    if (error) console.error("[audit-log] insert_error", error.message);
  } catch (e) {
    console.error("[audit-log] unexpected", e instanceof Error ? e.message : String(e));
  }
}
