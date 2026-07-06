import { createFileRoute } from "@tanstack/react-router";
import { ShoppingPage } from "@/components/shopping/ShoppingPage";

export const Route = createFileRoute("/shopping")({
  head: () => ({ meta: [{ title: "Shopping — Jarvys" }] }),
  component: () => <ShoppingPage />,
});
