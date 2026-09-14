// Build Cupom-Promocional — testes de calcularValorComCupom.
// Matchers do shim local (src/lib/__tests__/bun-test.d.ts, resolvido pelo
// mesmo bun:test global): só toBe/toContain/not.toBe/not.toContain.

import { describe, expect, test } from "bun:test";
import { calcularValorComCupom } from "../cupom-promocional.ts";

describe("calcularValorComCupom", () => {
  test("100% de desconto devolve 0", () => {
    expect(calcularValorComCupom(29.9, 100)).toBe(0);
  });

  test("80% de desconto devolve o valor correto arredondado a 2 casas", () => {
    expect(calcularValorComCupom(29.9, 80)).toBe(5.98);
  });

  test("50% de desconto devolve metade do preço base", () => {
    expect(calcularValorComCupom(29.9, 50)).toBe(14.95);
  });

  test("1% de desconto arredonda corretamente", () => {
    expect(calcularValorComCupom(29.9, 1)).toBe(29.6);
  });
});
