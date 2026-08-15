import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildConversationHandoffIdempotencyKey,
  enqueueConversationHandoffOutbound,
  getConversationHandoffOutboundByKey,
} from "../outbound.ts";
import type { RpcInvoker, SupabaseLike } from "../../orchestrator/repository.ts";

// Mock estrutural mínimo — só client.rpc é usado por outbound.ts. Mesmo
// padrão de cast pontual (não any/as unknown as) já usado em
// ledger.test.ts / orchestrator/__tests__/repository.test.ts.
function makeClient(invoker: RpcInvoker): SupabaseLike {
  return { rpc: invoker };
}

function jsonInvoker(data: unknown): RpcInvoker {
  return (async () => ({ data, error: null })) as RpcInvoker;
}

function errorInvoker(message: string, code?: string): RpcInvoker {
  return (async () => ({
    data: null,
    error: { message, code: code ?? null },
  })) as RpcInvoker;
}

function throwingInvoker(message: string): RpcInvoker {
  return (async () => {
    throw new Error(message);
  }) as RpcInvoker;
}

type CapturedCall = { fn: string; params: Record<string, unknown> };

function capturingInvoker(data: unknown): { invoker: RpcInvoker; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const invoker = (async (fn: string, params: Record<string, unknown>) => {
    calls.push({ fn, params });
    return { data, error: null };
  }) as RpcInvoker;
  return { invoker, calls };
}

const BASE_PARAMS = {
  idempotencyKey: "conversation-handoff:11111111-1111-1111-1111-111111111111:primary",
  contactId: "22222222-2222-2222-2222-222222222222",
  userId: "33333333-3333-3333-3333-333333333333",
  vehicleId: "44444444-4444-4444-4444-444444444444" as string | null,
  textBody: "Sua troca de óleo já passou do prazo recomendado.",
  deliverable: true,
};

const MESSAGE_ID = "55555555-5555-5555-5555-555555555555";
const QUEUE_ID = "66666666-6666-6666-6666-666666666666";

describe("Bloco A — caminho feliz", () => {
  it("1. created (novo) → result:'created' com outboundMessageId/outboundQueueId", async () => {
    const client = makeClient(
      jsonInvoker({
        result: "created",
        outbound_message_id: MESSAGE_ID,
        outbound_queue_id: QUEUE_ID,
      }),
    );

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toEqual({
      result: "created",
      outboundMessageId: MESSAGE_ID,
      outboundQueueId: QUEUE_ID,
    });
  });

  it("2. replayed (mesmo contexto) → result:'replayed' com mesmos ids", async () => {
    const client = makeClient(
      jsonInvoker({
        result: "replayed",
        outbound_message_id: MESSAGE_ID,
        outbound_queue_id: QUEUE_ID,
      }),
    );

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toEqual({
      result: "replayed",
      outboundMessageId: MESSAGE_ID,
      outboundQueueId: QUEUE_ID,
    });
  });
});

describe("Bloco B — idempotency_context_mismatch", () => {
  it("3. outbound_queue com contexto diferente → idempotency_context_mismatch", async () => {
    const client = makeClient(jsonInvoker({ result: "idempotency_context_mismatch" }));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toEqual({ result: "idempotency_context_mismatch" });
  });

  it("4. whatsapp_messages com contexto diferente (mesmo com outbound_queue batendo) → idempotency_context_mismatch", async () => {
    const client = makeClient(jsonInvoker({ result: "idempotency_context_mismatch" }));

    const result = await enqueueConversationHandoffOutbound(client, {
      ...BASE_PARAMS,
      textBody: "texto diferente do original",
    });

    expect(result).toEqual({ result: "idempotency_context_mismatch" });
  });
});

describe("Bloco C — rejeições de argumento", () => {
  it("5. invalid_idempotency_key (vazio)", async () => {
    const client = makeClient(jsonInvoker({ result: "invalid_idempotency_key" }));

    const result = await enqueueConversationHandoffOutbound(client, {
      ...BASE_PARAMS,
      idempotencyKey: "",
    });

    expect(result).toEqual({ result: "invalid_idempotency_key" });
  });

  it("6. invalid_idempotency_key (>255 chars)", async () => {
    const client = makeClient(jsonInvoker({ result: "invalid_idempotency_key" }));

    const result = await enqueueConversationHandoffOutbound(client, {
      ...BASE_PARAMS,
      idempotencyKey: "x".repeat(256),
    });

    expect(result).toEqual({ result: "invalid_idempotency_key" });
  });

  it("7. invalid_text (vazio)", async () => {
    const client = makeClient(jsonInvoker({ result: "invalid_text" }));

    const result = await enqueueConversationHandoffOutbound(client, {
      ...BASE_PARAMS,
      textBody: "",
    });

    expect(result).toEqual({ result: "invalid_text" });
  });

  it("8. invalid_text (>4000 chars)", async () => {
    const client = makeClient(jsonInvoker({ result: "invalid_text" }));

    const result = await enqueueConversationHandoffOutbound(client, {
      ...BASE_PARAMS,
      textBody: "x".repeat(4001),
    });

    expect(result).toEqual({ result: "invalid_text" });
  });
});

describe("Bloco D — rejeições de contato", () => {
  it("9. contact_not_found", async () => {
    const client = makeClient(jsonInvoker({ result: "contact_not_found" }));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toEqual({ result: "contact_not_found" });
  });

  it("10. contact_opted_out", async () => {
    const client = makeClient(jsonInvoker({ result: "contact_opted_out" }));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toEqual({ result: "contact_opted_out" });
  });

  it("11. contact_context_mismatch", async () => {
    const client = makeClient(jsonInvoker({ result: "contact_context_mismatch" }));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toEqual({ result: "contact_context_mismatch" });
  });

  it("12. contact_not_linked", async () => {
    const client = makeClient(jsonInvoker({ result: "contact_not_linked" }));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toEqual({ result: "contact_not_linked" });
  });
});

describe("Bloco E — rejeição de veículo", () => {
  it("13. vehicle_not_found quando vehicleId != null e não existe", async () => {
    const client = makeClient(jsonInvoker({ result: "vehicle_not_found" }));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toEqual({ result: "vehicle_not_found" });
  });
});

describe("Bloco F — fail-closed em erro de RPC", () => {
  it("14. client.rpc lança exceção → retorna null, não propaga", async () => {
    const client = makeClient(throwingInvoker("boom-outbound"));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toBeNull();
  });

  it("15. client.rpc retorna {error} → retorna null", async () => {
    const client = makeClient(errorInvoker("boom-outbound", "P0001"));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toBeNull();
  });

  it("16. nenhum retorno vaza error.message/stack (RPC error e exceção)", async () => {
    const secretMarker = "SECRET_ERROR_MARKER_c6a1";

    const errorResult = await enqueueConversationHandoffOutbound(
      makeClient(errorInvoker(secretMarker, "P0001")),
      BASE_PARAMS,
    );
    const thrownResult = await enqueueConversationHandoffOutbound(
      makeClient(throwingInvoker(secretMarker)),
      BASE_PARAMS,
    );

    for (const value of [errorResult, thrownResult]) {
      expect(JSON.stringify(value)).not.toContain(secretMarker);
    }
  });

  it("17. resposta malformada (result ausente) → retorna null, não lança", async () => {
    const client = makeClient(jsonInvoker({ outbound_message_id: MESSAGE_ID }));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toBeNull();
  });

  it("18. resposta 'created' sem outbound_queue_id → retorna null, não lança", async () => {
    const client = makeClient(jsonInvoker({ result: "created", outbound_message_id: MESSAGE_ID }));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toBeNull();
  });
});

describe("Bloco J — deliverable (status internal vs queued)", () => {
  it("36. deliverable:true → p_deliverable enviado como true na chamada da RPC", async () => {
    const { invoker, calls } = capturingInvoker({
      result: "created",
      outbound_message_id: MESSAGE_ID,
      outbound_queue_id: QUEUE_ID,
    });
    const client = makeClient(invoker);

    await enqueueConversationHandoffOutbound(client, { ...BASE_PARAMS, deliverable: true });

    expect(calls[0]?.params.p_deliverable).toBe(true);
  });

  it("37. deliverable:false → p_deliverable enviado como false na chamada da RPC", async () => {
    const { invoker, calls } = capturingInvoker({
      result: "created",
      outbound_message_id: MESSAGE_ID,
      outbound_queue_id: QUEUE_ID,
    });
    const client = makeClient(invoker);

    await enqueueConversationHandoffOutbound(client, { ...BASE_PARAMS, deliverable: false });

    expect(calls[0]?.params.p_deliverable).toBe(false);
  });

  it("38. resposta invalid_deliverable_flag é tratada como qualquer outra rejeição (fail-closed, sem vazar detalhe)", async () => {
    const client = makeClient(jsonInvoker({ result: "invalid_deliverable_flag" }));

    const result = await enqueueConversationHandoffOutbound(client, BASE_PARAMS);

    expect(result).toEqual({ result: "invalid_deliverable_flag" });
  });
});

describe("Bloco G — helper de idempotency key", () => {
  it("19. formato exato 'conversation-handoff:{id}:{segment}'", () => {
    const key = buildConversationHandoffIdempotencyKey(
      "77777777-7777-7777-7777-777777777777",
      "primary",
    );

    expect(key).toBe("conversation-handoff:77777777-7777-7777-7777-777777777777:primary");
  });

  it("20. determinístico — não gera UUID novo, mesma entrada produz mesma saída", () => {
    const a = buildConversationHandoffIdempotencyKey(
      "88888888-8888-8888-8888-888888888888",
      "supplemental",
    );
    const b = buildConversationHandoffIdempotencyKey(
      "88888888-8888-8888-8888-888888888888",
      "supplemental",
    );

    expect(a).toBe(b);
    expect(a).toBe("conversation-handoff:88888888-8888-8888-8888-888888888888:supplemental");
  });

  it("21. o wrapper passa a chave construída sem modificá-la para o parâmetro p_idempotency_key da RPC", async () => {
    const key = buildConversationHandoffIdempotencyKey(
      "99999999-9999-9999-9999-999999999999",
      "primary",
    );
    const { invoker, calls } = capturingInvoker({
      result: "created",
      outbound_message_id: MESSAGE_ID,
      outbound_queue_id: QUEUE_ID,
    });
    const client = makeClient(invoker);

    await enqueueConversationHandoffOutbound(client, { ...BASE_PARAMS, idempotencyKey: key });

    expect(calls[0]?.params.p_idempotency_key).toBe(key);
  });
});

describe("Bloco I — getConversationHandoffOutboundByKey", () => {
  const KEY = "conversation-handoff:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:primary";

  it("27. found:true com os 3 campos (text_body, outbound_message_id, outbound_queue_id)", async () => {
    const client = makeClient(
      jsonInvoker([
        {
          text_body: "Sua troca de óleo já passou do prazo recomendado.",
          outbound_message_id: MESSAGE_ID,
          outbound_queue_id: QUEUE_ID,
        },
      ]),
    );

    const result = await getConversationHandoffOutboundByKey(client, KEY);

    expect(result).toEqual({
      found: true,
      textBody: "Sua troca de óleo já passou do prazo recomendado.",
      outboundMessageId: MESSAGE_ID,
      outboundQueueId: QUEUE_ID,
    });
  });

  it("28. found:false quando a RPC retorna array vazio (chave inexistente)", async () => {
    const client = makeClient(jsonInvoker([]));

    const result = await getConversationHandoffOutboundByKey(client, KEY);

    expect(result).toEqual({ found: false });
  });

  it("29. client.rpc lança exceção → retorna null, não propaga", async () => {
    const client = makeClient(throwingInvoker("boom-lookup"));

    const result = await getConversationHandoffOutboundByKey(client, KEY);

    expect(result).toBeNull();
  });

  it("30. client.rpc retorna {error} → retorna null", async () => {
    const client = makeClient(errorInvoker("boom-lookup", "P0001"));

    const result = await getConversationHandoffOutboundByKey(client, KEY);

    expect(result).toBeNull();
  });

  it("31. nenhum retorno vaza error.message/stack (RPC error e exceção)", async () => {
    const secretMarker = "SECRET_ERROR_MARKER_lookup77";

    const errorResult = await getConversationHandoffOutboundByKey(
      makeClient(errorInvoker(secretMarker, "P0001")),
      KEY,
    );
    const thrownResult = await getConversationHandoffOutboundByKey(
      makeClient(throwingInvoker(secretMarker)),
      KEY,
    );

    for (const value of [errorResult, thrownResult]) {
      expect(JSON.stringify(value)).not.toContain(secretMarker);
    }
  });

  it("32. resposta malformada (campo faltando) → retorna null, não lança", async () => {
    const client = makeClient(
      jsonInvoker([{ text_body: "texto qualquer", outbound_message_id: MESSAGE_ID }]),
    );

    const result = await getConversationHandoffOutboundByKey(client, KEY);

    expect(result).toBeNull();
  });

  it("33. resposta não-array → retorna null, não lança", async () => {
    const client = makeClient(
      jsonInvoker({ text_body: "texto qualquer", outbound_message_id: MESSAGE_ID }),
    );

    const result = await getConversationHandoffOutboundByKey(client, KEY);

    expect(result).toBeNull();
  });
});

describe("Bloco H — pureza e ausência de escrita direta", () => {
  const outboundSource = readFileSync(
    fileURLToPath(new URL("../outbound.ts", import.meta.url)),
    "utf8",
  );
  const migrationSource = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../migrations/20260813204354_whatsapp_conversation_handoff_outbound.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const lookupMigrationSource = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../migrations/20260814022011_whatsapp_conversation_handoff_ledger_result_status_and_outbound_lookup.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("22. outbound.ts não faz escrita direta: zero .insert(/.update(/.delete(/.upsert(", () => {
    expect(outboundSource).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("23. outbound.ts não importa fetch/Supabase createClient/Deno.env", () => {
    expect(outboundSource).not.toMatch(/\bfetch\(/);
    expect(outboundSource).not.toMatch(/createClient/);
    expect(outboundSource).not.toMatch(/Deno\.env/);
  });

  it("24. zero any/as any/as unknown as/@ts-ignore/@ts-nocheck em outbound.ts", () => {
    expect(outboundSource).not.toMatch(/\bany\b|as any|as unknown as|@ts-ignore|@ts-nocheck/);
  });

  it("25. migration contém a lista completa e correta do ALTER de woq_purpose_chk (7 valores antigos + 'conversation')", () => {
    const alterMatch = migrationSource.match(
      /ALTER TABLE public\.whatsapp_outbound_queue ADD CONSTRAINT woq_purpose_chk[\s\S]*?;/,
    );
    expect(alterMatch).not.toBeNull();
    const alterBody = alterMatch?.[0] ?? "";
    for (const value of [
      "general",
      "onboarding",
      "link_code",
      "link_confirm",
      "opt_out_confirm",
      "commercial",
      "notification",
      "conversation",
    ]) {
      expect(alterBody).toContain(`'${value}'`);
    }
  });

  it("26. migration referencia purpose='conversation' tanto na validação de replay quanto no INSERT da nova emissão", () => {
    expect(migrationSource).toContain("v_existing_q.purpose <> 'conversation'");
    expect(migrationSource).toContain("'text','conversation', p_text_body");
  });

  it("34. get_conversation_handoff_outbound_by_key é só leitura: zero INSERT/UPDATE/DELETE no corpo da função", () => {
    const fnMatch = lookupMigrationSource.match(
      /CREATE OR REPLACE FUNCTION public\.get_conversation_handoff_outbound_by_key[\s\S]*?\$fn\$;/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch?.[0] ?? "";
    expect(fnBody).not.toMatch(/INSERT INTO|UPDATE public\.|DELETE FROM/);
    expect(fnBody).toContain("WHERE idempotency_key = p_idempotency_key");
    expect(fnBody).toContain("AND purpose = 'conversation'");
  });

  it("35. get_conversation_handoff_outbound_by_key tem REVOKE de PUBLIC/anon/authenticated e GRANT só a service_role", () => {
    expect(lookupMigrationSource).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_conversation_handoff_outbound_by_key FROM PUBLIC;",
    );
    expect(lookupMigrationSource).toContain(
      "REVOKE EXECUTE ON FUNCTION public.get_conversation_handoff_outbound_by_key FROM anon, authenticated;",
    );
    expect(lookupMigrationSource).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_conversation_handoff_outbound_by_key TO service_role;",
    );
  });
});
