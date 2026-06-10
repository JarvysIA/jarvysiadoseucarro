import { useMemo, useRef } from "react";
import { Award, Download, Loader2, ShieldCheck } from "lucide-react";
import jarvysLogoUrl from "@/assets/jarvys-logo.png";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CATEGORIA_COLOR, formatBRL, type Despesa } from "@/lib/despesas";

type Vehicle = {
  id: string;
  marca: string | null;
  modelo: string | null;
  ano: string | null;
  cor: string | null;
  km_atual: number;
  placa: string;
  foto_url: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  vehicle: Vehicle | null;
  revisoes: Despesa[];
  /** Soma estimada de valorização — opcional. */
  somaInvestida: number;
};

/** Hash de autenticidade #JRV-{ANO}-{ID curto}. */
function buildHash(vehicleId: string): string {
  const year = new Date().getFullYear();
  const shortId = vehicleId.slice(0, 8).toUpperCase();
  return `#JRV-${year}-${shortId}`;
}

export function CertificadoJarvysModal({
  open,
  onClose,
  vehicle,
  revisoes,
  somaInvestida,
}: Props) {
  const printRef = useRef<HTMLDivElement | null>(null);
  const hash = useMemo(() => (vehicle ? buildHash(vehicle.id) : ""), [vehicle]);
  const totalRegistros = revisoes.length;

  const handleDownload = async () => {
    if (!vehicle) return;
    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();

      // ---------- Helpers ----------
      const NEON: [number, number, number] = [56, 189, 248];
      const TXT_MUTED: [number, number, number] = [180, 200, 220];
      const TXT_WHITE: [number, number, number] = [240, 245, 252];
      const BG_DARK: [number, number, number] = [8, 14, 26];
      const BG_CARD: [number, number, number] = [14, 22, 38];

      const paintBackground = () => {
        doc.setFillColor(...BG_DARK);
        doc.rect(0, 0, W, H, "F");
        doc.setDrawColor(...NEON);
        doc.setLineWidth(1.2);
        doc.rect(20, 20, W - 40, H - 40);
      };

      const fetchAsDataURL = async (url: string): Promise<string | null> => {
        try {
          const res = await fetch(url, { mode: "cors" });
          if (!res.ok) return null;
          const blob = await res.blob();
          return await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      paintBackground();

      // ---------- Header: Logo oficial centralizada ----------
      const logoDataUrl = await fetchAsDataURL(jarvysLogoUrl);
      let headerBottom = 50;
      if (logoDataUrl) {
        try {
          const props = doc.getImageProperties(logoDataUrl);
          const logoH = 38;
          const logoW = (props.width / props.height) * logoH;
          const logoX = (W - logoW) / 2;
          const fmt = logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
          doc.addImage(logoDataUrl, fmt, logoX, 30, logoW, logoH, undefined, "FAST");
          headerBottom = 30 + logoH;
        } catch (err) {
          console.warn("[PDF logo]", err);
        }
      }
      doc.setTextColor(...TXT_MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(
        "Porta-Luvas Digital — Histórico Oficial",
        W / 2,
        headerBottom + 14,
        { align: "center" },
      );

      // ---------- Imagem do veículo (mantendo aspect ratio) ----------
      let cursorY = headerBottom + 32;
      const boxX = 40;
      const boxY = cursorY;
      const boxW = 200;
      const boxH = 120;
      doc.setDrawColor(...NEON);
      doc.setFillColor(...BG_CARD);
      doc.roundedRect(boxX, boxY, boxW, boxH, 12, 12, "FD");
      if (vehicle.foto_url) {
        const dataUrl = await fetchAsDataURL(vehicle.foto_url);
        if (dataUrl) {
          try {
            const props = doc.getImageProperties(dataUrl);
            const ratio = props.width / props.height;
            const padding = 6;
            const maxW = boxW - padding * 2;
            const maxH = boxH - padding * 2;
            let drawW = maxW;
            let drawH = maxW / ratio;
            if (drawH > maxH) {
              drawH = maxH;
              drawW = maxH * ratio;
            }
            const drawX = boxX + (boxW - drawW) / 2;
            const drawY = boxY + (boxH - drawH) / 2;
            const fmt = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
            doc.addImage(dataUrl, fmt, drawX, drawY, drawW, drawH, undefined, "FAST");
          } catch (err) {
            console.warn("[PDF addImage]", err);
          }
        }
      }

      // ---------- Bloco de identificação do veículo ----------
      const infoX = boxX + boxW + 20;
      doc.setTextColor(...TXT_WHITE);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(`${vehicle.marca ?? "—"} ${vehicle.modelo ?? ""}`.trim(), infoX, boxY + 22);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...TXT_MUTED);
      doc.text(`${vehicle.ano ?? "—"} · ${vehicle.cor ?? "—"}`, infoX, boxY + 40);
      doc.setTextColor(...NEON);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`Placa ${vehicle.placa}`, infoX, boxY + 58);

      // KM destaque
      doc.setTextColor(...NEON);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(26);
      doc.text(`${vehicle.km_atual.toLocaleString("pt-BR")} km`, infoX, boxY + 92);
      doc.setFontSize(8);
      doc.setTextColor(...TXT_MUTED);
      doc.text("Quilometragem atual", infoX, boxY + 106);

      cursorY = boxY + boxH + 30;

      // ---------- Métricas (3 cards) ----------
      const cardW = (W - 80 - 30) / 3;
      const cardH = 82;
      const drawCardBox = (i: number) => {
        const x = 40 + i * (cardW + 15);
        doc.setDrawColor(...NEON);
        doc.setFillColor(...BG_CARD);
        doc.roundedRect(x, cursorY, cardW, cardH, 14, 14, "FD");
        return x;
      };

      // Card 1: número + Registros (centralizado X/Y)
      let cx = drawCardBox(0);
      doc.setTextColor(...NEON);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.text(String(totalRegistros), cx + cardW / 2, cursorY + cardH / 2 - 2, {
        align: "center",
        baseline: "middle",
      });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...TXT_MUTED);
      doc.text("Registros", cx + cardW / 2, cursorY + cardH / 2 + 20, {
        align: "center",
        baseline: "middle",
      });

      // Card 2: "Revisões" / "Documentadas" em duas linhas Y distintas
      cx = drawCardBox(1);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(...NEON);
      doc.text("Revisões", cx + cardW / 2, cursorY + cardH / 2 - 6, {
        align: "center",
        baseline: "middle",
      });
      doc.setTextColor(...TXT_WHITE);
      doc.text("Documentadas", cx + cardW / 2, cursorY + cardH / 2 + 14, {
        align: "center",
        baseline: "middle",
      });

      // Card 3: "+ VALOR" acima / "de revenda" abaixo
      cx = drawCardBox(2);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(...NEON);
      doc.text("+ VALOR", cx + cardW / 2, cursorY + cardH / 2 - 8, {
        align: "center",
        baseline: "middle",
      });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...TXT_WHITE);
      doc.text("de revenda", cx + cardW / 2, cursorY + cardH / 2 + 16, {
        align: "center",
        baseline: "middle",
      });

      cursorY += cardH + 30;

      // ---------- Linha do tempo ----------
      doc.setTextColor(...NEON);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("Linha do tempo das revisões", 40, cursorY);
      cursorY += 18;

      const sorted = [...revisoes].sort(
        (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime(),
      );

      const timelineX = 60;
      const rowGap = 46;

      // Linha vertical contínua à esquerda
      const drawTimelineRail = (from: number, to: number) => {
        doc.setDrawColor(...NEON);
        doc.setLineWidth(0.8);
        doc.line(timelineX, from, timelineX, to);
      };

      if (sorted.length === 0) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        doc.setTextColor(...TXT_MUTED);
        doc.text("Nenhuma revisão registrada ainda.", 60, cursorY + 10);
      } else {
        let railStart = cursorY;
        let railEnd = cursorY;

        for (const r of sorted) {
          if (cursorY > H - 110) {
            drawTimelineRail(railStart, railEnd);
            doc.addPage();
            paintBackground();
            cursorY = 60;
            railStart = cursorY;
          }
          const dt = new Date(r.data).toLocaleDateString("pt-BR");
          const km =
            r.km_registro != null
              ? `${r.km_registro.toLocaleString("pt-BR")} km`
              : "";
          const valor = `R$ ${Number(r.valor).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
          })}`;
          const titulo = r.descricao || r.categoria;

          // Bullet
          doc.setFillColor(...NEON);
          doc.circle(timelineX, cursorY + 8, 3.2, "F");

          // Data
          doc.setTextColor(...NEON);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.text(dt, timelineX + 14, cursorY + 6);

          // Título do serviço
          doc.setTextColor(...TXT_WHITE);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          const tituloLines = doc.splitTextToSize(titulo, W - timelineX - 130);
          doc.text(tituloLines, timelineX + 14, cursorY + 22);

          // KM linha pequena
          if (km) {
            doc.setTextColor(...TXT_MUTED);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            doc.text(km, timelineX + 14, cursorY + 35);
          }

          // Valor à direita
          doc.setTextColor(...NEON);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          doc.text(valor, W - 40, cursorY + 22, { align: "right" });

          railEnd = cursorY + 8;
          cursorY += rowGap;
        }
        drawTimelineRail(railStart, railEnd);
      }

      // ---------- Footer hash ----------
      doc.setDrawColor(...NEON);
      doc.setLineWidth(0.5);
      doc.line(40, H - 60, W - 40, H - 60);
      doc.setTextColor(...NEON);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(hash, W / 2, H - 40, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...TXT_MUTED);
      doc.text("Autenticidade Jarvys — Porta-Luvas Digital", W / 2, H - 26, {
        align: "center",
      });

      doc.save(`certificado-jarvys-${vehicle.placa}.pdf`);
      toast.success("Certificado gerado!");
    } catch (e) {
      console.error("[Certificado PDF]", e);
      toast.error("Falha ao gerar PDF.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-primary/30 bg-[#080e1a] p-0 sm:max-w-lg">
        <div
          ref={printRef}
          className="relative overflow-hidden rounded-lg"
          style={{
            background:
              "radial-gradient(circle at top, rgba(56,189,248,0.18), transparent 60%), #080e1a",
          }}
        >
          {/* Borda neon */}
          <div className="pointer-events-none absolute inset-2 rounded-lg border border-primary/40" />

          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              Certificado Jarvys
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Porta-Luvas Digital — Histórico oficial do veículo.
            </DialogDescription>
          </DialogHeader>

          {vehicle && (
            <div className="flex flex-col gap-5 p-6 pt-2">
              {/* Header veículo */}
              <div className="flex items-center gap-4 rounded-2xl border border-primary/30 bg-card/50 p-4">
                <div className="h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-secondary">
                  {vehicle.foto_url ? (
                    <img
                      src={vehicle.foto_url}
                      alt={`${vehicle.marca} ${vehicle.modelo}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Award className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-foreground">
                    {vehicle.marca ?? "—"} {vehicle.modelo ?? ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {vehicle.ano ?? "—"} · {vehicle.cor ?? "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-primary">
                    Placa {vehicle.placa}
                  </p>
                </div>
              </div>

              {/* KM destaque */}
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Quilometragem atual
                </p>
                <p
                  className="mt-1 text-4xl font-bold text-primary"
                  style={{ textShadow: "0 0 20px rgba(56,189,248,0.6)" }}
                >
                  {vehicle.km_atual.toLocaleString("pt-BR")} km
                </p>
              </div>

              {/* Métricas */}
              <div className="grid grid-cols-3 gap-2">
                <Metric value={`${totalRegistros}`} label="Registros" />
                <div className="flex items-center justify-center rounded-2xl border border-primary/30 bg-card/50 p-3 text-center">
                  <p className="text-sm font-bold leading-tight">
                    <span className="text-primary">Revisões </span>
                    <span className="text-foreground">Documentadas</span>
                  </p>
                </div>
                <div className="rounded-2xl border border-primary/30 bg-card/50 p-3 text-center">
                  <p className="text-base font-bold leading-tight text-primary">
                    + VALOR
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">de revenda</p>
                </div>
              </div>

              {/* Mini timeline */}
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Linha do tempo
                </p>
                {revisoes.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border bg-card/40 p-4 text-center text-xs text-muted-foreground">
                    Nenhuma revisão registrada ainda.
                  </p>
                ) : (
                  <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                    {[...revisoes]
                      .sort(
                        (a, b) =>
                          new Date(b.data).getTime() - new Date(a.data).getTime(),
                      )
                      .map((r) => (
                        <li
                          key={r.id}
                          className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-2 py-1.5 text-[11px]"
                        >
                          <span className="truncate text-foreground">
                            <span
                              className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                              style={{ backgroundColor: CATEGORIA_COLOR[r.categoria] }}
                            />
                            {new Date(r.data).toLocaleDateString("pt-BR")} ·{" "}
                            {r.descricao || r.categoria}
                          </span>
                          <span className="ml-2 shrink-0 font-semibold text-foreground">
                            {formatBRL(Number(r.valor))}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              {/* Hash autenticidade */}
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Autenticidade
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-primary">
                  {hash}
                </p>
              </div>

              {/* Ações */}
              <button
                type="button"
                onClick={handleDownload}
                className="glow-neon flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-3 text-sm font-semibold text-primary-foreground"
              >
                <Download className="h-4 w-4" />
                Baixar PDF do Certificado
              </button>
            </div>
          )}

          {!vehicle && (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-primary/30 bg-card/50 p-3 text-center">
      <p className="text-base font-bold text-primary">{value}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
