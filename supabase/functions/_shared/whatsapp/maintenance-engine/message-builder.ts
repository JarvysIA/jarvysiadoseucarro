// Build Maintenance-Alert — monta o texto da mensagem de alerta proativo
// de marco de km (WhatsApp), a partir dos grupos visuais já calculados por
// buildJarvysVisualGroups. Função pura: zero I/O, zero Supabase, zero fetch.

import type { JarvysVisualGroup, JarvysVisualGroupIcon } from "./visual-groups.ts";
import { isJarvysVisualGroupCritical } from "./visual-groups.ts";
import {
  buildMercadoLivreAffiliateSearchUrl,
  MERCADO_LIVRE_SHOPPING_WARNINGS,
} from "./affiliate-links.ts";

// woq_text_len_chk (whatsapp_outbound_queue) — limite real de char_length
// do banco. Truncar aqui é defensivo: na prática, com o número típico de
// itens por marco Jarvys, a mensagem nunca chega perto disso.
export const MAINTENANCE_ALERT_MAX_CHARS = 4000;

const GROUP_ICON_EMOJI: Record<JarvysVisualGroupIcon, string> = {
  droplet: "💧",
  wind: "🌬️",
  disc3: "🛞",
  wrench: "🔧",
  zap: "⚡",
  snowflake: "❄️",
};

const FALLBACK_ICON_EMOJI = "🔧";

function iconEmoji(icon: JarvysVisualGroupIcon): string {
  return GROUP_ICON_EMOJI[icon] ?? FALLBACK_ICON_EMOJI;
}

export type BuildMilestoneAlertMessageInput = {
  marca: string;
  modelo: string;
  kmAtual: number;
  targetKm: number;
  groups: JarvysVisualGroup[];
};

function formatKm(km: number): string {
  return Math.floor(km).toLocaleString("pt-BR");
}

function renderGroupBlock(group: JarvysVisualGroup, marca: string, modelo: string): string {
  const emoji = iconEmoji(group.icon);
  const criticalSuffix = isJarvysVisualGroupCritical(group) ? " ⚠️ Item crítico" : "";
  const lines: string[] = [`${emoji} ${group.title}${criticalSuffix}`];

  if (group.description) {
    lines.push(group.description);
  }

  if (!group.isServiceOnly) {
    const { url } = buildMercadoLivreAffiliateSearchUrl({
      query: `${marca} ${modelo} ${group.linkItemTitle}`,
    });
    lines.push(`🛒 Ver ofertas no Mercado Livre: ${url}`);
  } else if (group.serviceBadgeLabel) {
    lines.push(group.serviceBadgeLabel);
  }

  return lines.join("\n");
}

// MERCADO_LIVRE_SHOPPING_WARNINGS.offers/compatibility já vêm com o emoji
// embutido (confirmado em affiliate-links.ts) — os textos entram literais,
// sem prefixo extra (evita duplicar o emoji).
function renderFooter(): string {
  return [
    MERCADO_LIVRE_SHOPPING_WARNINGS.offers,
    MERCADO_LIVRE_SHOPPING_WARNINGS.compatibility,
    MERCADO_LIVRE_SHOPPING_WARNINGS.officialStores,
  ].join("\n");
}

/**
 * Monta o texto completo do alerta. Se o resultado ultrapassar
 * MAINTENANCE_ALERT_MAX_CHARS (woq_text_len_chk), corta grupos do FIM da
 * lista (nunca corta um grupo pela metade) até caber — mantém o header e o
 * rodapé sempre intactos. Documentado explicitamente porque é um caminho
 * defensivo que não deveria disparar na prática com o número típico de
 * itens por marco Jarvys.
 */
export function buildMilestoneAlertMessage(input: BuildMilestoneAlertMessageInput): string {
  const { marca, modelo, kmAtual, targetKm, groups } = input;
  const header = [
    `🔧 Revisão de ${formatKm(targetKm)} km chegando pro seu ${marca.toUpperCase()} ${modelo.toUpperCase()}!`,
    `Km atual: ${formatKm(kmAtual)} km`,
    "",
    "Itens recomendados para esta revisão:",
    "",
  ].join("\n");
  const footer = renderFooter();

  const groupBlocks = groups.map((g) => renderGroupBlock(g, marca, modelo));

  const assemble = (blocks: string[]): string =>
    [header, ...blocks.map((b) => `${b}\n`), footer].join("\n").replace(/\n{3,}/g, "\n\n");

  let text = assemble(groupBlocks);
  if (text.length <= MAINTENANCE_ALERT_MAX_CHARS) return text;

  // Truncamento defensivo: remove grupos do fim até caber, grupo inteiro
  // por vez — nunca corta um grupo no meio.
  const kept = [...groupBlocks];
  while (kept.length > 0 && assemble(kept).length > MAINTENANCE_ALERT_MAX_CHARS) {
    kept.pop();
  }
  text = assemble(kept);

  // Último recurso (nunca deveria acontecer): mesmo sem nenhum grupo,
  // header+footer ultrapassa o limite — corta bruto preservando o rodapé.
  if (text.length > MAINTENANCE_ALERT_MAX_CHARS) {
    const truncated = text.slice(0, MAINTENANCE_ALERT_MAX_CHARS);
    return truncated;
  }

  return text;
}
