import { useMemo, useRef } from "react";
import { Award, Download, Loader2, ShieldCheck } from "lucide-react";
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

      // Fundo dark
      doc.setFillColor(8, 14, 26);
      doc.rect(0, 0, W, H, "F");
      // Borda neon
      doc.setDrawColor(56, 189, 248);
      doc.setLineWidth(2);
      doc.rect(20, 20, W - 40, H - 40);

      // Header
      doc.setTextColor(56, 189, 248);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(28);
      doc.text("Certificado Jarvys", W / 2, 70, { align: "center" });

      doc.setTextColor(180, 200, 220);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text("Porta-Luvas Digital — Histórico Oficial", W / 2, 92, { align: "center" });

      // Bloco veículo
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text(
        `${vehicle.marca ?? "—"} ${vehicle.modelo ?? ""}`.trim(),
        W / 2,
        135,
        { align: "center" },
      );
      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.setTextColor(180, 200, 220);
      doc.text(
        `${vehicle.ano ?? "—"} · ${vehicle.cor ?? "—"} · Placa ${vehicle.placa}`,
        W / 2,
        155,
        { align: "center" },
      );

      // KM destaque
      doc.setTextColor(56, 189, 248);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(36);
      doc.text(
        `${vehicle.km_atual.toLocaleString("pt-BR")} km`,
        W / 2,
        205,
        { align: "center" },
      );
      doc.setFontSize(10);
      doc.setTextColor(160, 180, 200);
      doc.text("Quilometragem atual", W / 2, 222, { align: "center" });

      // Métricas
      const metricsY = 260;
      const cardW = (W - 80 - 30) / 3;
      const cards = [
        { v: String(totalRegistros), l: "Registros" },
        { v: String(totalRegistros), l: "Revisões Documentadas" },
        { v: `+ ${formatBRL(somaInvestida)}`, l: "de revenda" },
      ];
      cards.forEach((c, i) => {
        const x = 40 + i * (cardW + 15);
        doc.setDrawColor(56, 189, 248);
        doc.setFillColor(14, 22, 38);
        doc.roundedRect(x, metricsY, cardW, 70, 8, 8, "FD");
        doc.setTextColor(56, 189, 248);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text(c.v, x + cardW / 2, metricsY + 30, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(180, 200, 220);
        doc.text(c.l, x + cardW / 2, metricsY + 50, { align: "center" });
      });

      // Linha do tempo (revisões)
      let y = metricsY + 100;
      doc.setTextColor(56, 189, 248);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("Linha do tempo das revisões", 40, y);
      y += 18;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(220, 230, 240);

      const sorted = [...revisoes].sort(
        (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime(),
      );
      for (const r of sorted) {
        if (y > H - 80) {
          doc.addPage();
          doc.setFillColor(8, 14, 26);
          doc.rect(0, 0, W, H, "F");
          y = 50;
        }
        const dt = new Date(r.data).toLocaleDateString("pt-BR");
        const km = r.km_registro != null ? ` · ${r.km_registro.toLocaleString("pt-BR")} km` : "";
        const line = `• ${dt} — ${r.descricao || r.categoria}${km}  ·  ${formatBRL(Number(r.valor))}`;
        const wrapped = doc.splitTextToSize(line, W - 80);
        doc.text(wrapped, 40, y);
        y += wrapped.length * 14 + 2;
      }

      // Footer hash
      doc.setDrawColor(56, 189, 248);
      doc.setLineWidth(0.5);
      doc.line(40, H - 60, W - 40, H - 60);
      doc.setTextColor(56, 189, 248);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(hash, W / 2, H - 40, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(160, 180, 200);
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
                <Metric value={`${totalRegistros}`} label="Revisões Documentadas" />
                <div className="rounded-2xl border border-primary/30 bg-card/50 p-3 text-center">
                  <p className="text-base font-bold leading-tight">
                    <span className="text-primary">+ {formatBRL(somaInvestida)}</span>
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
