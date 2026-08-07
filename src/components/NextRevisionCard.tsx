import { Wrench, AlertTriangle } from "lucide-react";
import {
  ALERT_WINDOW,
  getMilestoneWindowStatus,
  kmUntilMilestone,
  nextMilestone,
} from "@/lib/predictive-maintenance";

type NextRevisionCardProps = {
  kmAtual?: number | null;
  onClick?: () => void;
  disabled?: boolean;
};

function formatKm(n: number): string {
  return n.toLocaleString("pt-BR");
}

export function NextRevisionCard({ kmAtual, onClick, disabled }: NextRevisionCardProps) {
  if (kmAtual === null || kmAtual === undefined || !Number.isFinite(kmAtual) || kmAtual <= 0) {
    return null;
  }

  const km = Math.floor(kmAtual);
  const milestone = nextMilestone(km);
  const remaining = kmUntilMilestone(km);
  const windowStatus = getMilestoneWindowStatus(km, ALERT_WINDOW);

  const isClickable = typeof onClick === "function" && !disabled;

  const alertInner = (
    <>
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary"
        style={{ color: "var(--status-warn)" }}
      >
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--status-warn)" }}
        >
          Próxima revisão
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          Faltam <span className="whitespace-nowrap">{formatKm(remaining)} km</span> para a revisão
          de <span className="whitespace-nowrap">{formatKm(milestone)} km</span>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Faça sua revisão preventiva e evite gastos extras.
        </p>
      </div>
    </>
  );

  const alertPastInner = (
    <>
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary"
        style={{ color: "var(--status-warn)" }}
      >
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--status-warn)" }}
        >
          Próxima revisão
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          Você passou da revisão de{" "}
          <span className="whitespace-nowrap">{formatKm(windowStatus.milestone)} km</span> — ainda
          dá tempo de fazer sem prejuízo.
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Faça sua revisão preventiva e evite gastos extras.
        </p>
      </div>
    </>
  );

  const normalInner = (
    <>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
        <Wrench className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Próxima revisão
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          <span className="whitespace-nowrap">{formatKm(milestone)} km</span>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Faltam <span className="whitespace-nowrap">{formatKm(remaining)} km</span>
        </p>
      </div>
    </>
  );

  if (windowStatus.withinWindow) {
    const alertClassName = `mt-3 flex w-full items-start gap-3 rounded-2xl border p-4 text-left ${
      isClickable ? "cursor-pointer" : ""
    }`;
    const alertStyle = {
      borderColor: "var(--status-warn)",
      backgroundColor: "color-mix(in srgb, var(--status-warn) 12%, transparent)",
    } as const;
    const inner = windowStatus.isPast ? alertPastInner : alertInner;

    if (onClick) {
      return (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label="Abrir detalhes da próxima revisão"
          className={alertClassName}
          style={alertStyle}
        >
          {inner}
        </button>
      );
    }

    return (
      <div className={alertClassName} style={alertStyle} role="status" aria-live="polite">
        {inner}
      </div>
    );
  }

  const normalClassName = `mt-3 flex w-full items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left ${
    isClickable ? "cursor-pointer" : ""
  }`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label="Abrir detalhes da próxima revisão"
        className={normalClassName}
      >
        {normalInner}
      </button>
    );
  }

  return <div className={normalClassName}>{normalInner}</div>;
}
