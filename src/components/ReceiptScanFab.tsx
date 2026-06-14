import { useState } from "react";
import { Camera, Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { parseReceiptFn, type ParsedReceipt } from "@/lib/parse-receipt.functions";
import { ScannerSourceSheet } from "@/components/ScannerSourceSheet";

type Props = {
  /** Disparado quando a IA termina de ler a nota. */
  onParsed: (parsed: ParsedReceipt, file: File) => void;
  /** Posição vertical opcional (default bottom-44). */
  className?: string;
};

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const [, b64] = result.split(",");
      resolve({ base64: b64 || "", mimeType: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

/** FAB secundário (acima do "+") para ler nota fiscal com IA. */
export function ReceiptScanFab({ onParsed, className }: Props) {
  const [scanning, setScanning] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  const handleFile = async (file: File) => {
    setScanning(true);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const res = await parseReceiptFn({ data: { imageBase64: base64, mimeType } });
      if (!res.ok) {
        toast.error(res.error || "Falha ao ler a nota.");
        return;
      }
      toast.success("Nota lida! Confira os dados antes de salvar.");
      onParsed(res.receipt, file);
    } catch (e) {
      console.error("[ReceiptScanFab]", e);
      toast.error(e instanceof Error ? e.message : "Erro ao analisar a nota.");
    } finally {
      setScanning(false);
    }
  };

  return (
    <>
      <ScannerSourceSheet
        open={sourceOpen}
        onClose={() => setSourceOpen(false)}
        onFileSelected={handleFile}
      />
      <button
        type="button"
        onClick={() => setSourceOpen(true)}
        disabled={scanning}
        aria-label="Ler nota fiscal com IA"
        className={`glow-neon fixed right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-primary/40 bg-card text-primary shadow-xl transition-transform active:scale-95 disabled:opacity-70 ${
          className ?? "bottom-44"
        }`}
      >
        {scanning ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : (
          <span className="relative">
            <Camera className="h-6 w-6" />
            <ScanLine className="absolute -bottom-1 -right-1 h-3 w-3 text-primary" />
          </span>
        )}
      </button>
    </>
  );
}
