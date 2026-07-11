import { describe, expect, test } from "bun:test";
import { normalizeCommandText } from "../normalize.ts";

describe("normalizeCommandText", () => {
  test("empty and whitespace", () => {
    expect(normalizeCommandText(null).isEmpty).toBe(true);
    expect(normalizeCommandText("").isEmpty).toBe(true);
    expect(normalizeCommandText("   \n\t ").isEmpty).toBe(true);
  });

  test("preserves ? isolated", () => {
    const n = normalizeCommandText("?");
    expect(n.isQuestionMarkOnly).toBe(true);
    expect(n.normalizedText).toBe("?");
  });

  test("uppercases and strips diacritics", () => {
    expect(normalizeCommandText("Não").normalizedText).toBe("NAO");
    expect(normalizeCommandText("Não!").normalizedText).toBe("NAO");
    expect(normalizeCommandText("é ótimo").normalizedText).toBe("E OTIMO");
  });

  test("strips emojis", () => {
    expect(normalizeCommandText("oi 👋").normalizedText).toBe("OI");
    expect(normalizeCommandText("👍").normalizedText).toBe("");
  });

  test("collapses whitespace", () => {
    expect(normalizeCommandText("  Bom   dia  ").normalizedText).toBe("BOM DIA");
  });

  test("removes edge punctuation but keeps ?/. isolated behavior", () => {
    expect(normalizeCommandText("ajuda!").normalizedText).toBe("AJUDA");
    expect(normalizeCommandText("...ok...").normalizedText).toBe("OK");
  });

  test("truncates absurdly long text", () => {
    const long = "a".repeat(1000);
    const n = normalizeCommandText(long);
    expect(n.wasTruncatedForComparison).toBe(true);
    expect(n.normalizedText.length).toBeLessThanOrEqual(500);
  });
});
