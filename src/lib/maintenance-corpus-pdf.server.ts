/**
 * Server-only PDF text extraction helper for the Jarvys maintenance corpus.
 *
 * Boundary:
 * - File suffix `.server.ts` keeps it out of the client bundle graph.
 * - `unpdf` is imported dynamically inside the function so it never enters
 *   the module graph at import time.
 * - This helper does NOT touch Supabase, storage buckets, the database,
 *   server functions, AI, OCR, or embeddings. It only converts bytes → text.
 *
 * Downstream policy (e.g. minimum char count, summary_json generation) lives
 * in later builds (6.8 / 6.9), not here.
 */

export type PdfTextExtractionResult = {
  text: string;
  charCount: number;
  pageCount: number;
};

const MAX_PDF_BYTES = 15 * 1024 * 1024;

export async function extractPdfText(
  input: Uint8Array | ArrayBuffer,
): Promise<PdfTextExtractionResult> {
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input);

  if (bytes.byteLength === 0) {
    throw new Error("PDF vazio.");
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error("PDF excede o tamanho máximo.");
  }

  // Dynamic import keeps `unpdf` out of the early bundle graph.
  const { extractText, getDocumentProxy } = await import("unpdf");

  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(bytes);
  } catch {
    throw new Error("Falha ao abrir PDF.");
  }

  let mergedText: string;
  let totalPages: number;
  try {
    const result = await extractText(doc, { mergePages: true });
    mergedText = typeof result.text === "string" ? result.text : "";
    // `unpdf` returns `totalPages` when mergePages is true. Fall back to
    // `doc.numPages` defensively in case the shape ever drifts.
    const reportedTotal = (result as { totalPages?: unknown }).totalPages;
    totalPages =
      typeof reportedTotal === "number" && Number.isFinite(reportedTotal)
        ? reportedTotal
        : doc.numPages;
  } catch {
    throw new Error("Falha ao extrair texto do PDF.");
  }

  const trimmed = mergedText.trim();
  return {
    text: trimmed,
    charCount: trimmed.length,
    pageCount: totalPages,
  };
}
