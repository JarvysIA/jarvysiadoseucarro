// Build Ai-Usage-Alert — testes de recordAiUsageAndMaybeAlert.
//
// Mesmo precedente de vehicle-image.functions.test.ts: client injetado via
// DI (deps.client), nunca mock.module() — permite testar sem depender do
// supabaseAdmin/dynamic import reais. Matchers disponíveis no shim local
// (bun-test.d.ts) são só toBe/toContain/not.toBe/not.toContain — sem
// .resolves/.rejects/toThrow, por isso "não lança exceção" é provado só
// pelo await direto completar (se lançasse, o teste falharia).

import { describe, expect, test } from "bun:test";
import { recordAiUsageAndMaybeAlert, type AiUsageTrackingClient } from "../ai-usage-tracking";

type RpcResult = {
  data: Array<{ daily_count: number; should_alert: boolean }> | null;
  error: { message: string } | null;
};

type ContactRow = {
  id: string;
  assigned_provider: string | null;
  assigned_instance_id: string | null;
} | null;

type MockOptions = {
  rpcResult?: RpcResult;
  rpcThrows?: boolean;
  contactRow?: ContactRow;
};

const DEFAULT_CONTACT: ContactRow = {
  id: "contact-1",
  assigned_provider: "zapi",
  assigned_instance_id: "INST1",
};

function makeMockClient(opts: MockOptions = {}) {
  const calls = {
    rpc: [] as Array<{ p_event_type: string; p_user_id: string }>,
    contactSelect: 0,
    insert: [] as Record<string, unknown>[],
  };

  const contactRow = opts.contactRow === undefined ? DEFAULT_CONTACT : opts.contactRow;

  const client: AiUsageTrackingClient = {
    rpc: async (_fn, params) => {
      calls.rpc.push(params);
      if (opts.rpcThrows) throw new Error("rpc boom");
      return opts.rpcResult ?? { data: [{ daily_count: 1, should_alert: false }], error: null };
    },
    from: ((table: string) => {
      if (table === "whatsapp_contacts") {
        return {
          select: (_cols: string) => {
            calls.contactSelect++;
            const builder = {
              eq: () => builder,
              not: () => builder,
              maybeSingle: async () => ({ data: contactRow }),
            };
            return builder;
          },
        };
      }
      if (table === "whatsapp_outbound_queue") {
        return {
          insert: async (row: Record<string, unknown>) => {
            calls.insert.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`tabela não mockada: ${table}`);
    }) as unknown as AiUsageTrackingClient["from"],
  };

  return { client, calls };
}

describe("recordAiUsageAndMaybeAlert — should_alert=true", () => {
  test("dispara o insert em whatsapp_outbound_queue com os campos certos", async () => {
    const { client, calls } = makeMockClient({
      rpcResult: { data: [{ daily_count: 40, should_alert: true }], error: null },
    });

    await recordAiUsageAndMaybeAlert("user-1", "ocr_receipt", { client });

    expect(calls.rpc.length).toBe(1);
    expect(calls.rpc[0]!.p_event_type).toBe("ocr_receipt");
    expect(calls.rpc[0]!.p_user_id).toBe("user-1");

    expect(calls.insert.length).toBe(1);
    const row = calls.insert[0]!;
    expect(row.user_id).toBe("27d62a75-e90b-48a4-be43-c4342b075708");
    expect(row.contact_id).toBe("contact-1");
    expect(row.provider).toBe("zapi");
    expect(row.instance_id).toBe("INST1");
    expect(row.vehicle_id).toBe(null);
    expect(row.message_type).toBe("text");
    expect(row.status).toBe("queued");
    expect(row.purpose).toBe("notification");
    expect((row.text_body as string)).toContain("40");
    expect((row.text_body as string)).toContain("ocr_receipt");
    expect((row.text_body as string)).toContain("user-1");
  });
});

describe("recordAiUsageAndMaybeAlert — should_alert=false", () => {
  test("não dispara nada (nem lookup de contato, nem insert)", async () => {
    const { client, calls } = makeMockClient({
      rpcResult: { data: [{ daily_count: 5, should_alert: false }], error: null },
    });

    await recordAiUsageAndMaybeAlert("user-1", "dr_jarvys_chat", { client });

    expect(calls.contactSelect).toBe(0);
    expect(calls.insert.length).toBe(0);
  });
});

describe("recordAiUsageAndMaybeAlert — fail-safe", () => {
  test("RPC devolve error (não lança): não insere, não propaga", async () => {
    const { client, calls } = makeMockClient({
      rpcResult: { data: null, error: { message: "boom" } },
    });

    await recordAiUsageAndMaybeAlert("user-1", "classify_expense_text", { client });

    expect(calls.insert.length).toBe(0);
  });

  test("RPC lança exceção de verdade: fail-safe, o await completa sem propagar", async () => {
    const { client, calls } = makeMockClient({ rpcThrows: true });

    await recordAiUsageAndMaybeAlert("user-1", "ocr_receipt", { client });

    expect(calls.insert.length).toBe(0);
  });

  test("contato de alerta não encontrado: não lança, não insere", async () => {
    const { client, calls } = makeMockClient({
      rpcResult: { data: [{ daily_count: 40, should_alert: true }], error: null },
      contactRow: null,
    });

    await recordAiUsageAndMaybeAlert("user-1", "ocr_receipt", { client });

    expect(calls.insert.length).toBe(0);
  });

  test("contato encontrado mas sem assigned_provider/assigned_instance_id: não insere", async () => {
    const { client, calls } = makeMockClient({
      rpcResult: { data: [{ daily_count: 40, should_alert: true }], error: null },
      contactRow: { id: "contact-2", assigned_provider: null, assigned_instance_id: null },
    });

    await recordAiUsageAndMaybeAlert("user-1", "ocr_receipt", { client });

    expect(calls.insert.length).toBe(0);
  });
});
