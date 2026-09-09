import { createFileRoute } from "@tanstack/react-router";
import { ShoppingPage } from "@/components/shopping/ShoppingPage";
import { useEnforceAccountActive } from "@/lib/use-enforce-account-active";

export const Route = createFileRoute("/shopping")({
  head: () => ({ meta: [{ title: "Shopping — Jarvys" }] }),
  component: ShoppingRoute,
});

function ShoppingRoute() {
  useEnforceAccountActive();
  return <ShoppingPage />;
}
