// Build 6.46 — Componente reutilizável para renderizar grupos visuais/comerciais
// da revisão Jarvys com links Mercado Livre afiliados.
//
// Preserva 1:1 o visual aprovado no Build 6.45A (admin-corpus-smoke).

import {
  BadgeCheck,
  Disc3,
  Droplet,
  Search,
  ShieldAlert,
  ShoppingCart,
  Snowflake,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type {
  JarvysVisualGroup,
  JarvysVisualGroupIcon,
} from "@/lib/maintenance-visual-groups";
import { isJarvysVisualGroupCritical } from "@/lib/maintenance-visual-groups";
import {
  buildMaintenanceMercadoLivreShoppingLink,
  type MaintenanceShoppingVehicle,
} from "@/lib/maintenance-mercado-livre-shopping";
import { MERCADO_LIVRE_SHOPPING_WARNINGS } from "@/lib/mercado-livre-affiliate-links";

const ICONS: Record<JarvysVisualGroupIcon, LucideIcon> = {
  droplet: Droplet,
  wind: Wind,
  disc3: Disc3,
  wrench: Wrench,
  zap: Zap,
  snowflake: Snowflake,
};

export type MaintenanceReviewShoppingListProps = {
  groups: JarvysVisualGroup[];
  vehicle: MaintenanceShoppingVehicle;
  showDebug?: boolean;
};

export function MaintenanceReviewShoppingList({
  groups,
  vehicle,
  showDebug,
}: MaintenanceReviewShoppingListProps) {
  return (
    <div>
      <div className="space-y-3">
        {groups.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            Nenhum item recomendado pelo motor Jarvys para este marco.
          </div>
        )}
        {groups.map((group) => {
          const Icon = ICONS[group.icon];
          const link = group.isServiceOnly
            ? null
            : buildMaintenanceMercadoLivreShoppingLink({
                itemTitle: group.linkItemTitle,
                itemDescription: group.description,
                vehicle,
              });
          return (
            <div
              key={group.groupKey}
              className="rounded-md border border-border bg-background p-3"
            >
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">{group.title}</div>
                    {isJarvysVisualGroupCritical(group) && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                        <ShieldAlert className="h-3 w-3" />
                        Item crítico
                      </span>
                    )}
                  </div>
                  {group.description && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {group.description}
                    </div>
                  )}
                </div>
              </div>

              {group.isServiceOnly ? (
                <div className="mt-3">
                  <span className="inline-flex items-center rounded-md border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                    {group.serviceBadgeLabel ?? "Serviço especializado"}
                  </span>
                </div>
              ) : (
                <>
                  {link && (
                    <a
                      href={link.mercadoLivre.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    >
                      Ver ofertas no Mercado Livre
                    </a>
                  )}
                  {group.hasMixedServiceItems &&
                    group.serviceItemLabels &&
                    group.serviceItemLabels.length > 0 && (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        Também recomendado como serviço:{" "}
                        {group.serviceItemLabels.join(", ")}
                      </div>
                    )}
                </>
              )}

              {showDebug && (
                <details className="mt-2 text-[10px] text-muted-foreground">
                  <summary className="cursor-pointer">debug</summary>
                  <div className="mt-1 space-y-0.5 font-mono">
                    <div>
                      <span className="font-semibold">groupTitle:</span>{" "}
                      {group.title}
                    </div>
                    <div>
                      <span className="font-semibold">groupKey:</span>{" "}
                      {group.groupKey}
                    </div>
                    <div>
                      <span className="font-semibold">kind:</span> {group.kind}
                    </div>
                    <div>
                      <span className="font-semibold">sourceItemKeys:</span>{" "}
                      {group.sourceItemKeys.join(", ")}
                    </div>
                    <div>
                      <span className="font-semibold">sourceLabels:</span>{" "}
                      {group.sourceLabels.join(", ")}
                    </div>
                    {group.serviceBadgeLabel && (
                      <div>
                        <span className="font-semibold">
                          serviceBadgeLabel:
                        </span>{" "}
                        {group.serviceBadgeLabel}
                      </div>
                    )}
                    {link && (
                      <>
                        <div>
                          <span className="font-semibold">searchQuery:</span>{" "}
                          {link.searchQuery}
                        </div>
                        <div>
                          <span className="font-semibold">slug:</span>{" "}
                          {link.mercadoLivre.slug}
                        </div>
                        <div>
                          <span className="font-semibold">trackingStatus:</span>{" "}
                          {link.mercadoLivre.trackingStatus}
                        </div>
                        <div className="break-all">
                          <span className="font-semibold">url:</span>{" "}
                          {link.mercadoLivre.url}
                        </div>
                      </>
                    )}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 space-y-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
        <div className="flex items-start gap-2">
          <ShoppingCart className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
          <span>
            {MERCADO_LIVRE_SHOPPING_WARNINGS.offers.replace(/^🛒\s*/, "")}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <Search className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
          <span>
            {MERCADO_LIVRE_SHOPPING_WARNINGS.compatibility.replace(/^🔎\s*/, "")}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <span>{MERCADO_LIVRE_SHOPPING_WARNINGS.officialStores}</span>
        </div>
      </div>
    </div>
  );
}
