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
import { selectMaintenanceCorpusForVehicleAdminFn } from "@/lib/maintenance-corpus-selection.functions";
import { buildMaintenanceCorpusContextAdminFn } from "@/lib/maintenance-corpus-context.functions";
import { generateMaintenancePlanFromCorpusDryRunFn } from "@/lib/maintenance-plan-ai-dry-run.functions";

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

      <SelectorTester />

      <ContextInspector />

      <DryRunIaTester />



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

// ─────────────────────────────────────────────────────────────
// Build 6.24 — Smoke test admin do seletor de corpus
// Chama selectMaintenanceCorpusForVehicleAdminFn e renderiza
// ranking + debug. Não altera dados. Não expõe campos
// sensíveis (a função admin já não retorna extracted_text,
// storage_path, file_name, notes ou signed URL).
// ─────────────────────────────────────────────────────────────

type SistemaDistribuicao =
  | ""
  | "correia_dentada"
  | "corrente"
  | "correia_banhada"
  | "desconhecido";

type SelectorForm = {
  brand: string;
  model_group: string;
  modelo_fipe: string;
  versao: string;
  ano_modelo: string;
  combustivel: string;
  motor_textual: string;
  cilindradas: string;
  transmissao: string;
  sistema_distribuicao: SistemaDistribuicao;
  limit: string;
};

const EMPTY_FORM: SelectorForm = {
  brand: "",
  model_group: "",
  modelo_fipe: "",
  versao: "",
  ano_modelo: "",
  combustivel: "",
  motor_textual: "",
  cilindradas: "",
  transmissao: "",
  sistema_distribuicao: "",
  limit: "5",
};

type QuickCase = {
  id: string;
  label: string;
  expectedSlug: string;
  form: SelectorForm;
};

const QUICK_CASES: QuickCase[] = [
  {
    id: "fiat-argo",
    label: "Fiat Argo",
    expectedSlug: "fiat-argo-v1-2",
    form: {
      brand: "fiat",
      model_group: "argo",
      modelo_fipe: "ARGO",
      versao: "1.0 FIREFLY FLEX MANUAL",
      ano_modelo: "2023",
      combustivel: "flex",
      motor_textual: "1.0 firefly",
      cilindradas: "1000",
      transmissao: "manual",
      sistema_distribuicao: "corrente",
      limit: "5",
    },
  },
  {
    id: "peugeot-208",
    label: "Peugeot 208",
    expectedSlug: "peugeot-208-v1-2",
    form: {
      brand: "peugeot",
      model_group: "208",
      modelo_fipe: "208",
      versao: "1.2 PURETECH FLEX MANUAL",
      ano_modelo: "2023",
      combustivel: "flex",
      motor_textual: "1.2 puretech",
      cilindradas: "1200",
      transmissao: "manual",
      sistema_distribuicao: "correia_banhada",
      limit: "5",
    },
  },
  {
    id: "chevrolet-onix",
    label: "Chevrolet Onix",
    expectedSlug: "chevrolet-onix-v1-2",
    form: {
      brand: "chevrolet",
      model_group: "onix",
      modelo_fipe: "ONIX",
      versao: "1.0 TURBO FLEX AUTOMATICO",
      ano_modelo: "2023",
      combustivel: "flex",
      motor_textual: "1.0 turbo",
      cilindradas: "1000",
      transmissao: "automatico",
      sistema_distribuicao: "correia_banhada",
      limit: "5",
    },
  },
  {
    id: "toyota-hilux",
    label: "Toyota Hilux",
    expectedSlug: "toyota-hilux-v1-2",
    form: {
      brand: "toyota",
      model_group: "hilux",
      modelo_fipe: "HILUX",
      versao: "2.8 DIESEL AUTOMATICA",
      ano_modelo: "2022",
      combustivel: "diesel",
      motor_textual: "2.8 diesel",
      cilindradas: "2800",
      transmissao: "automatico",
      sistema_distribuicao: "corrente",
      limit: "5",
    },
  },
  {
    id: "toyota-corolla-cross",
    label: "Toyota Corolla Cross",
    expectedSlug: "toyota-corolla-cross-v1-2",
    form: {
      brand: "toyota",
      model_group: "corolla-cross",
      modelo_fipe: "COROLLA CROSS",
      versao: "1.8 HYBRID CVT",
      ano_modelo: "2024",
      combustivel: "hibrido",
      motor_textual: "1.8 hybrid",
      cilindradas: "1800",
      transmissao: "cvt",
      sistema_distribuicao: "corrente",
      limit: "5",
    },
  },
  {
    id: "byd-song-plus-dm-i",
    label: "BYD Song Plus DM-i",
    expectedSlug: "byd-song-plus-dm-i-v1-2",
    form: {
      brand: "byd",
      model_group: "song-plus-dm-i",
      modelo_fipe: "SONG PLUS DM-I",
      versao: "1.5 HIBRIDO PLUG-IN",
      ano_modelo: "2025",
      combustivel: "hibrido",
      motor_textual: "1.5 plug-in hybrid",
      cilindradas: "1500",
      transmissao: "e-cvt",
      sistema_distribuicao: "desconhecido",
      limit: "5",
    },
  },
  {
    id: "bmw-serie-3",
    label: "BMW Série 3",
    expectedSlug: "bmw-serie-3-v1-2",
    form: {
      brand: "bmw",
      model_group: "serie-3",
      modelo_fipe: "SERIE 3",
      versao: "320i 2.0 TURBO AUTOMATICA",
      ano_modelo: "2021",
      combustivel: "gasolina",
      motor_textual: "2.0 turbo",
      cilindradas: "2000",
      transmissao: "automatico",
      sistema_distribuicao: "corrente",
      limit: "5",
    },
  },
];

type SelectorMatch = {
  id: string;
  slug: string;
  title: string;
  brand: string;
  model_group: string;
  generation_range: string | null;
  year_start: number | null;
  year_end: number | null;
  score: number;
  reasons: string[];
  quality_score: number;
  reviewed_by_admin: boolean;
  published: boolean;
  version: string;
};

type SelectorResult = {
  matches: SelectorMatch[];
  debug: {
    mode: "admin";
    normalizedInput: Record<string, unknown>;
    totalCandidates: number;
    returned: number;
  };
};

function SelectorTester() {
  const [form, setForm] = useState<SelectorForm>(EMPTY_FORM);
  const [expectedSlug, setExpectedSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SelectorResult | null>(null);

  const selectFn = useServerFn(selectMaintenanceCorpusForVehicleAdminFn);

  function setField<K extends keyof SelectorForm>(
    key: K,
    value: SelectorForm[K],
  ) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function loadQuickCase(c: QuickCase) {
    setForm(c.form);
    setExpectedSlug(c.expectedSlug);
    setError(null);
    setResult(null);
  }

  function buildPayload() {
    const s = (v: string) => (v.trim() === "" ? undefined : v.trim());
    const n = (v: string) => {
      const t = v.trim();
      if (t === "") return undefined;
      const num = Number(t);
      return Number.isFinite(num) ? num : undefined;
    };
    const sd =
      form.sistema_distribuicao === "" ? undefined : form.sistema_distribuicao;
    const lim = n(form.limit);
    return {
      brand: form.brand.trim(),
      model_group: s(form.model_group),
      modelo_fipe: s(form.modelo_fipe),
      versao: s(form.versao),
      ano_modelo: n(form.ano_modelo),
      combustivel: s(form.combustivel),
      motor_textual: s(form.motor_textual),
      cilindradas: n(form.cilindradas),
      transmissao: s(form.transmissao),
      sistema_distribuicao: sd,
      limit: lim,
    };
  }

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload = buildPayload();
      if (!payload.brand) {
        setError("brand é obrigatório.");
        return;
      }
      const res = (await selectFn({ data: payload })) as SelectorResult;
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const top = result?.matches[0];
  const slugMismatch =
    expectedSlug && top ? top.slug !== expectedSlug : false;
  const lowScore = top ? top.score < 50 : false;
  const empty = result ? result.matches.length === 0 : false;

  const btn =
    "px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent disabled:opacity-50";
  const input =
    "w-full rounded-md border border-border bg-background px-2 py-1 text-xs";

  return (
    <section className="space-y-3 p-4 rounded-lg border border-border">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Teste de Seleção de Corpus</h2>
        <p className="text-xs text-muted-foreground">
          Chama <code>selectMaintenanceCorpusForVehicleAdminFn</code>{" "}
          (read-only, super-admin, ignora published/reviewed). Não altera
          dados. Não retorna texto extraído, storage_path, file_name, notes ou
          signed URL.
        </p>
      </header>

      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Casos rápidos
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_CASES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={btn}
              onClick={() => loadQuickCase(c)}
              disabled={busy}
              title={`Esperado: ${c.expectedSlug}`}
            >
              {c.label}
            </button>
          ))}
          <button
            type="button"
            className={btn}
            onClick={() => {
              setForm(EMPTY_FORM);
              setExpectedSlug(null);
              setError(null);
              setResult(null);
            }}
            disabled={busy}
          >
            Limpar
          </button>
        </div>
        {expectedSlug ? (
          <div className="text-[11px] text-muted-foreground">
            Top esperado: <code>{expectedSlug}</code>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="brand *">
          <input
            className={input}
            value={form.brand}
            onChange={(e) => setField("brand", e.target.value)}
          />
        </Field>
        <Field label="model_group">
          <input
            className={input}
            value={form.model_group}
            onChange={(e) => setField("model_group", e.target.value)}
          />
        </Field>
        <Field label="modelo_fipe">
          <input
            className={input}
            value={form.modelo_fipe}
            onChange={(e) => setField("modelo_fipe", e.target.value)}
          />
        </Field>
        <Field label="versao">
          <input
            className={input}
            value={form.versao}
            onChange={(e) => setField("versao", e.target.value)}
          />
        </Field>
        <Field label="ano_modelo">
          <input
            type="number"
            className={input}
            value={form.ano_modelo}
            onChange={(e) => setField("ano_modelo", e.target.value)}
          />
        </Field>
        <Field label="combustivel">
          <input
            className={input}
            value={form.combustivel}
            onChange={(e) => setField("combustivel", e.target.value)}
          />
        </Field>
        <Field label="motor_textual">
          <input
            className={input}
            value={form.motor_textual}
            onChange={(e) => setField("motor_textual", e.target.value)}
          />
        </Field>
        <Field label="cilindradas">
          <input
            type="number"
            className={input}
            value={form.cilindradas}
            onChange={(e) => setField("cilindradas", e.target.value)}
          />
        </Field>
        <Field label="transmissao">
          <input
            className={input}
            value={form.transmissao}
            onChange={(e) => setField("transmissao", e.target.value)}
          />
        </Field>
        <Field label="sistema_distribuicao">
          <select
            className={input}
            value={form.sistema_distribuicao}
            onChange={(e) =>
              setField(
                "sistema_distribuicao",
                e.target.value as SistemaDistribuicao,
              )
            }
          >
            <option value="">(vazio)</option>
            <option value="correia_dentada">correia_dentada</option>
            <option value="corrente">corrente</option>
            <option value="correia_banhada">correia_banhada</option>
            <option value="desconhecido">desconhecido</option>
          </select>
        </Field>
        <Field label="limit (1..5)">
          <input
            type="number"
            min={1}
            max={5}
            className={input}
            value={form.limit}
            onChange={(e) => setField("limit", e.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btn + " bg-primary text-primary-foreground border-primary"}
          onClick={run}
          disabled={busy || !form.brand.trim()}
        >
          {busy ? "Testando…" : "Testar seleção admin"}
        </button>
      </div>

      {error ? (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2 py-2">
          Erro: {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3">
          {empty ? (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2 py-2">
              Nenhum match retornado.
            </div>
          ) : null}
          {slugMismatch && top ? (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-2">
              Top esperado: <code>{expectedSlug}</code> — recebido:{" "}
              <code>{top.slug}</code>
            </div>
          ) : null}
          {lowScore && top ? (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-2">
              Score baixo no top match: {top.score}
            </div>
          ) : null}

          {top ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-emerald-700">
                Top match
              </div>
              <div className="text-sm font-semibold">
                {top.slug}{" "}
                <span className="text-xs text-muted-foreground">
                  score={top.score}
                </span>
              </div>
              <div className="text-xs text-foreground">{top.title}</div>
              {top.reasons.length > 0 ? (
                <ul className="text-[11px] text-muted-foreground list-disc pl-5">
                  {top.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">slug</th>
                  <th className="text-right p-2">score</th>
                  <th className="text-left p-2">title</th>
                  <th className="text-left p-2">brand</th>
                  <th className="text-left p-2">model_group</th>
                  <th className="text-left p-2">gen</th>
                  <th className="text-right p-2">y_start</th>
                  <th className="text-right p-2">y_end</th>
                  <th className="text-right p-2">qs</th>
                  <th className="text-center p-2">rev</th>
                  <th className="text-center p-2">pub</th>
                  <th className="text-left p-2">version</th>
                  <th className="text-left p-2">reasons</th>
                </tr>
              </thead>
              <tbody>
                {result.matches.map((m, i) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2 font-mono">{m.slug}</td>
                    <td className="p-2 text-right">{m.score}</td>
                    <td className="p-2">{m.title}</td>
                    <td className="p-2">{m.brand}</td>
                    <td className="p-2">{m.model_group}</td>
                    <td className="p-2">{m.generation_range ?? "—"}</td>
                    <td className="p-2 text-right">{m.year_start ?? "—"}</td>
                    <td className="p-2 text-right">{m.year_end ?? "—"}</td>
                    <td className="p-2 text-right">{m.quality_score}</td>
                    <td className="p-2 text-center">
                      {m.reviewed_by_admin ? "✓" : "—"}
                    </td>
                    <td className="p-2 text-center">
                      {m.published ? "✓" : "—"}
                    </td>
                    <td className="p-2 font-mono">{m.version}</td>
                    <td className="p-2 text-muted-foreground">
                      {m.reasons.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              debug
            </summary>
            <pre className="whitespace-pre-wrap break-words text-muted-foreground">
              {JSON.stringify(result.debug, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Build 6.27 — Inspeção do Technical Context
// Chama buildMaintenanceCorpusContextAdminFn e renderiza
// resumo, warnings, vehicle_input, documents (com excerpt
// limitado) e debug. Não chama IA. Não altera dados.
// Não expõe storage_path, file_name, notes, signed URL nem
// extracted_text completo — apenas o que a server function
// retorna.
// ─────────────────────────────────────────────────────────────

type ContextDocument = {
  slug: string;
  title: string;
  brand: string;
  model_group: string;
  generation_range: string | null;
  year_start: number | null;
  year_end: number | null;
  score: number;
  reasons: string[];
  quality_score: number;
  reviewed_by_admin: boolean;
  published: boolean;
  version: string;
  coverage_json: unknown;
  mechanical_families_json: unknown;
  summary_json: unknown;
  text_excerpt: string;
  text_excerpt_char_count: number;
};

type ContextResult = {
  technical_context: {
    schema_version: string;
    generated_by: string;
    vehicle_input: Record<string, unknown>;
    selection: {
      totalCandidates: number;
      returned: number;
      limit: number;
      maxCharsPerDocument: number;
    };
    documents: ContextDocument[];
    warnings: string[];
  };
  debug: {
    mode: "admin";
    totalCandidates: number;
    returned: number;
  };
};

type ContextForm = SelectorForm & { maxCharsPerDocument: string };

const EMPTY_CONTEXT_FORM: ContextForm = {
  ...EMPTY_FORM,
  limit: "3",
  maxCharsPerDocument: "3000",
};

const WARNING_STYLES: Record<string, string> = {
  sem_documentos:
    "bg-destructive/10 border-destructive/30 text-destructive",
  score_baixo: "bg-amber-50 border-amber-200 text-amber-800",
  corpus_em_curadoria: "bg-sky-50 border-sky-200 text-sky-800",
  corpus_nao_publicado: "bg-sky-50 border-sky-200 text-sky-800",
  texto_curto_no_contexto: "bg-amber-50 border-amber-200 text-amber-800",
};

function ContextInspector() {
  const [form, setForm] = useState<ContextForm>(EMPTY_CONTEXT_FORM);
  const [expectedSlug, setExpectedSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContextResult | null>(null);

  const contextFn = useServerFn(buildMaintenanceCorpusContextAdminFn);

  function setField<K extends keyof ContextForm>(
    key: K,
    value: ContextForm[K],
  ) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function loadQuickCase(c: QuickCase) {
    setForm({
      ...c.form,
      limit: "3",
      maxCharsPerDocument: "3000",
    });
    setExpectedSlug(c.expectedSlug);
    setError(null);
    setResult(null);
  }

  function buildPayload() {
    const s = (v: string) => (v.trim() === "" ? undefined : v.trim());
    const n = (v: string) => {
      const t = v.trim();
      if (t === "") return undefined;
      const num = Number(t);
      return Number.isFinite(num) ? num : undefined;
    };
    const sd =
      form.sistema_distribuicao === "" ? undefined : form.sistema_distribuicao;
    return {
      brand: form.brand.trim(),
      model_group: s(form.model_group),
      modelo_fipe: s(form.modelo_fipe),
      versao: s(form.versao),
      ano_modelo: n(form.ano_modelo),
      combustivel: s(form.combustivel),
      motor_textual: s(form.motor_textual),
      cilindradas: n(form.cilindradas),
      transmissao: s(form.transmissao),
      sistema_distribuicao: sd,
      limit: n(form.limit),
      maxCharsPerDocument: n(form.maxCharsPerDocument),
    };
  }

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload = buildPayload();
      if (!payload.brand) {
        setError("brand é obrigatório.");
        return;
      }
      const res = (await contextFn({ data: payload })) as ContextResult;
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent disabled:opacity-50";
  const input =
    "w-full rounded-md border border-border bg-background px-2 py-1 text-xs";

  const tc = result?.technical_context;
  const documents = tc?.documents ?? [];
  const warnings = tc?.warnings ?? [];

  return (
    <section className="space-y-3 p-4 rounded-lg border border-border">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Inspeção do Technical Context</h2>
        <p className="text-xs text-muted-foreground">
          Chama <code>buildMaintenanceCorpusContextAdminFn</code> (read-only,
          super-admin). Sem IA. Não altera dados. Não retorna texto extraído
          completo, storage_path, file_name, notes ou signed URL.
        </p>
      </header>

      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Casos rápidos
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_CASES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={btn}
              onClick={() => loadQuickCase(c)}
              disabled={busy}
              title={`Esperado: ${c.expectedSlug}`}
            >
              {c.label}
            </button>
          ))}
          <button
            type="button"
            className={btn}
            onClick={() => {
              setForm(EMPTY_CONTEXT_FORM);
              setExpectedSlug(null);
              setError(null);
              setResult(null);
            }}
            disabled={busy}
          >
            Limpar
          </button>
        </div>
        {expectedSlug ? (
          <div className="text-[11px] text-muted-foreground">
            Top esperado: <code>{expectedSlug}</code>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="brand *">
          <input
            className={input}
            value={form.brand}
            onChange={(e) => setField("brand", e.target.value)}
          />
        </Field>
        <Field label="model_group">
          <input
            className={input}
            value={form.model_group}
            onChange={(e) => setField("model_group", e.target.value)}
          />
        </Field>
        <Field label="modelo_fipe">
          <input
            className={input}
            value={form.modelo_fipe}
            onChange={(e) => setField("modelo_fipe", e.target.value)}
          />
        </Field>
        <Field label="versao">
          <input
            className={input}
            value={form.versao}
            onChange={(e) => setField("versao", e.target.value)}
          />
        </Field>
        <Field label="ano_modelo">
          <input
            type="number"
            className={input}
            value={form.ano_modelo}
            onChange={(e) => setField("ano_modelo", e.target.value)}
          />
        </Field>
        <Field label="combustivel">
          <input
            className={input}
            value={form.combustivel}
            onChange={(e) => setField("combustivel", e.target.value)}
          />
        </Field>
        <Field label="motor_textual">
          <input
            className={input}
            value={form.motor_textual}
            onChange={(e) => setField("motor_textual", e.target.value)}
          />
        </Field>
        <Field label="cilindradas">
          <input
            type="number"
            className={input}
            value={form.cilindradas}
            onChange={(e) => setField("cilindradas", e.target.value)}
          />
        </Field>
        <Field label="transmissao">
          <input
            className={input}
            value={form.transmissao}
            onChange={(e) => setField("transmissao", e.target.value)}
          />
        </Field>
        <Field label="sistema_distribuicao">
          <select
            className={input}
            value={form.sistema_distribuicao}
            onChange={(e) =>
              setField(
                "sistema_distribuicao",
                e.target.value as SistemaDistribuicao,
              )
            }
          >
            <option value="">(vazio)</option>
            <option value="correia_dentada">correia_dentada</option>
            <option value="corrente">corrente</option>
            <option value="correia_banhada">correia_banhada</option>
            <option value="desconhecido">desconhecido</option>
          </select>
        </Field>
        <Field label="limit (1..5)">
          <input
            type="number"
            min={1}
            max={5}
            className={input}
            value={form.limit}
            onChange={(e) => setField("limit", e.target.value)}
          />
        </Field>
        <Field label="maxCharsPerDocument (1000..6000)">
          <input
            type="number"
            min={1000}
            max={6000}
            step={500}
            className={input}
            value={form.maxCharsPerDocument}
            onChange={(e) => setField("maxCharsPerDocument", e.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btn + " bg-primary text-primary-foreground border-primary"}
          onClick={run}
          disabled={busy || !form.brand.trim()}
        >
          {busy ? "Montando…" : "Montar technical_context"}
        </button>
      </div>

      {error ? (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2 py-2">
          Erro: {error}
        </div>
      ) : null}

      {tc ? (
        <div className="space-y-3">
          <div className="rounded-md border border-border p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat label="schema_version" value={tc.schema_version} />
            <Stat label="generated_by" value={tc.generated_by} />
            <Stat
              label="totalCandidates"
              value={String(tc.selection.totalCandidates)}
            />
            <Stat label="returned" value={String(tc.selection.returned)} />
            <Stat label="limit" value={String(tc.selection.limit)} />
            <Stat
              label="maxCharsPerDocument"
              value={String(tc.selection.maxCharsPerDocument)}
            />
            <Stat label="documents" value={String(documents.length)} />
            <Stat label="warnings" value={String(warnings.length)} />
          </div>

          {warnings.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {warnings.map((w) => (
                <span
                  key={w}
                  className={
                    "text-[11px] px-2 py-1 rounded border " +
                    (WARNING_STYLES[w] ??
                      "bg-muted border-border text-muted-foreground")
                  }
                >
                  {w}
                </span>
              ))}
            </div>
          ) : null}

          <details className="text-xs" open>
            <summary className="cursor-pointer text-muted-foreground">
              vehicle_input
            </summary>
            <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-2 text-muted-foreground">
              {JSON.stringify(tc.vehicle_input, null, 2)}
            </pre>
          </details>

          <div className="space-y-3">
            {documents.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                Nenhum documento retornado.
              </div>
            ) : (
              documents.map((d, i) => {
                const isExpected =
                  expectedSlug != null && i === 0 && d.slug === expectedSlug;
                const isMismatch =
                  expectedSlug != null && i === 0 && d.slug !== expectedSlug;
                return (
                  <div
                    key={d.slug + ":" + i}
                    className="rounded-md border border-border p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted">
                        #{i + 1}
                      </span>
                      <span className="text-sm font-semibold">{d.title}</span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted">
                        {d.slug}
                      </span>
                      {isExpected ? (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                          match esperado
                        </span>
                      ) : null}
                      {isMismatch ? (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                          esperado: {expectedSlug}
                        </span>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                      <Stat label="brand" value={d.brand} />
                      <Stat label="model_group" value={d.model_group} />
                      <Stat
                        label="generation_range"
                        value={d.generation_range ?? "—"}
                      />
                      <Stat
                        label="years"
                        value={`${d.year_start ?? "—"} → ${d.year_end ?? "—"}`}
                      />
                      <Stat label="score" value={String(d.score)} />
                      <Stat
                        label="quality_score"
                        value={String(d.quality_score)}
                      />
                      <Stat
                        label="reviewed_by_admin"
                        value={d.reviewed_by_admin ? "true" : "false"}
                      />
                      <Stat
                        label="published"
                        value={d.published ? "true" : "false"}
                      />
                      <Stat label="version" value={d.version || "—"} />
                      <Stat
                        label="text_excerpt_chars"
                        value={String(d.text_excerpt_char_count)}
                      />
                    </div>

                    {d.reasons.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {d.reasons.map((r) => (
                          <span
                            key={r}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        summary_json
                      </summary>
                      <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-2 text-muted-foreground">
                        {JSON.stringify(d.summary_json, null, 2)}
                      </pre>
                    </details>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        coverage_json
                      </summary>
                      <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-2 text-muted-foreground">
                        {JSON.stringify(d.coverage_json, null, 2)}
                      </pre>
                    </details>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        mechanical_families_json
                      </summary>
                      <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-2 text-muted-foreground">
                        {JSON.stringify(d.mechanical_families_json, null, 2)}
                      </pre>
                    </details>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        text_excerpt ({d.text_excerpt_char_count} chars)
                      </summary>
                      <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-2 text-foreground">
                        {d.text_excerpt}
                      </pre>
                    </details>
                  </div>
                );
              })
            )}
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              debug
            </summary>
            <pre className="whitespace-pre-wrap break-words text-muted-foreground">
              {JSON.stringify(result?.debug, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-mono break-all">{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Build 6.31 — Dry-run IA do Plano de Manutenção
// Chama generateMaintenancePlanFromCorpusDryRunFn (super-admin,
// dry-run, sem persistência). Não chama upsert, não altera o
// corpus, não publica nada. Exibe apenas o que a server function
// retorna: valid, errors, warnings, ai.provider/model,
// technical_context_debug e raw_preview (já truncado server-side).
// Nunca exibe prompt, technical_context completo, text_excerpt,
// extracted_text, storage_path, file_name, notes, signed URL,
// JWT ou service_role.
// ─────────────────────────────────────────────────────────────

type DryRunForm = {
  brand: string;
  model_group: string;
  modelo_fipe: string;
  versao: string;
  ano_modelo: string;
  combustivel: string;
  motor_textual: string;
  cilindradas: string;
  transmissao: string;
  sistema_distribuicao: "" | "correia_dentada" | "corrente" | "correia_banhada" | "desconhecido";
  km_atual: string;
  uso_severo: boolean;
  historico_desconhecido: boolean;
  limit: string;
  maxCharsPerDocument: string;
};

const EMPTY_DRY_RUN_FORM: DryRunForm = {
  brand: "",
  model_group: "",
  modelo_fipe: "",
  versao: "",
  ano_modelo: "",
  combustivel: "",
  motor_textual: "",
  cilindradas: "",
  transmissao: "",
  sistema_distribuicao: "",
  km_atual: "100000",
  uso_severo: false,
  historico_desconhecido: true,
  limit: "3",
  maxCharsPerDocument: "3000",
};

type DryRunPreset = {
  id: string;
  label: string;
  expectedSlug: string;
  form: DryRunForm;
};

const DRY_RUN_PRESETS: DryRunPreset[] = QUICK_CASES.map((c) => ({
  id: c.id,
  label: c.label,
  expectedSlug: c.expectedSlug,
  form: {
    ...EMPTY_DRY_RUN_FORM,
    brand: c.form.brand,
    model_group: c.form.model_group,
    modelo_fipe: c.form.modelo_fipe,
    versao: c.form.versao,
    ano_modelo: c.form.ano_modelo,
    combustivel: c.form.combustivel,
    motor_textual: c.form.motor_textual,
    cilindradas: c.form.cilindradas,
    transmissao: c.form.transmissao,
    sistema_distribuicao: c.form.sistema_distribuicao as DryRunForm["sistema_distribuicao"],
  },
}));

type DryRunResultUi = {
  valid: boolean;
  plan: unknown;
  errors: string[];
  warnings: string[];
  ai: { provider: string | null; model: string | null; usage?: unknown };
  technical_context_debug: {
    totalCandidates: number;
    returned: number;
    documents: Array<{
      slug: string;
      title: string;
      score: number;
      reasons: string[];
      text_excerpt_char_count: number;
    }>;
  };
  raw_preview?: string;
};

function DryRunIaTester() {
  const [form, setForm] = useState<DryRunForm>(EMPTY_DRY_RUN_FORM);
  const [expectedSlug, setExpectedSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DryRunResultUi | null>(null);

  const dryRunFn = useServerFn(generateMaintenancePlanFromCorpusDryRunFn);

  function setField<K extends keyof DryRunForm>(key: K, value: DryRunForm[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function loadPreset(p: DryRunPreset) {
    setForm(p.form);
    setExpectedSlug(p.expectedSlug);
    setError(null);
    setResult(null);
  }

  function buildPayload() {
    const s = (v: string) => (v.trim() === "" ? undefined : v.trim());
    const n = (v: string) => {
      const t = v.trim();
      if (t === "") return undefined;
      const num = Number(t);
      return Number.isFinite(num) ? num : undefined;
    };
    return {
      brand: form.brand.trim(),
      model_group: s(form.model_group),
      modelo_fipe: s(form.modelo_fipe),
      versao: s(form.versao),
      ano_modelo: n(form.ano_modelo),
      combustivel: s(form.combustivel),
      motor_textual: s(form.motor_textual),
      cilindradas: n(form.cilindradas),
      transmissao: s(form.transmissao),
      sistema_distribuicao:
        form.sistema_distribuicao === "" ? undefined : form.sistema_distribuicao,
      km_atual: n(form.km_atual),
      uso_severo: form.uso_severo,
      historico_desconhecido: form.historico_desconhecido,
      limit: n(form.limit),
      maxCharsPerDocument: n(form.maxCharsPerDocument),
      mode: "strict_json" as const,
    };
  }

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload = buildPayload();
      if (!payload.brand) {
        setError("brand é obrigatório.");
        return;
      }
      const res = (await dryRunFn({ data: payload })) as DryRunResultUi;
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent disabled:opacity-50";
  const input =
    "w-full rounded-md border border-border bg-background px-2 py-1 text-xs";

  const debug = result?.technical_context_debug;
  const documents = debug?.documents ?? [];
  const warnings = result?.warnings ?? [];
  const errors = result?.errors ?? [];
  const plan = result?.plan as Record<string, unknown> | null | undefined;

  function arrCount(v: unknown): number | null {
    return Array.isArray(v) ? v.length : null;
  }

  const planSchemaVersion =
    plan && typeof plan === "object" && "schema_version" in plan
      ? String((plan as Record<string, unknown>).schema_version ?? "")
      : null;
  const planMilestones = plan
    ? arrCount((plan as Record<string, unknown>).milestones) ??
      arrCount((plan as Record<string, unknown>).revisoes)
    : null;
  const planAlerts = plan
    ? arrCount((plan as Record<string, unknown>).alertas) ??
      arrCount((plan as Record<string, unknown>).alerts)
    : null;
  const planSevere = plan
    ? arrCount((plan as Record<string, unknown>).regras_uso_severo) ??
      arrCount((plan as Record<string, unknown>).severe_use_rules)
    : null;

  return (
    <section className="space-y-3 p-4 rounded-lg border border-border">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">
          Dry-run IA do Plano de Manutenção
        </h2>
        <p className="text-xs text-muted-foreground">
          Chama <code>generateMaintenancePlanFromCorpusDryRunFn</code>{" "}
          (super-admin). Não persiste nada. Não altera corpus, profiles,
          quality_score ou reviewed_by_admin. Não expõe prompt, technical_context
          completo, text_excerpt, extracted_text, storage_path, file_name,
          notes, signed URL, JWT ou service_role.
        </p>
        <div className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1">
          Dry-run: este teste não salva nada no banco.
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {DRY_RUN_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={btn}
            onClick={() => loadPreset(p)}
            disabled={busy}
            title={`Esperado: ${p.expectedSlug}`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={btn}
          onClick={() => {
            setForm(EMPTY_DRY_RUN_FORM);
            setExpectedSlug(null);
            setError(null);
            setResult(null);
          }}
          disabled={busy}
        >
          Limpar
        </button>
      </div>

      {expectedSlug ? (
        <div className="text-xs text-muted-foreground">
          Top esperado: <code>{expectedSlug}</code>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <Field label="brand *">
          <input
            className={input}
            value={form.brand}
            onChange={(e) => setField("brand", e.target.value)}
          />
        </Field>
        <Field label="model_group">
          <input
            className={input}
            value={form.model_group}
            onChange={(e) => setField("model_group", e.target.value)}
          />
        </Field>
        <Field label="modelo_fipe">
          <input
            className={input}
            value={form.modelo_fipe}
            onChange={(e) => setField("modelo_fipe", e.target.value)}
          />
        </Field>
        <Field label="versao">
          <input
            className={input}
            value={form.versao}
            onChange={(e) => setField("versao", e.target.value)}
          />
        </Field>
        <Field label="ano_modelo">
          <input
            className={input}
            value={form.ano_modelo}
            onChange={(e) => setField("ano_modelo", e.target.value)}
          />
        </Field>
        <Field label="combustivel">
          <input
            className={input}
            value={form.combustivel}
            onChange={(e) => setField("combustivel", e.target.value)}
          />
        </Field>
        <Field label="motor_textual">
          <input
            className={input}
            value={form.motor_textual}
            onChange={(e) => setField("motor_textual", e.target.value)}
          />
        </Field>
        <Field label="cilindradas">
          <input
            className={input}
            value={form.cilindradas}
            onChange={(e) => setField("cilindradas", e.target.value)}
          />
        </Field>
        <Field label="transmissao">
          <input
            className={input}
            value={form.transmissao}
            onChange={(e) => setField("transmissao", e.target.value)}
          />
        </Field>
        <Field label="sistema_distribuicao">
          <select
            className={input}
            value={form.sistema_distribuicao}
            onChange={(e) =>
              setField(
                "sistema_distribuicao",
                e.target.value as DryRunForm["sistema_distribuicao"],
              )
            }
          >
            <option value="">(vazio)</option>
            <option value="correia_dentada">correia_dentada</option>
            <option value="corrente">corrente</option>
            <option value="correia_banhada">correia_banhada</option>
            <option value="desconhecido">desconhecido</option>
          </select>
        </Field>
        <Field label="km_atual">
          <input
            className={input}
            value={form.km_atual}
            onChange={(e) => setField("km_atual", e.target.value)}
          />
        </Field>
        <Field label="limit (1..5)">
          <input
            className={input}
            value={form.limit}
            onChange={(e) => setField("limit", e.target.value)}
          />
        </Field>
        <Field label="maxCharsPerDocument (1000..6000)">
          <input
            className={input}
            value={form.maxCharsPerDocument}
            onChange={(e) =>
              setField("maxCharsPerDocument", e.target.value)
            }
          />
        </Field>
        <Field label="mode">
          <input className={input} value="strict_json" disabled />
        </Field>
        <Field label="uso_severo">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.uso_severo}
              onChange={(e) => setField("uso_severo", e.target.checked)}
            />
            ativado
          </label>
        </Field>
        <Field label="historico_desconhecido">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.historico_desconhecido}
              onChange={(e) =>
                setField("historico_desconhecido", e.target.checked)
              }
            />
            ativado
          </label>
        </Field>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={btn}
          onClick={run}
          disabled={busy || !form.brand.trim()}
        >
          {busy ? "Gerando…" : "Gerar plano dry-run"}
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-2">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <div
            className={
              "rounded-md border p-3 text-xs " +
              (result.valid
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : "border-destructive/40 bg-destructive/10 text-destructive")
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Stat label="valid" value={result.valid ? "true" : "false"} />
              <Stat label="errors" value={String(errors.length)} />
              <Stat label="warnings" value={String(warnings.length)} />
              <Stat label="ai.provider" value={result.ai.provider ?? "—"} />
              <Stat label="ai.model" value={result.ai.model ?? "—"} />
            </div>
          </div>

          {errors.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-2 space-y-1">
              <div className="font-semibold">Errors</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {errors.map((er, i) => (
                  <li key={i} className="break-words">
                    {er}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {warnings.map((w) => {
                const cls =
                  WARNING_STYLES[w] ??
                  "bg-muted text-muted-foreground border-border";
                return (
                  <span
                    key={w}
                    className={
                      "text-[11px] px-2 py-0.5 rounded border " + cls
                    }
                  >
                    {w}
                  </span>
                );
              })}
            </div>
          ) : null}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Technical context (debug)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <Stat
                label="totalCandidates"
                value={String(debug?.totalCandidates ?? 0)}
              />
              <Stat label="returned" value={String(debug?.returned ?? 0)} />
              <Stat label="documents" value={String(documents.length)} />
            </div>
            {documents.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem documentos.</p>
            ) : (
              <div className="space-y-2">
                {documents.map((d, i) => {
                  const matchOk =
                    expectedSlug != null && i === 0 && d.slug === expectedSlug;
                  return (
                    <div
                      key={d.slug + i}
                      className="rounded-md border border-border p-2 space-y-1"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-xs">{d.slug}</code>
                        <span className="text-xs text-muted-foreground">
                          score {d.score}
                        </span>
                        {matchOk ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                            match esperado
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {d.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        text_excerpt_char_count: {d.text_excerpt_char_count}
                      </div>
                      {d.reasons.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {d.reasons.map((r) => (
                            <span
                              key={r}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {result.raw_preview ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                raw_preview (truncado)
              </summary>
              <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-2 text-muted-foreground">
                {result.raw_preview}
              </pre>
            </details>
          ) : null}

          {result.valid && plan ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Plano validado</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {planSchemaVersion ? (
                  <Stat label="schema_version" value={planSchemaVersion} />
                ) : null}
                {planMilestones != null ? (
                  <Stat label="milestones" value={String(planMilestones)} />
                ) : null}
                {planAlerts != null ? (
                  <Stat label="alertas" value={String(planAlerts)} />
                ) : null}
                {planSevere != null ? (
                  <Stat
                    label="regras_uso_severo"
                    value={String(planSevere)}
                  />
                ) : null}
              </div>

              <PlanReviewPanel plan={plan} />

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Plano validado (JSON)
                </summary>
                <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-2 text-foreground">
                  {JSON.stringify(plan, null, 2)}
                </pre>
              </details>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Build 6.36 — Revisão visual do plano IA validado
// Renderiza apenas o `plan` já validado retornado pela server
// function. Não exibe prompt, technical_context completo,
// text_excerpt, extracted_text, storage_path, file_name, notes,
// signed URL, JWT ou service_role. Não persiste nada.
// ─────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.trim() === "" ? "—" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "—";
  }
}

const HIGHLIGHT_BADGES = new Set([
  "correia_banhada",
  "cvt",
  "desconhecido",
  "preventiva_recomendada",
  "verificar_manual",
]);

function ProfileBadge({ value }: { value: unknown }) {
  const text = displayValue(value);
  const highlight = typeof value === "string" && HIGHLIGHT_BADGES.has(value);
  const cls = highlight
    ? "inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-mono text-amber-900"
    : "inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-mono text-foreground";
  return <span className={cls}>{text}</span>;
}

function KV({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xs font-mono break-all">{displayValue(value)}</div>
    </div>
  );
}

function ReviewCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

function VehicleSummaryCard({ vs }: { vs: Record<string, unknown> | null }) {
  const v = vs ?? {};
  return (
    <ReviewCard title="Resumo do veículo">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KV label="display_name" value={v.display_name} />
        <KV label="marca" value={v.marca} />
        <KV label="modelo_fipe" value={v.modelo_fipe} />
        <KV label="ano_modelo" value={v.ano_modelo} />
        <KV label="combustivel" value={v.combustivel} />
        <KV label="cilindradas" value={v.cilindradas} />
        <KV label="motor_textual" value={v.motor_textual} />
        <KV label="transmissao" value={v.transmissao} />
      </div>
    </ReviewCard>
  );
}

function SystemProfileCard({ sp }: { sp: Record<string, unknown> | null }) {
  const s = sp ?? {};
  return (
    <ReviewCard title="Perfil técnico">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            timing_system
          </div>
          <ProfileBadge value={s.timing_system} />
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            transmission_type
          </div>
          <ProfileBadge value={s.transmission_type} />
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            transmission_service_policy
          </div>
          <ProfileBadge value={s.transmission_service_policy} />
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            transmission_fluid_service_type
          </div>
          <ProfileBadge value={s.transmission_fluid_service_type} />
        </div>
      </div>
    </ReviewCard>
  );
}

function BaseRulesCard({ br }: { br: Record<string, unknown> | null }) {
  const r = br ?? {};
  return (
    <ReviewCard title="Regras base">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <KV label="revision_interval_km" value={r.revision_interval_km} />
        <KV
          label="revision_interval_months"
          value={r.revision_interval_months}
        />
        <KV label="max_planned_km" value={r.max_planned_km} />
        <KV
          label="severe_use_oil_interval_km"
          value={r.severe_use_oil_interval_km}
        />
        <KV
          label="severe_use_oil_interval_months"
          value={r.severe_use_oil_interval_months}
        />
      </div>
    </ReviewCard>
  );
}

function MilestoneBlock({ ms, idx }: { ms: unknown; idx: number }) {
  const m = asRecord(ms) ?? {};
  const items = asArray(m.items);
  return (
    <div className="rounded border border-border bg-muted/20 p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">#{idx + 1}</span>
        <span className="font-mono">{displayValue(m.km)} km</span>
        <span className="text-muted-foreground">{displayValue(m.label)}</span>
        {m.revision_number !== undefined ? (
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-mono">
            rev {displayValue(m.revision_number)}
          </span>
        ) : null}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {items.length} item(ns)
        </span>
      </div>
      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-1 pr-2">item_key</th>
                <th className="text-left py-1 pr-2">label</th>
                <th className="text-left py-1 pr-2">category</th>
                <th className="text-left py-1 pr-2">action</th>
                <th className="text-left py-1 pr-2">recommendation</th>
                <th className="text-left py-1 pr-2">shopping</th>
                <th className="text-left py-1 pr-2">applies</th>
                <th className="text-left py-1 pr-2">km</th>
                <th className="text-left py-1 pr-2">months</th>
                <th className="text-left py-1 pr-2">conf</th>
                <th className="text-left py-1 pr-2">source</th>
              </tr>
            </thead>
            <tbody>
              {items.map((raw, i) => {
                const it = asRecord(raw) ?? {};
                return (
                  <tr key={`${idx}-${i}`} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-mono">{displayValue(it.item_key)}</td>
                    <td className="py-1 pr-2">{displayValue(it.label)}</td>
                    <td className="py-1 pr-2 font-mono">{displayValue(it.category)}</td>
                    <td className="py-1 pr-2 font-mono">{displayValue(it.action)}</td>
                    <td className="py-1 pr-2 font-mono">{displayValue(it.recommendation_type)}</td>
                    <td className="py-1 pr-2 font-mono">{displayValue(it.shopping_classification)}</td>
                    <td className="py-1 pr-2 font-mono">{displayValue(it.applies)}</td>
                    <td className="py-1 pr-2 font-mono">{displayValue(it.interval_km)}</td>
                    <td className="py-1 pr-2 font-mono">{displayValue(it.interval_months)}</td>
                    <td className="py-1 pr-2 font-mono">{displayValue(it.confidence)}</td>
                    <td className="py-1 pr-2 font-mono">{displayValue(it.source_type)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">
          Sem items neste milestone.
        </div>
      )}
    </div>
  );
}

function OptionalJsonDetails({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const count = Array.isArray(value) ? ` (${value.length})` : "";
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {label}
        {count}
      </summary>
      <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-2 text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function PlanReviewPanel({ plan }: { plan: unknown }) {
  const [copyMsg, setCopyMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const p = asRecord(plan);
  if (!p) return null;

  const vs = asRecord(p.vehicle_summary);
  const sp = asRecord(p.system_profile);
  const br = asRecord(p.base_rules);
  const milestones = asArray(p.milestones);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
      setCopyMsg({ ok: true, text: "JSON copiado" });
    } catch {
      setCopyMsg({ ok: false, text: "Não foi possível copiar o JSON" });
    }
    setTimeout(() => setCopyMsg(null), 2000);
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">
          Revisão visual do plano validado
        </h3>
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto px-2 py-1 rounded-md border border-border text-xs font-medium hover:bg-accent"
        >
          Copiar JSON validado
        </button>
        {copyMsg ? (
          <span
            className={
              copyMsg.ok ? "text-xs text-emerald-700" : "text-xs text-red-700"
            }
          >
            {copyMsg.text}
          </span>
        ) : null}
      </div>

      <VehicleSummaryCard vs={vs} />
      <SystemProfileCard sp={sp} />
      <BaseRulesCard br={br} />

      <ReviewCard title={`Milestones (${milestones.length})`}>
        {milestones.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            Nenhum milestone retornado.
          </div>
        ) : (
          <div className="space-y-2">
            {milestones.map((ms, i) => (
              <MilestoneBlock key={i} ms={ms} idx={i} />
            ))}
          </div>
        )}
      </ReviewCard>

      <ReviewCard title="Seções opcionais">
        <div className="space-y-2">
          <OptionalJsonDetails label="fixed_intervals" value={p.fixed_intervals} />
          <OptionalJsonDetails label="severe_use_rules" value={p.severe_use_rules} />
          <OptionalJsonDetails label="age_based_alerts" value={p.age_based_alerts} />
          <OptionalJsonDetails label="not_applicable_items" value={p.not_applicable_items} />
          <OptionalJsonDetails label="purchase_bundles" value={p.purchase_bundles} />
          <OptionalJsonDetails label="general_notes" value={p.general_notes} />
          <OptionalJsonDetails label="safety_disclaimer" value={p.safety_disclaimer} />
        </div>
      </ReviewCard>
    </div>
  );
}


