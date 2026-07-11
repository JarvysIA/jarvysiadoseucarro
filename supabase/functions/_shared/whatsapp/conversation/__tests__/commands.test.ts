import { describe, expect, test } from "bun:test";
import { classifyCommand } from "../commands.ts";
import { normalizeCommandText } from "../normalize.ts";

function c(t: string) {
  return classifyCommand(normalizeCommandText(t));
}

describe("classifyCommand groups", () => {
  test("greetings", () => {
    for (const t of ["oi", "Olá", "OPA", "bom dia", "boa tarde", "boa noite", "e aí", "Eai"]) {
      expect(c(t)).toBe("greeting");
    }
  });

  test("help", () => {
    for (const t of ["ajuda", "menu", "help", "como funciona", "o que você faz", "?"]) {
      expect(c(t)).toBe("help");
    }
  });

  test("confirm", () => {
    for (const t of ["sim", "pode", "confirma", "OK", "isso", "pode confirmar"]) {
      expect(c(t)).toBe("confirm");
    }
  });

  test("deny", () => {
    for (const t of ["não", "NAO", "errado", "negativo", "não está certo"]) {
      expect(c(t)).toBe("deny");
    }
  });

  test("cancel_task", () => {
    for (const t of ["cancela", "cancelar", "deixa pra lá", "esquece", "pode ignorar"]) {
      expect(c(t)).toBe("cancel_task");
    }
  });

  test("reset_conversation", () => {
    for (const t of ["recomeçar", "começar de novo", "reiniciar conversa"]) {
      expect(c(t)).toBe("reset_conversation");
    }
  });

  test("explicit_opt_out — exact matches only", () => {
    for (const t of [
      "SAIR",
      "sair",
      "parar",
      "stop",
      "remover meu número",
      "não quero receber mensagens",
      "pare de me enviar mensagens",
      "cancelar mensagens",
    ]) {
      expect(c(t)).toBe("explicit_opt_out");
    }
  });

  test("explicit_opt_out — ambiguous phrases are NOT opt-out", () => {
    for (const t of [
      "cancelar",
      "cancela isso",
      "não quero trocar o óleo",
      "parar o carro",
      "remover o veículo",
      "não quero continuar essa despesa",
    ]) {
      expect(c(t)).not.toBe("explicit_opt_out");
    }
  });

  test("none for random text", () => {
    expect(c("gastei 200 reais com gasolina")).toBe("none");
    expect(c("uber")).toBe("none");
  });
});
