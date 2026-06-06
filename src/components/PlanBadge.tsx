import { Crown, Star } from "lucide-react";
import type { PlanTier } from "@/lib/admin-users.functions";

export function PlanBadge({
  tier,
  className = "",
}: {
  tier: PlanTier | null | undefined;
  className?: string;
}) {
  if (tier === "super_vip") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${className}`}
        style={{
          color: "#FFD56B",
          borderColor: "rgba(255,213,107,0.55)",
          background: "rgba(255,213,107,0.08)",
          boxShadow: "0 0 16px -4px rgba(255,213,107,0.65)",
        }}
      >
        <Crown className="h-3 w-3" />
        Super VIP
      </span>
    );
  }
  if (tier === "vip") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-primary/60 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary ${className}`}
        style={{ boxShadow: "0 0 12px -4px rgba(56,189,248,0.6)" }}
      >
        <Star className="h-3 w-3" />
        VIP
      </span>
    );
  }
  return null;
}
