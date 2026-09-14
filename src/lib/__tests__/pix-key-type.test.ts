// Build Saque-Padrinho — testes de detectPixKeyType. Matchers do shim
// local (bun-test.d.ts): só toBe/toContain/not.toBe/not.toContain.

import { describe, expect, test } from "bun:test";
import { detectPixKeyType } from "../pix-key-type";

describe("detectPixKeyType", () => {
  test("CPF: 11 dígitos com máscara", () => {
    expect(detectPixKeyType("123.456.789-00")).toBe("CPF");
  });

  test("CPF: 11 dígitos sem máscara", () => {
    expect(detectPixKeyType("12345678900")).toBe("CPF");
  });

  test("CNPJ: 14 dígitos com máscara", () => {
    expect(detectPixKeyType("12.345.678/0001-95")).toBe("CNPJ");
  });

  test("EMAIL: contém @", () => {
    expect(detectPixKeyType("padrinho@example.com")).toBe("EMAIL");
  });

  test("PHONE: formato E.164 com +", () => {
    expect(detectPixKeyType("+5511987654321")).toBe("PHONE");
  });

  test("EVP: chave aleatória em formato UUID", () => {
    expect(detectPixKeyType("a1b2c3d4-e5f6-47a8-9012-abcdef123456")).toBe("EVP");
  });
});
