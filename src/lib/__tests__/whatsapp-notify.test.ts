// Build WhatsApp-Hooks-Financeiros — testes de enqueueWhatsappNotification.
// Mesmo precedente de vehicle-image.functions.test.ts/saque-padrinho.test.ts:
// client estrutural injetado via DI, nunca mock.module(). Matchers do shim
// local (bun-test.d.ts): só toBe/toContain/not.toBe/not.toContain.

import { describe, expect, test } from "bun:test";
import { enqueueWhatsappNotification, type WhatsappNotifyClient } from "../whatsapp-notify";

function makeMockClient(opts: {
  contactFound?: boolean;
  instanceFound?: boolean;
  contactError?: { message: string } | null;
  instanceError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const contactFound = opts.contactFound ?? true;
  const instanceFound = opts.instanceFound ?? true;
  const inserts: Record<string, unknown>[] = [];

  const client = {
    from(table: string) {
      if (table === "whatsapp_contacts") {
        return {
          select: (_cols: string) => {
            const builder = {
              eq: (_c: string, _v: unknown) => builder,
              not: (_c: string, _op: string, _v: unknown) => builder,
              maybeSingle: async () => ({
                data: opts.contactError || !contactFound
                  ? null
                  : {
                      id: "contact-1",
                      user_id: "user-1",
                      assigned_provider: "zapi",
                      assigned_instance_id: "instance-1",
                    },
                error: opts.contactError ?? null,
              }),
            };
            return builder;
          },
        };
      }
      if (table === "whatsapp_provider_instances") {
        return {
          select: (_cols: string) => {
            const builder = {
              eq: (_c: string, _v: unknown) => builder,
              maybeSingle: async () => ({
                data: opts.instanceError || !instanceFound
                  ? null
                  : { provider: "zapi", instance_id: "instance-1", status: "active" },
                error: opts.instanceError ?? null,
              }),
            };
            return builder;
          },
        };
      }
      if (table === "whatsapp_outbound_queue") {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserts.push(row);
            return { error: opts.insertError ?? null };
          },
        };
      }
      throw new Error(`tabela inesperada no mock: ${table}`);
    },
  } as unknown as WhatsappNotifyClient;

  return { client, inserts };
}

describe("enqueueWhatsappNotification — sucesso", () => {
  test("contato verificado encontrado: insere na fila com os campos certos", async () => {
    const { client, inserts } = makeMockClient({});

    await enqueueWhatsappNotification(client, "user-1", "texto da mensagem");

    expect(inserts.length).toBe(1);
    const row = inserts[0]!;
    expect(row.user_id).toBe("user-1");
    expect(row.contact_id).toBe("contact-1");
    expect(row.provider).toBe("zapi");
    expect(row.instance_id).toBe("instance-1");
    expect(row.text_body).toBe("texto da mensagem");
    expect(row.status).toBe("queued");
    expect(row.purpose).toBe("notification");
  });
});

describe("enqueueWhatsappNotification — sem contato válido", () => {
  test("nenhum contato verificado: não insere, não lança", async () => {
    const { client, inserts } = makeMockClient({ contactFound: false });

    await enqueueWhatsappNotification(client, "user-1", "texto");

    expect(inserts.length).toBe(0);
  });

  test("contato sem instância ativa correspondente: não insere, não lança", async () => {
    const { client, inserts } = makeMockClient({ instanceFound: false });

    await enqueueWhatsappNotification(client, "user-1", "texto");

    expect(inserts.length).toBe(0);
  });
});

describe("enqueueWhatsappNotification — fail-safe", () => {
  test("erro do client (select de contato) não propaga", async () => {
    const { client, inserts } = makeMockClient({ contactError: { message: "boom" } });

    await enqueueWhatsappNotification(client, "user-1", "texto");

    // Chegar até aqui sem o teste falhar já prova que não propagou.
    expect(inserts.length).toBe(0);
  });

  test("erro do client (insert na fila) não propaga", async () => {
    const { client, inserts } = makeMockClient({ insertError: { message: "boom" } });

    await enqueueWhatsappNotification(client, "user-1", "texto");

    expect(inserts.length).toBe(1);
  });
});
