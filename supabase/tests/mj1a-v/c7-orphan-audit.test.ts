/**
 * MJ1A-V — Cenário C7: auditoria final de integridade cross-tabela
 * (zero órfão) entre whatsapp_outbound_queue, whatsapp_messages e
 * whatsapp_km_prompt_requests.
 *
 * Diferente de C1-C6: não usa fixtures sintéticas, não chama nenhuma RPC,
 * não é teste de concorrência. É uma auditoria estrutural read-only sobre
 * o estado real do banco de teste no momento em que roda (depois de C1-C6,
 * que já limpam os próprios resíduos sintéticos no afterAll de cada um).
 *
 * Por que isso não é redundante com as FKs do schema: FOREIGN KEY e CHECK
 * constraints do Postgres não conseguem expressar invariantes ENTRE
 * tabelas (ex.: "se a fila está 'sent', a mensagem correspondente também
 * precisa estar 'sent'"). As 3 tabelas já têm FKs garantindo que
 * source_message_id/prompt_message_id sempre apontam pra uma linha
 * existente (auditado via information_schema antes de escrever este
 * teste) — o que falta cobrir é a consistência SEMÂNTICA de estado entre
 * elas, que só a lógica das RPCs deveria garantir. Este teste prova isso a
 * nível de banco inteiro, não só das linhas sintéticas de um cenário
 * isolado.
 *
 * Invariantes checadas (cada uma deve retornar 0 linhas):
 *   A. queue 'sent'   -> mensagem correspondente também 'sent'.
 *   B. queue 'failed' -> mensagem correspondente também 'failed'.
 *   C. request em ('pending','reserved','consumed') -> mensagem 'sent'.
 *   D. request 'queued' -> fila correspondente ainda em ('queued','sending').
 *   E. todo request tem uma linha de fila correspondente (mesma
 *      prompt_message_id / source_message_id) — nenhum request "solto".
 *   F. toda linha de fila com purpose='notification' (usado exclusivamente
 *      por enqueue_whatsapp_km_prompt — confirmado por auditoria: nenhuma
 *      outra função usa esse purpose) tem um request correspondente.
 *
 * Ambiente: SÓ roda em Postgres local (guard preflight). Skipa em bun test
 * padrão quando TEST_DATABASE_URL não está setado.
 *
 * Não modifica RPCs, migrations, Edge Functions ou src/. Não liga
 * orchestrator_mode. Não conecta caller produtivo. Read-only.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";

const HAS_DB =
  typeof process.env.TEST_DATABASE_URL === "string" &&
  process.env.TEST_DATABASE_URL.trim() !== "";

const describeIfDb = HAS_DB ? describe : describe.skip;

async function countViolations(session: Session, sql: string): Promise<number> {
  const r = await session.query<{ n: string }>(sql);
  return Number(r.rows[0]?.n ?? "0");
}

describeIfDb(
  "MJ1A-V C7 — auditoria final: zero órfão entre queue/message/request",
  () => {
    let session: Session;

    beforeAll(async () => {
      session = await openSession("audit");
    });

    afterAll(async () => {
      await session?.close();
    });

    test("A. fila 'sent' implica mensagem 'sent'", async () => {
      const n = await countViolations(
        session,
        `select count(*)::text as n
         from public.whatsapp_outbound_queue q
         join public.whatsapp_messages m on m.id = q.source_message_id
        where q.status = 'sent' and m.status <> 'sent'`,
      );
      expect(n).toBe(0);
    });

    test("B. fila 'failed' implica mensagem 'failed'", async () => {
      const n = await countViolations(
        session,
        `select count(*)::text as n
         from public.whatsapp_outbound_queue q
         join public.whatsapp_messages m on m.id = q.source_message_id
        where q.status = 'failed' and m.status <> 'failed'`,
      );
      expect(n).toBe(0);
    });

    test("C. request pending/reserved/consumed implica mensagem 'sent'", async () => {
      const n = await countViolations(
        session,
        `select count(*)::text as n
         from public.whatsapp_km_prompt_requests r
         join public.whatsapp_messages m on m.id = r.prompt_message_id
        where r.status in ('pending','reserved','consumed')
          and m.status <> 'sent'`,
      );
      expect(n).toBe(0);
    });

    test("D. request 'queued' implica fila ainda 'queued' ou 'sending'", async () => {
      const n = await countViolations(
        session,
        `select count(*)::text as n
         from public.whatsapp_km_prompt_requests r
         join public.whatsapp_outbound_queue q
           on q.source_message_id = r.prompt_message_id
        where r.status = 'queued'
          and q.status not in ('queued','sending')`,
      );
      expect(n).toBe(0);
    });

    test("E. todo request tem uma linha de fila correspondente", async () => {
      const n = await countViolations(
        session,
        `select count(*)::text as n
         from public.whatsapp_km_prompt_requests r
        where not exists (
          select 1 from public.whatsapp_outbound_queue q
           where q.source_message_id = r.prompt_message_id
        )`,
      );
      expect(n).toBe(0);
    });

    test("F. toda fila de notificação (purpose='notification') tem request correspondente", async () => {
      const n = await countViolations(
        session,
        `select count(*)::text as n
         from public.whatsapp_outbound_queue q
        where q.purpose = 'notification'
          and not exists (
            select 1 from public.whatsapp_km_prompt_requests r
             where r.prompt_message_id = q.source_message_id
          )`,
      );
      expect(n).toBe(0);
    });
  },
);

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.log(
    "[MJ1A-V C7] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)",
  );
}
