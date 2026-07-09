import { describe, test, expect } from "bun:test";
import { isLikelyE164, normalizeBrazilPhoneToE164 } from "../phone";
import { maskPhone, sanitizeWhatsappPayload } from "../sanitize";
import { zapiProvider } from "../providers/zapi-provider";
import {
  getWhatsappProvider,
  normalizeInboundByProvider,
  verifyWebhookByProvider,
} from "../provider-router";

describe("phone helpers", () => {
  test("normaliza número brasileiro com máscara", () => {
    expect(normalizeBrazilPhoneToE164("(21) 99999-8888")).toBe("+5521999998888");
  });
  test("normaliza número com 55 sem +", () => {
    expect(normalizeBrazilPhoneToE164("5521999998888")).toBe("+5521999998888");
  });
  test("aceita já com +", () => {
    expect(normalizeBrazilPhoneToE164("+5521999998888")).toBe("+5521999998888");
  });
  test("retorna null para input vazio ou inválido", () => {
    expect(normalizeBrazilPhoneToE164("")).toBe(null);
    expect(normalizeBrazilPhoneToE164(null)).toBe(null);
    expect(normalizeBrazilPhoneToE164("123")).toBe(null);
  });
  test("isLikelyE164 válido", () => {
    expect(isLikelyE164("+5521999998888")).toBe(true);
  });
  test("isLikelyE164 rejeita sem +", () => {
    expect(isLikelyE164("21999998888")).toBe(false);
  });
  test("isLikelyE164 rejeita null", () => {
    expect(isLikelyE164(null)).toBe(false);
  });
  test("isLikelyE164 rejeita não numérico", () => {
    expect(isLikelyE164("+abc")).toBe(false);
  });
});

describe("sanitize", () => {
  test("remove chaves sensíveis", () => {
    const out = sanitizeWhatsappPayload({
      token: "abc",
      authorization: "Bearer x",
      headers: { auth: "x" },
      phone: "+5521999998888",
      text: "oi",
    });
    expect(out.token).toBe("[REDACTED]");
    expect(out.authorization).toBe("[REDACTED]");
    expect(out.headers).toBe("[REDACTED]");
    expect(out.phone).toBe("+5521999998888");
    expect(out.text).toBe("oi");
  });
  test("trunca strings gigantes", () => {
    const big = "a".repeat(5000);
    const out = sanitizeWhatsappPayload({ text: big });
    const truncated = out.text as string;
    expect(typeof truncated).toBe("string");
    expect(truncated.length < big.length).toBe(true);
    expect(truncated).toContain("[truncated]");
  });
  test("nunca lança para null", () => {
    let threw = false;
    try {
      sanitizeWhatsappPayload(null);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
  test("nunca lança para primitivo", () => {
    let threw = false;
    try {
      sanitizeWhatsappPayload(123);
      sanitizeWhatsappPayload("x");
      sanitizeWhatsappPayload(undefined);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
  test("maskPhone mascara meio", () => {
    expect(maskPhone("+5521999998888")).toBe("+55219****8888");
  });
  test("maskPhone aceita null", () => {
    expect(maskPhone(null)).toBe(null);
  });
});

describe("zapi normalizeInbound", () => {
  test("mensagem de texto", () => {
    const n = zapiProvider.normalizeInbound({
      instanceId: "inst-1",
      messageId: "M1",
      phone: "5521999998888",
      senderName: "João",
      text: "olá jarvys",
    });
    expect(n.provider).toBe("zapi");
    expect(n.messageType).toBe("text");
    expect(n.textBody).toBe("olá jarvys");
    expect(n.phoneE164).toBe("+5521999998888");
    expect(n.displayName).toBe("João");
    expect(n.isGroup).toBe(false);
  });
  test("mensagem com imagem", () => {
    const n = zapiProvider.normalizeInbound({
      messageId: "M2",
      phone: "+5521999998888",
      image: { imageUrl: "https://cdn/x.jpg", mimeType: "image/jpeg", caption: "nota" },
    });
    expect(n.messageType).toBe("image");
    expect(n.mediaUrl).toBe("https://cdn/x.jpg");
    expect(n.mediaMimeType).toBe("image/jpeg");
    expect(n.textBody).toBe("nota");
  });
  test("mensagem com PDF", () => {
    const n = zapiProvider.normalizeInbound({
      messageId: "M3",
      phone: "+5521999998888",
      document: { documentUrl: "https://cdn/x.pdf", mimeType: "application/pdf" },
    });
    expect(n.messageType).toBe("pdf");
    expect(n.mediaMimeType).toBe("application/pdf");
  });
  test("marca isGroup quando phone tem @g.us", () => {
    const n = zapiProvider.normalizeInbound({
      phone: "5521999998888@g.us",
      text: "grupo",
    });
    expect(n.isGroup).toBe(true);
  });
  test("payload desconhecido vira unknown sem crash", () => {
    const n = zapiProvider.normalizeInbound({ foo: "bar" });
    expect(n.messageType).toBe("unknown");
    expect(n.provider).toBe("zapi");
  });
  test("não lança para null/primitivo", () => {
    let threw = false;
    try {
      zapiProvider.normalizeInbound(null);
      zapiProvider.normalizeInbound(undefined);
      zapiProvider.normalizeInbound(42);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
  test("converte timestamp numérico em ISO", () => {
    const n = zapiProvider.normalizeInbound({
      phone: "+5521999998888",
      text: "x",
      moment: 1700000000,
    });
    expect(n.receivedAt).toBe(new Date(1700000000 * 1000).toISOString());
  });
});

describe("zapi verifyWebhook", () => {
  test("aceita sem secret esperado (TODO 5.4)", () => {
    expect(zapiProvider.verifyWebhook({}).ok).toBe(true);
  });
  test("valida header quando secret esperado — ok", () => {
    const r = zapiProvider.verifyWebhook({
      expectedSecret: "s3cret",
      headers: { "x-webhook-secret": "s3cret" },
    });
    expect(r.ok).toBe(true);
  });
  test("valida header quando secret esperado — falha", () => {
    const r = zapiProvider.verifyWebhook({
      expectedSecret: "s3cret",
      headers: { "x-webhook-secret": "wrong" },
    });
    expect(r.ok).toBe(false);
  });
  test("aceita Headers real", () => {
    const h = new Headers({ "x-zapi-webhook-secret": "abc" });
    expect(zapiProvider.verifyWebhook({ expectedSecret: "abc", headers: h }).ok).toBe(true);
  });
});

describe("zapi sendMessage", () => {
  test("retorna not implemented", async () => {
    const r = await zapiProvider.sendMessage({
      provider: "zapi",
      instanceId: "inst-1",
      phoneE164: "+5521999998888",
      messageType: "text",
      textBody: "oi",
    });
    expect(r.ok).toBe(false);
    expect(r.errorMessage as string).toContain("not implemented");
  });
});

describe("provider-router", () => {
  test("resolve zapi", () => {
    expect(getWhatsappProvider("zapi").name).toBe("zapi");
  });
  test("lança em provider não suportado", () => {
    let threw = false;
    try {
      getWhatsappProvider("meta_cloud");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
  test("normalizeInboundByProvider funciona", () => {
    const n = normalizeInboundByProvider("zapi", { phone: "+5521999998888", text: "oi" });
    expect(n.messageType).toBe("text");
  });
  test("verifyWebhookByProvider funciona", () => {
    expect(verifyWebhookByProvider("zapi", {}).ok).toBe(true);
  });
});
