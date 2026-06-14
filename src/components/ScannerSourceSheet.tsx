import { useRef } from "react";
import { Camera, FileUp, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onClose: () => void;
  onFileSelected: (file: File) => void;
};

/**
 * Menu global de escolha de origem do scanner IA.
 * Exibe duas opções: tirar foto (câmera) ou enviar arquivo/PDF.
 * Após escolher um arquivo, dispara onFileSelected e fecha.
 */
export function ScannerSourceSheet({ open, onClose, onFileSelected }: Props) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onClose();
    onFileSelected(file);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl border-border bg-card p-6">
        <DialogTitle className="text-lg font-semibold text-foreground">
          Adicionar com IA
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Escolha como enviar a nota fiscal ou orçamento.
        </DialogDescription>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleChange}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleChange}
        />

        <div className="mt-2 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="glow-neon flex items-center gap-4 rounded-2xl border border-primary/40 bg-gradient-to-r from-primary/15 to-primary/5 px-5 py-4 text-left transition-transform active:scale-[0.98]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/20 text-primary">
              <Camera className="h-5 w-5" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">Tirar Foto</span>
              <span className="text-[11px] text-muted-foreground">
                Use a câmera do celular
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-4 rounded-2xl border border-border bg-background/40 px-5 py-4 text-left transition-colors hover:border-primary/50"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-foreground">
              <FileUp className="h-5 w-5" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                Enviar Arquivo ou PDF
              </span>
              <span className="text-[11px] text-muted-foreground">
                Imagem da galeria ou PDF salvo
              </span>
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </DialogContent>
    </Dialog>
  );
}
