import { useState } from "react";
import { Camera, Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { parseReceiptFn, type ParsedReceipt } from "@/lib/parse-receipt.functions";
import { ScannerSourceSheet } from "@/components/ScannerSourceSheet";
import { useCurrentPlan } from "@/lib/use-current-plan";
import {
  can,
  capabilityStartsTrial,
  reasonBlocked,
  type VehicleContext,
} from "@/lib/plan-capabilities";
import { ensureTrialStartedFn } from "@/lib/trial.functions";

type Props = {
  /** Disparado quando a IA termina de ler a nota. */
  onParsed: (parsed: ParsedReceipt, file: File) => void;
  /** Posição vertical opcional (default bottom-44). */
  className?: string;
  /** Status do veículo ativo (Build 3 — gate canUseReceiptScanner). */
  vehicleStatus?: string | null;
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
export function ReceiptScanFab({ onParsed, className, vehicleStatus }: Props) {
  const [scanning, setScanning] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const plan = useCurrentPlan();

  const handleFile = async (file: File) => {
    if (!plan) {
      toast.error("Carregando seu plano… tente novamente em instantes.");
      return;
    }
    const vehicle: VehicleContext | undefined = vehicleStatus
      ? { status: vehicleStatus }
      : undefined;

    if (!can("canUseReceiptScanner", plan, vehicle)) {
      const reason = reasonBlocked("canUseReceiptScanner", plan, vehicle);
      toast.error(
        reason === "trial_expired"
          ? "Seu período de teste expirou."
          : reason === "vehicle_not_activated" || reason === "feature_requires_activation"
            ? "Ative este veículo para usar o scanner."
            : "Recurso indisponível no seu plano.",
      );
      return;
    }

    setScanning(true);
    try {
      if (capabilityStartsTrial("canUseReceiptScanner")) {
        try {
          await ensureTrialStartedFn({ data: { capability: "canUseReceiptScanner" } });
        } catch (e) {
          console.warn("[ReceiptScanFab] ensureTrialStarted", e);
        }
      }
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
