import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/despesas")({
  head: () => ({ meta: [{ title: "Despesas — Jarvys" }] }),
  component: () => (
    <PlaceholderPage
      title="Despesas"
      subtitle="Controle gastos com combustível, manutenção e seguros em um só lugar."
    />
  ),
});
