import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/shopping")({
  head: () => ({ meta: [{ title: "Shopping — Jarvys" }] }),
  component: () => (
    <PlaceholderPage
      title="Shopping"
      subtitle="Marketplace de peças, acessórios e serviços com os melhores preços."
    />
  ),
});
