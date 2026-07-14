/**
 * Smoke multi-sessão do ambiente MJ1A-V-ENV-CI.
 *
 * Prova:
 *   1) TEST_DATABASE_URL passa no guard pré-conexão;
 *   2) Uma sessão dedicada passa no guard pós-conexão (marker sintético);
 *   3) Duas sessões físicas independentes (pg.Client) coexistem com PIDs
 *      distintos;
 *   4) Antes do COMMIT em A, a linha não é visível em B;
 *   5) Após COMMIT em A, a linha fica visível em B;
 *   6) Após ROLLBACK em A, a segunda linha não é visível em B;
 *   7) Cleanup remove todas as linhas do run — zero leaked rows.
 *
 * Reporta somente PASS_ENV_SMOKE ou falha sanitizada. Nunca imprime DSN,
 * senha, JWT, anon key, service role ou dados reais.
 *
 * Não testa fluxos produtivos do KM. Isso é reservado ao futuro MJ1A-V.
 */

import { randomUUID } from "node:crypto";
import {
  formatPostflightResult,
  formatPreflightResult,
  validateConnectionPostflight,
  validateTestDatabaseUrlPreflight,
} from "./guard";
import { openSession, type Session } from "../../supabase/tests/harness/db";

const SYNTHETIC_PAYLOAD = "smoke-synthetic-payload";

type LineLogger = (line: string) => void;

async function main(): Promise<number> {
  const lines: string[] = [];
  const log: LineLogger = (line) => {
    // eslint-disable-next-line no-console
    console.log(line);
    lines.push(line);
  };

  // (1) Guard pré-conexão
  const pre = validateTestDatabaseUrlPreflight(process.env.TEST_DATABASE_URL);
  log(formatPreflightResult(pre));
  if (!pre.ok) {
    log("SMOKE FAILED: preflight guard");
    return 1;
  }

  let a: Session | null = null;
  let b: Session | null = null;
  const idA = randomUUID();
  const idB = randomUUID();

  try {
    a = await openSession("A");
    b = await openSession("B");

    // (2) Guard pós-conexão em A
    const post = await validateConnectionPostflight(a);
    log(formatPostflightResult(post));
    if (!post.ok) {
      log("SMOKE FAILED: postflight guard");
      return 1;
    }

    // (3) PIDs distintos
    log(`sessions pid_a=${a.backendPid} pid_b=${b.backendPid}`);
    if (a.backendPid === b.backendPid) {
      log("SMOKE FAILED: PIDs iguais — sessões não são físicas independentes");
      return 1;
    }
    log("distinct_pids OK");

    // Pré-limpeza: só remove os UUIDs sintéticos deste run.
    await b.query(
      "delete from jarvys_test_meta.tx_smoke where test_id = any($1::uuid[])",
      [[idA, idB]],
    );

    // (4) Isolamento antes do COMMIT
    await a.begin();
    await a.query(
      "insert into jarvys_test_meta.tx_smoke (test_id, payload) values ($1, $2)",
      [idA, SYNTHETIC_PAYLOAD],
    );
    const seenBeforeCommit = await b.query<{ n: string }>(
      "select count(*)::text as n from jarvys_test_meta.tx_smoke where test_id = $1",
      [idA],
    );
    const nBefore = Number(seenBeforeCommit.rows[0]?.n ?? "0");
    if (nBefore !== 0) {
      log(
        `SMOKE FAILED: B enxergou linha de A antes do commit (n=${nBefore})`,
      );
      return 1;
    }
    log("isolation_before_commit OK");

    // (5) COMMIT em A → visível em B
    await a.commit();
    const seenAfterCommit = await b.query<{ n: string }>(
      "select count(*)::text as n from jarvys_test_meta.tx_smoke where test_id = $1",
      [idA],
    );
    const nAfter = Number(seenAfterCommit.rows[0]?.n ?? "0");
    if (nAfter !== 1) {
      log(`SMOKE FAILED: B não enxergou linha após commit (n=${nAfter})`);
      return 1;
    }
    log("visibility_after_commit OK");

    // (6) ROLLBACK em A → não visível em B
    await a.begin();
    await a.query(
      "insert into jarvys_test_meta.tx_smoke (test_id, payload) values ($1, $2)",
      [idB, SYNTHETIC_PAYLOAD],
    );
    await a.rollback();
    const seenAfterRollback = await b.query<{ n: string }>(
      "select count(*)::text as n from jarvys_test_meta.tx_smoke where test_id = $1",
      [idB],
    );
    const nRollback = Number(seenAfterRollback.rows[0]?.n ?? "0");
    if (nRollback !== 0) {
      log(
        `SMOKE FAILED: B enxergou linha após rollback (n=${nRollback})`,
      );
      return 1;
    }
    log("rollback_invisible OK");

    // (7) Cleanup e verificação de leaked rows
    await b.query(
      "delete from jarvys_test_meta.tx_smoke where test_id = any($1::uuid[])",
      [[idA, idB]],
    );
    const leaked = await b.query<{ n: string }>(
      "select count(*)::text as n from jarvys_test_meta.tx_smoke where test_id = any($1::uuid[])",
      [[idA, idB]],
    );
    const nLeaked = Number(leaked.rows[0]?.n ?? "0");
    if (nLeaked !== 0) {
      log(`SMOKE FAILED: leaked_rows=${nLeaked}`);
      return 1;
    }
    log("leaked_rows=0");

    log("PASS_ENV_SMOKE");
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`SMOKE FAILED: ${msg}`);
    return 1;
  } finally {
    if (a) await a.close();
    if (b) await b.close();

    // Step Summary sanitizado (opcional): grava se GITHUB_STEP_SUMMARY estiver setado.
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      try {
        const fs = await import("node:fs/promises");
        const body = [
          "## Jarvys Test Database — smoke multi-sessão",
          "",
          "```",
          ...lines,
          "```",
          "",
          "- runtime: `orchestrator_mode=off`",
          "- MJ1A-V não executado neste build.",
          "",
        ].join("\n");
        await fs.appendFile(summaryPath, body);
      } catch {
        /* summary é best-effort; nunca falha o build por causa disso */
      }
    }
  }
}

main().then((code) => process.exit(code));
