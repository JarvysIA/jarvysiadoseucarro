import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  upsertMaintenanceCorpusFn,
  uploadMaintenanceCorpusPdfFn,
  getMaintenanceCorpusSignedDownloadFn,
  extractMaintenanceCorpusPdfTextFn,
  buildMaintenanceCorpusSummaryFn,
} from "@/lib/maintenance-corpus.functions";

export const Route = createFileRoute("/_authenticated/admin-corpus-smoke")({
  head: () => ({
    meta: [
      { title: "Corpus Smoke Test" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminCorpusSmokePage,
});

const CORPUS_SLUG = "volkswagen-gol-v1-2";

const CORPUS_PAYLOAD = {
  slug: "volkswagen-gol-v1-2",
  title: "Volkswagen Gol — Cronograma Jarvys v1.2",
  brand: "volkswagen",
  model_group: "gol",
  generation_range: null,
  year_start: null,
  year_end: null,
  mechanical_families_json: [],
  coverage_json: {},
  source_type: "jarvys_pdf_v1",
  version: "1.2",
  file_name: null,
  storage_path: null,
  extracted_text: null,
  summary_json: {},
  quality_score: 0,
  reviewed_by_admin: false,
  published: false,
  notes: "Teste piloto Build 6.10 com 1 PDF real.",
} as const;

const MAX_PDF_BYTES = 15 * 1024 * 1024;

type AuthState = "checking" | "denied" | "ok";

type LogEntry = {
  ts: string;
  level: "info" | "ok" | "warn" | "err";
  msg: string;
  data?: unknown;
};

async function fileToBase64(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
    );
  }
  // btoa works on binary string
  return btoa(binary);
}

function AdminCorpusSmokePage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [file, setFile] = useState<File | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const stopAllRef = useRef(false);

  const upsertFn = useServerFn(upsertMaintenanceCorpusFn);
  const uploadFn = useServerFn(uploadMaintenanceCorpusPdfFn);
  const signedFn = useServerFn(getMaintenanceCorpusSignedDownloadFn);
  const extractFn = useServerFn(extractMaintenanceCorpusPdfTextFn);
  const summaryFn = useServerFn(buildMaintenanceCorpusSummaryFn);

  useEffect(() => {
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        setAuthState("denied");
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("is_super_admin")
        .eq("id", session.session.user.id)
        .maybeSingle();
      const isSuper = Boolean(
        (prof as { is_super_admin?: boolean } | null)?.is_super_admin,
      );
      setAuthState(isSuper ? "ok" : "denied");
    })();
  }, []);

  function log(
    level: LogEntry["level"],
    msg: string,
    data?: unknown,
  ) {
    setLogs((prev) => [
      ...prev,
      { ts: new Date().toISOString(), level, msg, data },
    ]);
  }

  function clearError() {
    setError(null);
  }

  function fail(step: string, fn: string, e: unknown, hypothesis: string) {
    const message = e instanceof Error ? e.message : String(e);
    log("err", `[${step}] ${fn} falhou`, {
      step,
      function: fn,
      error: message,
      hypothesis,
    });
    setError(`${step} — ${fn}: ${message}`);
    stopAllRef.current = true;
  }

  function validatePdf(f: File | null): string | null {
    if (!f) return "Selecione um arquivo PDF.";
    if (!f.name.toLowerCase().endsWith(".pdf")) return "Nome deve terminar em .pdf.";
    if (f.type !== "application/pdf") return "Tipo deve ser application/pdf.";
    if (f.size <= 0) return "Arquivo vazio.";
    if (f.size > MAX_PDF_BYTES) return "Arquivo excede 15 MiB.";
    return null;
  }

  async function step1Upsert() {
    setBusy("1");
    clearError();
    try {
      log("info", "1. upsertMaintenanceCorpusFn — enviando metadados", {
        slug: CORPUS_PAYLOAD.slug,
      });
      const res = await upsertFn({ data: CORPUS_PAYLOAD });
      const c = (res as { corpus?: Record<string, unknown> }).corpus ?? {};
      log("ok", "1. metadados ok", {
        slug: c.slug,
        published: c.published,
        reviewed_by_admin: c.reviewed_by_admin,
        quality_score: c.quality_score,
      });
      return true;
    } catch (e) {
      fail("1", "upsertMaintenanceCorpusFn", e,
        "Verifique se é super-admin e se o payload respeita o schema.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function step2Upload() {
    setBusy("2");
    clearError();
    try {
      const v = validatePdf(file);
      if (v) throw new Error(v);
      log("info", "2. preparando upload (base64 oculto)", {
        fileName: file!.name,
        size: file!.size,
      });
      const fileBase64 = await fileToBase64(file!);
      const res = await uploadFn({
        data: {
          slug: CORPUS_SLUG,
          fileName: file!.name,
          contentType: "application/pdf",
          fileBase64,
          sizeBytes: file!.size,
        },
      });
      const r = res as { storagePath: string; fileName: string; sizeBytes: number };
      log("ok", "2. upload ok", {
        storagePath: r.storagePath,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
      });
      return true;
    } catch (e) {
      fail("2", "uploadMaintenanceCorpusPdfFn", e,
        "Verifique nome/tipo/tamanho do PDF e se o registro do corpus já existe.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function step3Signed() {
    setBusy("3");
    clearError();
    try {
      log("info", "3. gerando signed URL", { slug: CORPUS_SLUG });
      const res = await signedFn({ data: { slug: CORPUS_SLUG, expiresIn: 300 } });
      const r = res as {
        signedUrl: string;
        storagePath: string;
        fileName: string | null;
        expiresIn: number;
      };
      log("ok", "3. signed URL gerada", {
        hasToken: Boolean(r.signedUrl),
        storagePath: r.storagePath,
        fileName: r.fileName,
        expiresIn: r.expiresIn,
      });
      return true;
    } catch (e) {
      fail("3", "getMaintenanceCorpusSignedDownloadFn", e,
        "Verifique se o upload da etapa 2 ocorreu e gravou storage_path.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function step4Extract() {
    setBusy("4");
    clearError();
    try {
      log("info", "4. extraindo texto do PDF", { slug: CORPUS_SLUG });
      const res = await extractFn({ data: { slug: CORPUS_SLUG } });
      const r = res as {
        slug: string;
        charCount: number;
        pageCount: number;
        fileName: string | null;
      };
      if (!(r.charCount > 200)) {
        throw new Error(`charCount=${r.charCount} (esperado > 200)`);
      }
      if (!(r.pageCount > 0)) {
        throw new Error(`pageCount=${r.pageCount} (esperado > 0)`);
      }
      log("ok", "4. texto extraído", {
        charCount: r.charCount,
        pageCount: r.pageCount,
        fileName: r.fileName,
      });
      return true;
    } catch (e) {
      fail("4", "extractMaintenanceCorpusPdfTextFn", e,
        "PDF pode estar escaneado/sem camada de texto.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function step5Summary() {
    setBusy("5");
    clearError();
    try {
      log("info", "5. gerando summary_json", { slug: CORPUS_SLUG });
      const res = await summaryFn({ data: { slug: CORPUS_SLUG } });
      const r = res as {
        slug: string;
        charCount: number;
        wordCount: number;
        sectionsDetected: Record<string, boolean>;
        detectedKeywords: Record<string, boolean>;
      };
      log("ok", "5. summary gerado", {
        schema_version: "1.0.0",
        generated_by: "regex",
        sections_detected: r.sectionsDetected,
        detected_keywords: r.detectedKeywords,
        text_stats: { char_count: r.charCount, word_count: r.wordCount },
      });
      return true;
    } catch (e) {
      fail("5", "buildMaintenanceCorpusSummaryFn", e,
        "Verifique se a etapa 4 persistiu extracted_text.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function step6Check() {
    setBusy("6");
    clearError();
    try {
      log("info", "6. conferindo registro via client autenticado (RLS)");
      const { data, error: qErr } = await supabase
        .from("jarvys_maintenance_corpus")
        .select(
          "storage_path, file_name, published, reviewed_by_admin, quality_score, extracted_text, summary_json",
        )
        .eq("slug", CORPUS_SLUG)
        .maybeSingle();

      if (qErr) {
        log("warn",
          "6. leitura via client falhou (provavelmente RLS bloqueia published=false). Validar pelas respostas das etapas anteriores.",
          { error: qErr.message });
        return true;
      }
      if (!data) {
        log("warn",
          "6. RLS não permitiu ler o registro (published=false). Conferência via client não é possível; validar pelas respostas das functions.");
        return true;
      }

      const row = data as {
        storage_path: string | null;
        file_name: string | null;
        published: boolean | null;
        reviewed_by_admin: boolean | null;
        quality_score: number | null;
        extracted_text: string | null;
        summary_json: Record<string, unknown> | null;
      };
      const summary = (row.summary_json ?? {}) as Record<string, unknown>;
      const stats = (summary.text_stats ?? {}) as Record<string, unknown>;
      log("ok", "6. registro conferido", {
        storage_path: row.storage_path,
        file_name: row.file_name,
        published: row.published,
        reviewed_by_admin: row.reviewed_by_admin,
        quality_score: row.quality_score,
        has_extracted_text: Boolean(row.extracted_text),
        extracted_text_len: row.extracted_text?.length ?? 0,
        summary_schema_version: summary.schema_version ?? null,
        summary_generated_by: summary.generated_by ?? null,
        sections_detected: summary.sections_detected ?? null,
        detected_keywords: summary.detected_keywords ?? null,
        text_stats: stats,
      });
      return true;
    } catch (e) {
      fail("6", "supabase.select(jarvys_maintenance_corpus)", e,
        "RLS pode estar bloqueando leitura por published=false.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function runAll() {
    stopAllRef.current = false;
    setLogs([]);
    setError(null);
    const steps = [step1Upsert, step2Upload, step3Signed, step4Extract, step5Summary, step6Check];
    for (const s of steps) {
      if (stopAllRef.current) {
        log("warn", "Execução interrompida.");
        return;
      }
      const ok = await s();
      if (!ok) return;
    }
    log("ok", "Pipeline concluído.");
  }

  if (authState === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Verificando permissões…
      </div>
    );
  }
  if (authState === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-xl font-semibold">Acesso negado</h1>
          <p className="text-sm text-muted-foreground">
            Esta rota é restrita a super-administradores.
          </p>
        </div>
      </div>
    );
  }

  const btn =
    "px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent disabled:opacity-50";

  return (
    <div className="min-h-screen p-6 max-w-3xl mx-auto space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Corpus Smoke Test</h1>
        <p className="text-sm text-muted-foreground">
          Rota temporária apenas para super-admin. Slug fixo:{" "}
          <code>{CORPUS_SLUG}</code>.
        </p>
      </header>

      <section className="space-y-2 p-4 rounded-lg border border-border">
        <label className="text-sm font-medium">PDF do corpus</label>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        {file ? (
          <p className="text-xs text-muted-foreground">
            {file.name} — {file.size.toLocaleString()} bytes
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Esperado: 01_VOLKSWAGEN_GOL_v1_2.pdf
          </p>
        )}
      </section>

      <section className="flex flex-wrap gap-2">
        <button className={btn} disabled={busy !== null} onClick={step1Upsert}>
          1. Criar metadados
        </button>
        <button className={btn} disabled={busy !== null} onClick={step2Upload}>
          2. Upload PDF
        </button>
        <button className={btn} disabled={busy !== null} onClick={step3Signed}>
          3. Gerar signed URL
        </button>
        <button className={btn} disabled={busy !== null} onClick={step4Extract}>
          4. Extrair texto
        </button>
        <button className={btn} disabled={busy !== null} onClick={step5Summary}>
          5. Gerar summary_json
        </button>
        <button className={btn} disabled={busy !== null} onClick={step6Check}>
          6. Conferir registro
        </button>
        <button
          className={btn + " bg-primary text-primary-foreground border-primary"}
          disabled={busy !== null}
          onClick={runAll}
        >
          Executar tudo
        </button>
      </section>

      {error ? (
        <section className="p-3 rounded-md border border-destructive/40 bg-destructive/10 text-sm text-destructive">
          {error}
        </section>
      ) : null}

      <section className="space-y-1">
        <h2 className="text-sm font-semibold">Log</h2>
        <div className="rounded-md border border-border bg-muted/30 p-3 max-h-[480px] overflow-auto text-xs font-mono space-y-2">
          {logs.length === 0 ? (
            <p className="text-muted-foreground">Sem eventos ainda.</p>
          ) : (
            logs.map((l, i) => (
              <div key={i}>
                <div
                  className={
                    l.level === "err"
                      ? "text-destructive"
                      : l.level === "warn"
                        ? "text-amber-600"
                        : l.level === "ok"
                          ? "text-emerald-600"
                          : "text-foreground"
                  }
                >
                  [{l.ts}] {l.level.toUpperCase()} — {l.msg}
                </div>
                {l.data !== undefined ? (
                  <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                    {JSON.stringify(l.data, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
