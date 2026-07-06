// Build 7.2 — Shell visual comum aos cards da aba Shopping.
// Somente apresentação. Sem I/O.

import type { ReactNode } from "react";

export type ShoppingCardShellProps = {
  icon: ReactNode;
  title: string;
  description: string;
  cta?: string;
  badge?: string;
  disabledText?: string;
  note?: string;
  onClick?: () => void;
  href?: string;
};

export function ShoppingCardShell({
  icon,
  title,
  description,
  cta,
  badge,
  disabledText,
  note,
  onClick,
  href,
}: ShoppingCardShellProps) {
  const cardStyle = {
    background: "rgba(15,23,42,0.6)",
    borderColor: "rgba(56,189,248,0.35)",
    boxShadow: "0 0 24px -18px rgba(56,189,248,0.5)",
  } as const;

  const actionClass =
    "mt-3 inline-flex w-full items-center justify-center rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider transition";

  const actionEnabledStyle = {
    background: "rgba(56,189,248,0.15)",
    color: "#38BDF8",
    border: "1px solid rgba(56,189,248,0.5)",
  } as const;

  const actionDisabledStyle = {
    background: "rgba(148,163,184,0.08)",
    color: "#94a3b8",
    border: "1px solid rgba(148,163,184,0.25)",
  } as const;

  return (
    <div
      className="rounded-2xl border p-4 backdrop-blur-md"
      style={cardStyle}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "rgba(56,189,248,0.12)",
            color: "#38BDF8",
          }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {badge && (
              <span
                className="rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                style={{
                  color: "#94a3b8",
                  borderColor: "rgba(148,163,184,0.35)",
                  background: "rgba(148,163,184,0.08)",
                }}
              >
                {badge}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      {href && cta && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={actionClass}
          style={actionEnabledStyle}
        >
          {cta}
        </a>
      )}
      {!href && cta && onClick && (
        <button
          type="button"
          onClick={onClick}
          className={actionClass}
          style={actionEnabledStyle}
        >
          {cta}
        </button>
      )}
      {disabledText && (
        <div className={actionClass} style={actionDisabledStyle}>
          {disabledText}
        </div>
      )}
      {note && (
        <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
      )}
    </div>
  );
}
