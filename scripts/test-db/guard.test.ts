import { describe, expect, test } from "bun:test";
import {
  formatPreflightResult,
  validateTestDatabaseUrlPreflight,
} from "./guard";

const VALID = "postgresql://postgres:pw@127.0.0.1:54322/postgres";

describe("validateTestDatabaseUrlPreflight", () => {
  test("aceita URL local válida em 127.0.0.1:54322", () => {
    const r = validateTestDatabaseUrlPreflight(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.host).toBe("127.0.0.1");
      expect(r.port).toBe(54322);
      expect(r.database).toBe("postgres");
      expect(r.user).toBe("postgres");
    }
  });

  test("aceita localhost na porta correta", () => {
    const r = validateTestDatabaseUrlPreflight(
      "postgres://postgres:pw@localhost:54322/postgres",
    );
    expect(r.ok).toBe(true);
  });

  test("rejeita URL ausente (undefined)", () => {
    const r = validateTestDatabaseUrlPreflight(undefined);
    expect(r.ok).toBe(false);
  });

  test("rejeita URL vazia", () => {
    const r = validateTestDatabaseUrlPreflight("   ");
    expect(r.ok).toBe(false);
  });

  test("rejeita URL malformada", () => {
    const r = validateTestDatabaseUrlPreflight("not-a-url");
    expect(r.ok).toBe(false);
  });

  test("rejeita supabase.co", () => {
    const r = validateTestDatabaseUrlPreflight(
      "postgresql://postgres:pw@db.abcde.supabase.co:5432/postgres",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/remoto|Hostname/);
  });

  test("rejeita pooler", () => {
    const r = validateTestDatabaseUrlPreflight(
      "postgresql://postgres:pw@aws-1-us-east-2.pooler.supabase.com:6543/postgres",
    );
    expect(r.ok).toBe(false);
  });

  test("rejeita hostname remoto genérico", () => {
    const r = validateTestDatabaseUrlPreflight(
      "postgresql://postgres:pw@example.com:54322/postgres",
    );
    expect(r.ok).toBe(false);
  });

  test("rejeita IPv4 público", () => {
    const r = validateTestDatabaseUrlPreflight(
      "postgresql://postgres:pw@8.8.8.8:54322/postgres",
    );
    expect(r.ok).toBe(false);
  });

  test("rejeita porta diferente", () => {
    const r = validateTestDatabaseUrlPreflight(
      "postgresql://postgres:pw@127.0.0.1:5432/postgres",
    );
    expect(r.ok).toBe(false);
  });

  test("rejeita database diferente", () => {
    const r = validateTestDatabaseUrlPreflight(
      "postgresql://postgres:pw@127.0.0.1:54322/other",
    );
    expect(r.ok).toBe(false);
  });

  test("rejeita usuário diferente", () => {
    const r = validateTestDatabaseUrlPreflight(
      "postgresql://sandbox_exec:pw@127.0.0.1:54322/postgres",
    );
    expect(r.ok).toBe(false);
  });

  test("rejeita protocolo não PostgreSQL", () => {
    const r = validateTestDatabaseUrlPreflight(
      "mysql://postgres:pw@127.0.0.1:54322/postgres",
    );
    expect(r.ok).toBe(false);
  });

  test("não vaza senha na mensagem de erro", () => {
    const secret = "SUPERSECRETPW9999";
    const r = validateTestDatabaseUrlPreflight(
      `postgresql://postgres:${secret}@bad.supabase.co:54322/postgres`,
    );
    const msg = formatPreflightResult(r);
    expect(msg).not.toContain(secret);
  });

  test("não usa DATABASE_URL como fallback", () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = VALID;
    try {
      const r = validateTestDatabaseUrlPreflight(undefined);
      expect(r.ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  test("não usa SUPABASE_DB_URL como fallback", () => {
    const prev = process.env.SUPABASE_DB_URL;
    process.env.SUPABASE_DB_URL = VALID;
    try {
      const r = validateTestDatabaseUrlPreflight(undefined);
      expect(r.ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.SUPABASE_DB_URL;
      else process.env.SUPABASE_DB_URL = prev;
    }
  });

  test("rejeita porta ausente", () => {
    const r = validateTestDatabaseUrlPreflight(
      "postgresql://postgres:pw@127.0.0.1/postgres",
    );
    expect(r.ok).toBe(false);
  });
});
