import { describe, expect, it } from "bun:test";
import { isLikelyE164, normalizeBrazilPhoneToE164 } from "../phone";
import { maskPhone, sanitizeWhatsappPayload } from "../sanitize";
import { zapiProvider } from "../providers/zapi-provider";
import {
  getWhatsappProvider,
  normalizeInboundByProvider,
  verifyWebhookByProvider,
} from "../provider-router";

describe("phone helpers", () => {
  it("normaliza número brasileiro com máscara", () => {
    expect(normalizeBrazilPhoneToE164("(21) 99999-8888")).toBe("+5521999998888");
  });
  it("normaliza número com 55 sem +", () => {
    expect(normalizeBrazilPhoneToE164("5521999998888")).toBe("+5521999998888");
  });
  it("aceita já com +", () => {
    expect(normalizeBrazilPhoneToE164("+5521999998888")).toBe("+5521999998888");
  });
  it("retorna null para input vazio ou inválido", () => {
    expect(normalizeBrazilPhoneToE164("")).toBeNull();
    expect(normalizeBrazilPhoneToE164(null)).toBeNull();
    expect(normalizeBrazilPhoneToE164("123")).toBeNull();
  });
  it("isLikelyE164", () => {
    expect(isLikelyE164("+5521999998888")).toBe(true);
    expect(isLikelyE164("21999998888")).toBe(false);
    expect(isLikelyE164(null)).toBe(false);
    expect(isLikelyE164("+abc")).toBe(false);
  });
});

describe("sanitize", () => {
  it("remove chaves sensíveis", () => {
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
  it("trunca strings gigantes", () => {
    const big = "a".repeat(5000);
    const out = sanitizeWhatsappPayload({ text: big });
    expect(typeof out.text).toBe("string");
    expect((out.text as string).length).toBeLessThan(big.length);
  });
  it("nunca lança para input inválido", () => {
    expect(() => sanitizeWhatsappPayload(null)).not.toThrow();
    expect(() => sanitizeWhatsappPayload(undefined)).not.toThrow();
    expect(() => sanitizeWhatsappPayload(123)).not.toThrow();
    expect(() => sanitizeWhatsappPayload("x")).not.toThrow();
  });
  it("maskPhone", () => {
    expect(maskPhone("+5521999998888")).toBe("+55219****8888");
    expect(maskPhone(null)).toBeNull();
  });
});

describe("zapi normalizeInbound", () => {
  it("mensagem de texto", () => {
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
  it("mensagem com imagem", () => {
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
  it("mensagem com PDF", () => {
    const n = zapiProvider.normalizeInbound({
      messageId: "M3",
      phone: "+5521999998888",
      document: { documentUrl: "https://cdn/x.pdf", mimeType: "application/pdf" },
    });
    expect(n.messageType).toBe("pdf");
    expect(n.mediaMimeType).toBe("application/pdf");
  });
  it("marca isGroup quando phone tem @g.us", () => {
    const n = zapiProvider.normalizeInbound({
      phone: "5521999998888@g.us",
      text: "grupo",
    });
    expect(n.isGroup).toBe(true);
  });
  it("payload desconhecido vira unknown sem crash", () => {
    const n = zapiProvider.normalizeInbound({ foo: "bar" });
    expect(n.messageType).toBe("unknown");
    expect(n.provider).toBe("zapi");
  });
  it("não lança para null/undefined/primitivo", () => {
    expect(() => zapiProvider.normalizeInbound(null)).not.toThrow();
    expect(() => zapiProvider.normalizeInbound(undefined)).not.toThrow();
    expect(() => zapiProvider.normalizeInbound(42)).not.toThrow();
  });
  it("converte timestamp numérico em ISO", () => {
    const n = zapiProvider.normalizeInbound({ phone: "+5521999998888", text: "x", moment: 1700000000 });
    expect(n.receivedAt).toBe(new Date(1700000000 * 1000).toISOString());
  });
});

describe("zapi verifyWebhook", () => {
  it("aceita sem secret esperado (TODO 5.4)", () => {
    expect(zapiProvider.verifyWebhook({}).ok).toBe(true);
  });
  it("valida header quando secret esperado", () => {
    const ok = zapiProvider.verifyWebhook({
      expectedSecret: "s3cret",
      headers: { "x-webhook-secret": "s3cret" },
    });
    expect(ok.ok).toBe(true);
    const bad = zapiProvider.verifyWebhook({
      expectedSecret: "s3cret",
      headers: { "x-webhook-secret": "wrong" },
    });
    expect(bad.ok).toBe(false);
  });
  it("aceita Headers real também", () => {
    const h = new Headers({ "x-zapi-webhook-secret": "abc" });
    expect(zapiProvider.verifyWebhook({ expectedSecret: "abc", headers: h }).ok).toBe(true);
  });
});

describe("zapi sendMessage", () => {
  it("retorna not implemented", async () => {
    const r = await zapiProvider.sendMessage({
      provider: "zapi",
      instanceId: "inst-1",
      phoneE164: "+5521999998888",
      messageType: "text",
      textBody: "oi",
    });
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toContain("not implemented");
  });
});

describe("provider-router", () => {
  it("resolve zapi", () => {
    expect(getWhatsappProvider("zapi").name).toBe("zapi");
  });
  it("lança em provider não suportado", () => {
    expect(() => getWhatsappProvider("meta_cloud")).toThrow();
  });
  it("normalizeInboundByProvider funciona", () => {
    const n = normalizeInboundByProvider("zapi", { phone: "+5521999998888", text: "oi" });
    expect(n.messageType).toBe("text");
  });
  it("verifyWebhookByProvider funciona", () => {
    expect(verifyWebhookByProvider("zapi", {}).ok).toBe(true);
  });
});
