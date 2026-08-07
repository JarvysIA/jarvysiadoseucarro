/**
 * MJ2C-V N8 — confirma via SQL direto (has_function_privilege) que anon e
 * authenticated NÃO têm EXECUTE em public.record_whatsapp_milestone_notice
 * (o REVOKE explícito da migration funcionou). Não precisa de fixtures de
 * dados — é uma checagem pura de catálogo de permissões.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Session } from "../harness/db";

const HAS_DB =
  typeof process.env.TEST_DATABASE_URL === "string" && process.env.TEST_DATABASE_URL.trim() !== "";
const describeIfDb = HAS_DB ? describe : describe.skip;

const FUNCTION_SIGNATURE = "public.record_whatsapp_milestone_notice(uuid,uuid,integer,text)";

describeIfDb("MJ2C-V N8 — REVOKE de anon/authenticated", () => {
  let session: Session;

  beforeAll(async () => {
    session = await openSession("n8");
  });

  afterAll(async () => {
    await session?.close();
  });

  test("anon NÃO tem EXECUTE em record_whatsapp_milestone_notice", async () => {
    const r = await session.query<{ has_execute: boolean }>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as has_execute`,
      [FUNCTION_SIGNATURE],
    );
    expect(r.rows[0]?.has_execute).toBe(false);
  });

  test("authenticated NÃO tem EXECUTE em record_whatsapp_milestone_notice", async () => {
    const r = await session.query<{ has_execute: boolean }>(
      `select has_function_privilege('authenticated', $1, 'EXECUTE') as has_execute`,
      [FUNCTION_SIGNATURE],
    );
    expect(r.rows[0]?.has_execute).toBe(false);
  });
});

if (!HAS_DB) {
  console.log("[MJ2C-V N8] skipped: TEST_DATABASE_URL ausente (esperado fora do CI)");
}
