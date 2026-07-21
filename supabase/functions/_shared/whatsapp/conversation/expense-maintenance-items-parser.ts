// Parser puro de itens técnicos de manutenção a partir de texto livre,
// para o fluxo de despesa via WhatsApp (categorias Revisão e Manutenção).
// Módulo 100% puro: sem I/O, sem Deno, sem fetch, sem clock, sem crypto,
// sem logs, sem IA. Não importa de core.ts, expense-create-draft.ts nem
// actions/*. Não é consumido por nenhum runtime neste build.
//
// Contrato fechado no PLAN (BUILD 5.7F2E1A.5-MJ4-PLAN, Tarefa 1) + 2
// ajustes de design posteriores:
// (a) qualquer menção a "óleo"/"lubrificante" já credita o filtro de óleo
//     junto, SEM EXCEÇÃO — mesmo sozinho, mesmo se outro filtro diferente
//     (ar/cabine/combustível) também for mencionado na mesma mensagem.
//     Ninguém troca óleo sem trocar o filtro de óleo.
// (b) "filtro" sozinho, sem qualificador e sem plural e SEM óleo
//     mencionado junto, não é reconhecido como item — é sinalizado via
//     ambiguousFilterMention=true, pra a conversa (build 4) perguntar
//     qual filtro foi trocado.
// As únicas 4 tags que o trigger atualizar_revisao_veiculo reconhece na
// descrição são, literalmente: [oleo] [filtro] [pastilha] [arrefecimento].

export const MAINTENANCE_TRIGGER_TAGS = ["oleo", "filtro", "pastilha", "arrefecimento"] as const;
export type MaintenanceTriggerTag = (typeof MAINTENANCE_TRIGGER_TAGS)[number];
const MAINTENANCE_TRIGGER_TAG_SET: ReadonlySet<string> = new Set(MAINTENANCE_TRIGGER_TAGS);

export function isMaintenanceTriggerTag(value: unknown): value is MaintenanceTriggerTag {
  return typeof value === "string" && MAINTENANCE_TRIGGER_TAG_SET.has(value);
}

export const MAINTENANCE_ITEM_KEYS = [
  "oleo_motor",
  "filtro_oleo",
  "filtro_ar_motor",
  "filtro_cabine",
  "filtro_combustivel",
  "pastilhas_freio",
  "aditivo_radiador",
  "limpeza_arrefecimento",
  "aditivo_arrefecimento",
] as const;
export type MaintenanceItemKey = (typeof MAINTENANCE_ITEM_KEYS)[number];

const MAINTENANCE_ITEM_KEY_SET: ReadonlySet<string> = new Set(MAINTENANCE_ITEM_KEYS);

export function isMaintenanceItemKey(value: unknown): value is MaintenanceItemKey {
  return typeof value === "string" && MAINTENANCE_ITEM_KEY_SET.has(value);
}

export const MAINTENANCE_ITEM_TAG: Readonly<Record<MaintenanceItemKey, MaintenanceTriggerTag>> = {
  oleo_motor: "oleo",
  filtro_oleo: "oleo",
  filtro_ar_motor: "filtro",
  filtro_cabine: "filtro",
  filtro_combustivel: "filtro",
  pastilhas_freio: "pastilha",
  aditivo_radiador: "arrefecimento",
  limpeza_arrefecimento: "arrefecimento",
  aditivo_arrefecimento: "arrefecimento",
};

export const MAINTENANCE_ITEM_LABEL: Readonly<Record<MaintenanceItemKey, string>> = {
  oleo_motor: "óleo do motor",
  filtro_oleo: "filtro de óleo",
  filtro_ar_motor: "filtro de ar",
  filtro_cabine: "filtro de cabine",
  filtro_combustivel: "filtro de combustível",
  pastilhas_freio: "pastilhas de freio",
  aditivo_radiador: "aditivo do radiador",
  limpeza_arrefecimento: "limpeza do arrefecimento",
  aditivo_arrefecimento: "aditivo do arrefecimento",
};

export function dedupeMaintenanceItemKeys(
  values: ReadonlyArray<MaintenanceItemKey>,
): ReadonlyArray<MaintenanceItemKey> {
  return [...new Set(values)];
}

export function recognizedTagsFromMaintenanceItemKeys(
  values: ReadonlyArray<MaintenanceItemKey>,
): ReadonlyArray<MaintenanceTriggerTag> {
  const found = new Set(values.map((value) => MAINTENANCE_ITEM_TAG[value]));
  return MAINTENANCE_TRIGGER_TAGS.filter((tag) => found.has(tag));
}

export function maintenanceItemKeysFromParseResult(
  result: MaintenanceItemsParseResult,
): ReadonlyArray<MaintenanceItemKey> {
  return dedupeMaintenanceItemKeys(result.items.flatMap((item) => item.itemKeys));
}

export type RecognizedMaintenanceItem = {
  readonly tag: MaintenanceTriggerTag;
  readonly itemKeys: ReadonlyArray<MaintenanceItemKey>;
};

export type MaintenanceItemsParseResult = {
  readonly items: ReadonlyArray<RecognizedMaintenanceItem>;
  readonly tagsSuffix: string;
  readonly ambiguousFilterMention: boolean;
};

const MAX_INPUT_CHARS = 4000;
const DIACRITICS_RE = /[\u0300-\u036f]/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const ASCII_SPACE_RE = /[ \t\r\n\f\v]+/g;

function normalize(input: string): string {
  const capped = input.length > MAX_INPUT_CHARS ? input.slice(0, MAX_INPUT_CHARS) : input;
  const stripped = capped.normalize("NFD").replace(DIACRITICS_RE, "").toLowerCase();
  return " " + stripped.replace(NON_ALNUM_RE, " ").replace(ASCII_SPACE_RE, " ").trim() + " ";
}

function hasKeyword(haystack: string, keyword: string): boolean {
  return haystack.indexOf(" " + keyword + " ") >= 0;
}

function anyKeyword(haystack: string, keywords: ReadonlyArray<string>): boolean {
  return keywords.some((kw) => hasKeyword(haystack, kw));
}

const TAG_ORDER: ReadonlyArray<MaintenanceTriggerTag> = MAINTENANCE_TRIGGER_TAGS;

export function parseMaintenanceItemsText(
  text: string | null | undefined,
): MaintenanceItemsParseResult {
  if (typeof text !== "string" || text.trim() === "") {
    return { items: [], tagsSuffix: "", ambiguousFilterMention: false };
  }

  const n = normalize(text);
  const found = new Map<MaintenanceTriggerTag, MaintenanceItemKey[]>();

  const oleoBase = anyKeyword(n, ["oleo", "lubrificante"]);
  if (oleoBase) {
    found.set("oleo", ["oleo_motor", "filtro_oleo"]);
  }

  const filtroAr = anyKeyword(n, ["filtro de ar", "filtro do ar"]);
  const filtroCabine = anyKeyword(n, ["filtro de cabine", "filtro do ar condicionado"]);
  const filtroCombustivel = anyKeyword(n, [
    "filtro de combustivel",
    "filtro de gasolina",
    "filtro de etanol",
  ]);
  const filtroPluralGenerico = hasKeyword(n, "filtros");
  const filtroBareMention = hasKeyword(n, "filtro");
  const filtroHasSpecificQualifier = filtroAr || filtroCabine || filtroCombustivel;

  let ambiguousFilterMention = false;

  if (filtroHasSpecificQualifier) {
    const keys: MaintenanceItemKey[] = [];
    if (filtroAr) keys.push("filtro_ar_motor");
    if (filtroCabine) keys.push("filtro_cabine");
    if (filtroCombustivel) keys.push("filtro_combustivel");
    found.set("filtro", keys);
  } else if (filtroPluralGenerico) {
    found.set("filtro", ["filtro_ar_motor", "filtro_cabine", "filtro_combustivel"]);
  } else if (filtroBareMention && !oleoBase) {
    ambiguousFilterMention = true;
  }

  if (anyKeyword(n, ["pastilha", "pastilhas"])) {
    found.set("pastilha", ["pastilhas_freio"]);
  }

  const arrefBase = anyKeyword(n, ["arrefecimento", "radiador"]);
  if (arrefBase) {
    const keys: MaintenanceItemKey[] = ["aditivo_radiador"];
    if (hasKeyword(n, "limpeza")) keys.push("limpeza_arrefecimento");
    found.set("arrefecimento", keys);
  }

  const items: RecognizedMaintenanceItem[] = [];
  for (const tag of TAG_ORDER) {
    const keys = found.get(tag);
    if (keys && keys.length > 0) items.push({ tag, itemKeys: keys });
  }

  const tagsSuffix = items.length > 0 ? items.map((i) => ` [${i.tag}]`).join("") : "";

  return { items, tagsSuffix, ambiguousFilterMention };
}
