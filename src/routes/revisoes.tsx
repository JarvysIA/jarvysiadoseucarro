import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/revisoes")({
  head: () => ({ meta: [{ title: "Revisões — Jarvys" }] }),
  component: () => (
    <PlaceholderPage
      title="Revisões"
      subtitle="Acompanhe e antecipe todas as manutenções programadas do seu veículo."
    />
  ),
});
