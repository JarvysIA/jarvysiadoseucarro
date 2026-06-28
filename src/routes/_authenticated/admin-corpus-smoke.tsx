import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const PROTECTED_SLUGS = new Set(["volkswagen-gol-v1-2"]);

type AuthState = "checking" | "denied" | "ok";

type LogEntry = {
  ts: string;
  level: "info" | "ok" | "warn" | "err";
  msg: string;
  data?: unknown;
};

type ItemStatus =
  | "pending"
  | "needs_review"
  | "ready"
  | "running"
  | "done"
  | "error"
  | "skipped";

type CorpusItem = {
  id: string;
  file: File;
  // editable
  slug: string;
  title: string;
  brand: string;
  modelGroup: string;
  version: string;
  notes: string;
  // state
  status: ItemStatus;
  needsReview: boolean;
  reviewReason?: string;
  errorMessage?: string;
  result?: {
    storagePath?: string;
    charCount?: number;
    pageCount?: number;
    wordCount?: number;
    sectionsDetected?: Record<string, boolean>;
    detectedKeywords?: Record<string, boolean>;
  };
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Esperado: NN_BRAND_MODEL[_MODEL...]_vMAJ_MIN.pdf
 * ex.: 02_FIAT_ARGO_v1_2.pdf -> brand=fiat, model=argo, version=1.2
 */
function suggestFromFileName(name: string): {
  ok: boolean;
  reason?: string;
  slug: string;
  title: string;
  brand: string;
  modelGroup: string;
  version: string;
} {
  const base = name.replace(/\.pdf$/i, "");
  const m = base.match(/^(\d{2,3})_(.+?)_v(\d+)_(\d+)$/i);
  if (!m) {
    return {
      ok: false,
      reason:
        "Nome não segue NN_MARCA_MODELO_vMAJ_MIN.pdf — revisar manualmente.",
      slug: "",
      title: "",
      brand: "",
      modelGroup: "",
      version: "",
    };
  }
  const middle = m[2];
  const major = m[3];
  const minor = m[4];
  const tokens = middle.split("_").filter(Boolean);
  if (tokens.length < 2) {
    return {
      ok: false,
      reason: "Esperado MARCA_MODELO com ao menos 2 tokens.",
      slug: "",
      title: "",
      brand: "",
      modelGroup: "",
      version: "",
    };
  }
  const brand = tokens[0].toLowerCase();
  const modelTokens = tokens.slice(1).map((t) => t.toLowerCase());
  const modelGroup = modelTokens.join("-");
  const version = `${major}.${minor}`;
  const slug = `${slugify(brand)}-${slugify(modelGroup)}-v${major}-${minor}`;
  const title = `${titleCase(brand)} ${titleCase(modelTokens.join(" "))} — Cronograma Jarvys v${version}`;
  return { ok: true, slug, title, brand, modelGroup, version };
}

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
  return btoa(binary);
}

function validatePdf(f: File): string | null {
  if (!f.name.toLowerCase().endsWith(".pdf")) return "Nome deve terminar em .pdf.";
  if (f.type && f.type !== "application/pdf")
    return "Tipo deve ser application/pdf.";
  if (f.size <= 0) return "Arquivo vazio.";
  if (f.size > MAX_PDF_BYTES) return "Arquivo excede 15 MiB.";
  return null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

function validateItem(it: CorpusItem): string | null {
  const v = validatePdf(it.file);
  if (v) return v;
  if (!it.slug || !SLUG_RE.test(it.slug)) return "slug inválido.";
  if (PROTECTED_SLUGS.has(it.slug))
    return "slug protegido — não reprocessar (Build 6.10 já validado).";
  if (!it.title.trim()) return "title obrigatório.";
  if (!it.brand.trim()) return "brand obrigatória.";
  if (!it.modelGroup.trim()) return "model_group obrigatório.";
  return null;
}

function AdminCorpusSmokePage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [items, setItems] = useState<CorpusItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const stopBatchRef = useRef(false);

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

  function log(level: LogEntry["level"], msg: string, data?: unknown) {
    setLogs((prev) => [
      ...prev,
      { ts: new Date().toISOString(), level, msg, data },
    ]);
  }

  function patchItem(id: string, patch: Partial<CorpusItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: CorpusItem[] = [];
    for (const f of Array.from(files)) {
      const id = `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
      const sug = suggestFromFileName(f.name);
      const protectedSlug = sug.ok && PROTECTED_SLUGS.has(sug.slug);
      next.push({
        id,
        file: f,
        slug: sug.slug,
        title: sug.title,
        brand: sug.brand,
        modelGroup: sug.modelGroup,
        version: sug.version,
        notes: "",
        status: protectedSlug ? "skipped" : sug.ok ? "ready" : "needs_review",
        needsReview: !sug.ok || protectedSlug,
        reviewReason: protectedSlug
          ? "Slug protegido (Build 6.10 já validado). Será ignorado."
          : sug.reason,
      });
    }
    setItems((prev) => [...prev, ...next]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function clearAll() {
    setItems([]);
    setLogs([]);
  }

  async function processItem(item: CorpusItem): Promise<boolean> {
    const tag = `[${item.file.name}]`;
    const vErr = validateItem(item);
    if (vErr) {
      patchItem(item.id, { status: "error", errorMessage: vErr });
      log("err", `${tag} inválido: ${vErr}`);
      return false;
    }
    patchItem(item.id, { status: "running", errorMessage: undefined });

    // 1. upsert
    try {
      log("info", `${tag} 1. upsert metadados`, { slug: item.slug });
      await upsertFn({
        data: {
          slug: item.slug,
          title: item.title,
          brand: item.brand,
          model_group: item.modelGroup,
          source_type: "jarvys_pdf_v1",
          version: item.version || undefined,
          published: false,
          reviewed_by_admin: false,
          quality_score: 0,
          notes: item.notes || undefined,
        },
      });
      log("ok", `${tag} 1. metadados ok`, { slug: item.slug });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      patchItem(item.id, { status: "error", errorMessage: `upsert: ${m}` });
      log("err", `${tag} 1. upsert falhou`, { error: m });
      return false;
    }

    // 2. upload
    let storagePath = "";
    try {
      log("info", `${tag} 2. upload`, { size: item.file.size });
      const b64 = await fileToBase64(item.file);
      const res = await uploadFn({
        data: {
          slug: item.slug,
          fileName: item.file.name,
          contentType: "application/pdf",
          fileBase64: b64,
          sizeBytes: item.file.size,
        },
      });
      const r = res as { storagePath: string; sizeBytes: number };
      storagePath = r.storagePath;
      log("ok", `${tag} 2. upload ok`, {
        storagePath: r.storagePath,
        sizeBytes: r.sizeBytes,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      patchItem(item.id, { status: "error", errorMessage: `upload: ${m}` });
      log("err", `${tag} 2. upload falhou`, { error: m });
      return false;
    }

    // 3. signed URL
    try {
      log("info", `${tag} 3. signed URL`);
      const res = await signedFn({
        data: { slug: item.slug, expiresIn: 300 },
      });
      const r = res as { signedUrl: string; expiresIn: number };
      log("ok", `${tag} 3. signed URL ok`, {
        hasToken: Boolean(r.signedUrl),
        expiresIn: r.expiresIn,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      patchItem(item.id, { status: "error", errorMessage: `signed: ${m}` });
      log("err", `${tag} 3. signed URL falhou`, { error: m });
      return false;
    }

    // 4. extract
    let charCount = 0;
    let pageCount = 0;
    try {
      log("info", `${tag} 4. extrair texto`);
      const res = await extractFn({ data: { slug: item.slug } });
      const r = res as { charCount: number; pageCount: number };
      charCount = r.charCount;
      pageCount = r.pageCount;
      log("ok", `${tag} 4. texto extraído`, {
        charCount: r.charCount,
        pageCount: r.pageCount,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      patchItem(item.id, { status: "error", errorMessage: `extract: ${m}` });
      log("err", `${tag} 4. extract falhou`, { error: m });
      return false;
    }

    // 5. summary
    let wordCount = 0;
    let sectionsDetected: Record<string, boolean> = {};
    let detectedKeywords: Record<string, boolean> = {};
    try {
      log("info", `${tag} 5. summary_json`);
      const res = await summaryFn({ data: { slug: item.slug } });
      const r = res as {
        wordCount: number;
        sectionsDetected: Record<string, boolean>;
        detectedKeywords: Record<string, boolean>;
      };
      wordCount = r.wordCount;
      sectionsDetected = r.sectionsDetected;
      detectedKeywords = r.detectedKeywords;
      log("ok", `${tag} 5. summary ok`, {
        wordCount: r.wordCount,
        sections_detected: r.sectionsDetected,
        detected_keywords: r.detectedKeywords,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      patchItem(item.id, { status: "error", errorMessage: `summary: ${m}` });
      log("err", `${tag} 5. summary falhou`, { error: m });
      return false;
    }

    patchItem(item.id, {
      status: "done",
      result: {
        storagePath,
        charCount,
        pageCount,
        wordCount,
        sectionsDetected,
        detectedKeywords,
      },
    });
    return true;
  }

  /** Heurística: erros estruturais (auth/bucket/banco/parser) param o lote. */
  function isStructuralError(msg: string | undefined): boolean {
    if (!msg) return false;
    const m = msg.toLowerCase();
    return (
      m.includes("acesso negado") ||
      m.includes("não autenticado") ||
      m.includes("nao autenticado") ||
      m.includes("unauthorized") ||
      m.includes("forbidden") ||
      m.includes("falha ao verificar permiss") ||
      m.includes("bucket") ||
      m.includes("storage") ||
      m.includes("network") ||
      m.includes("failed to fetch") ||
      m.includes("500")
    );
  }

  async function runBatch() {
    if (batchBusy) return;
    stopBatchRef.current = false;
    setBatchBusy(true);
    try {
      const targets = items.filter(
        (it) => it.status === "ready" || it.status === "error",
      );
      if (targets.length === 0) {
        log("warn", "Nenhum item pronto para processar.");
        return;
      }
      log("info", `Iniciando lote (${targets.length} item(ns))`);
      for (const it of targets) {
        if (stopBatchRef.current) {
          log("warn", "Lote interrompido por erro estrutural.");
          return;
        }
        const ok = await processItem(it);
        if (!ok) {
          const current = it.errorMessage;
          if (isStructuralError(current)) {
            log(
              "err",
              `Erro estrutural detectado em ${it.file.name}. Parando lote.`,
              { error: current },
            );
            stopBatchRef.current = true;
            return;
          }
          log(
            "warn",
            `Falha isolada em ${it.file.name}; continuando com os próximos.`,
          );
        }
      }
      log("ok", "Lote concluído.");
    } finally {
      setBatchBusy(false);
    }
  }

  async function runOne(id: string) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    if (batchBusy) return;
    setBatchBusy(true);
    try {
      await processItem(it);
    } finally {
      setBatchBusy(false);
    }
  }

  const stats = useMemo(() => {
    const total = items.length;
    const ready = items.filter((i) => i.status === "ready").length;
    const review = items.filter((i) => i.status === "needs_review").length;
    const done = items.filter((i) => i.status === "done").length;
    const err = items.filter((i) => i.status === "error").length;
    const skipped = items.filter((i) => i.status === "skipped").length;
    return { total, ready, review, done, err, skipped };
  }, [items]);

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
  const input =
    "w-full rounded-md border border-border bg-background px-2 py-1 text-xs";

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Corpus — Ingestão em Lote</h1>
        <p className="text-sm text-muted-foreground">
          Rota temporária super-admin. Reutilizável para lotes (02–10, 11–20,
          …). PDFs ficam com <code>published=false</code>,{" "}
          <code>reviewed_by_admin=false</code>, <code>quality_score=0</code>.
        </p>
        <p className="text-xs text-muted-foreground">
          Nome esperado: <code>NN_MARCA_MODELO_vMAJ_MIN.pdf</code> (ex.{" "}
          <code>02_FIAT_ARGO_v1_2.pdf</code>). Slug{" "}
          <code>volkswagen-gol-v1-2</code> é protegido e nunca é reprocessado.
        </p>
      </header>

      <section className="space-y-2 p-4 rounded-lg border border-border">
        <label className="text-sm font-medium">Selecionar PDFs</label>
        <input
          type="file"
          accept="application/pdf"
          multiple
          onChange={(e) => onPickFiles(e.target.files)}
          className="block w-full text-sm"
        />
        <div className="text-xs text-muted-foreground">
          Total: {stats.total} • Prontos: {stats.ready} • Revisar:{" "}
          {stats.review} • Concluídos: {stats.done} • Erros: {stats.err} •
          Protegidos/skipped: {stats.skipped}
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            className={btn + " bg-primary text-primary-foreground border-primary"}
            disabled={batchBusy || stats.ready === 0}
            onClick={runBatch}
          >
            Processar prontos ({stats.ready})
          </button>
          <button className={btn} disabled={batchBusy} onClick={clearAll}>
            Limpar
          </button>
        </div>
      </section>

      <section className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum PDF selecionado.
          </p>
        ) : (
          items.map((it) => (
            <div
              key={it.id}
              className="rounded-lg border border-border p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium truncate">
                  {it.file.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({it.file.size.toLocaleString()} bytes)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={it.status} />
                  <button
                    className={btn}
                    disabled={batchBusy}
                    onClick={() => removeItem(it.id)}
                  >
                    Remover
                  </button>
                </div>
              </div>

              {it.needsReview ? (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Revisar manualmente: {it.reviewReason}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Field label="slug">
                  <input
                    className={input}
                    value={it.slug}
                    onChange={(e) =>
                      patchItem(it.id, {
                        slug: e.target.value,
                        status:
                          PROTECTED_SLUGS.has(e.target.value)
                            ? "skipped"
                            : it.status === "needs_review"
                              ? "ready"
                              : it.status,
                        needsReview:
                          PROTECTED_SLUGS.has(e.target.value) ||
                          !e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="title">
                  <input
                    className={input}
                    value={it.title}
                    onChange={(e) => patchItem(it.id, { title: e.target.value })}
                  />
                </Field>
                <Field label="brand">
                  <input
                    className={input}
                    value={it.brand}
                    onChange={(e) => patchItem(it.id, { brand: e.target.value })}
                  />
                </Field>
                <Field label="model_group">
                  <input
                    className={input}
                    value={it.modelGroup}
                    onChange={(e) =>
                      patchItem(it.id, { modelGroup: e.target.value })
                    }
                  />
                </Field>
                <Field label="version">
                  <input
                    className={input}
                    value={it.version}
                    onChange={(e) =>
                      patchItem(it.id, { version: e.target.value })
                    }
                  />
                </Field>
                <Field label="notes">
                  <input
                    className={input}
                    value={it.notes}
                    onChange={(e) => patchItem(it.id, { notes: e.target.value })}
                  />
                </Field>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="text-xs text-muted-foreground">
                  {it.status === "done" && it.result ? (
                    <span>
                      pages={it.result.pageCount}, chars=
                      {it.result.charCount}, words={it.result.wordCount},
                      storage={it.result.storagePath}
                    </span>
                  ) : it.status === "error" ? (
                    <span className="text-destructive">
                      Erro: {it.errorMessage}
                    </span>
                  ) : null}
                </div>
                <button
                  className={btn}
                  disabled={
                    batchBusy ||
                    it.status === "skipped" ||
                    it.status === "needs_review" ||
                    it.status === "running"
                  }
                  onClick={() => runOne(it.id)}
                >
                  Processar este
                </button>
              </div>

              {it.status === "done" && it.result ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Detalhes do summary_json
                  </summary>
                  <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                    {JSON.stringify(
                      {
                        sections_detected: it.result.sectionsDetected,
                        detected_keywords: it.result.detectedKeywords,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ) : null}
            </div>
          ))
        )}
      </section>

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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1 block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: ItemStatus }) {
  const map: Record<ItemStatus, { label: string; cls: string }> = {
    pending: { label: "pendente", cls: "bg-muted text-foreground" },
    needs_review: {
      label: "revisar",
      cls: "bg-amber-100 text-amber-800 border-amber-200",
    },
    ready: {
      label: "pronto",
      cls: "bg-blue-100 text-blue-800 border-blue-200",
    },
    running: {
      label: "processando…",
      cls: "bg-indigo-100 text-indigo-800 border-indigo-200",
    },
    done: {
      label: "ok",
      cls: "bg-emerald-100 text-emerald-800 border-emerald-200",
    },
    error: {
      label: "erro",
      cls: "bg-destructive/10 text-destructive border-destructive/30",
    },
    skipped: {
      label: "protegido",
      cls: "bg-muted text-muted-foreground",
    },
  };
  const v = map[status];
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${v.cls}`}>
      {v.label}
    </span>
  );
}
