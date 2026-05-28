import { Link, useLocation } from "@tanstack/react-router";
import { House, CalendarCheck, Receipt, ShoppingBag, type LucideIcon } from "lucide-react";

type NavItem = { to: "/garagem" | "/revisoes" | "/despesas" | "/shopping"; icon: LucideIcon; label: string };

const ITEMS: NavItem[] = [
  { to: "/garagem", icon: House, label: "Início" },
  { to: "/revisoes", icon: CalendarCheck, label: "Revisões" },
  { to: "/despesas", icon: Receipt, label: "Despesas" },
  { to: "/shopping", icon: ShoppingBag, label: "Shopping" },
];

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed bottom-0 left-0 right-0 z-30 flex justify-center px-4 pb-4 pt-2"
    >
      <div
        className="flex w-full max-w-md items-center justify-around rounded-2xl border-t px-2 py-3"
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(18px) saturate(140%)",
          WebkitBackdropFilter: "blur(18px) saturate(140%)",
          borderTopColor: "#38BDF8",
          borderTopWidth: "1px",
          boxShadow: "0 -8px 24px -12px rgba(56,189,248,0.35)",
        }}
      >
        {ITEMS.map(({ to, icon: Icon, label }) => {
          const active = pathname === to;
          return (
            <Link
              key={to}
              to={to}
              aria-label={label}
              className="flex h-11 w-11 items-center justify-center rounded-xl transition-all"
              style={{
                opacity: active ? 1 : 0.4,
                color: active ? "#38BDF8" : "#94a3b8",
                filter: active
                  ? "drop-shadow(0 0 6px #38BDF8) drop-shadow(0 0 14px rgba(56,189,248,0.6))"
                  : "none",
              }}
            >
              <Icon className="h-6 w-6" strokeWidth={active ? 2.2 : 1.8} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
