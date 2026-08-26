// Build 5.7F2D3A — Testes do roteamento durável WhatsApp.
// Runner: bun test. Módulo puro; nenhum efeito colateral.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OPT_OUT_COMMANDS,
  decideRouteOwner,
  isRoutingOptOut,
  normalizeForRouting,
  type RouteOwner,
} from "../routing.ts";

// ============================================================
// A. Normalização
// ============================================================

describe("normalizeForRouting", () => {
  test("lowercase vira uppercase", () => {
    expect(normalizeForRouting("sair")).toBe("SAIR");
  });

  test("uppercase permanece uppercase", () => {
    expect(normalizeForRouting("SAIR")).toBe("SAIR");
  });

  test("remove acentos", () => {
    expect(normalizeForRouting("não quero")).toBe("NAO QUERO");
    expect(normalizeForRouting("NÃO QUERO")).toBe("NAO QUERO");
    expect(normalizeForRouting("cancélar")).toBe("CANCELAR");
  });

  test("colapsa espaços internos", () => {
    expect(normalizeForRouting("nao    quero")).toBe("NAO QUERO");
    expect(normalizeForRouting("nao\tquero")).toBe("NAO QUERO");
  });

  test("trim das pontas", () => {
    expect(normalizeForRouting("  sair  ")).toBe("SAIR");
    expect(normalizeForRouting("\n  parar \n")).toBe("PARAR");
  });

  test("string vazia vira vazio", () => {
    expect(normalizeForRouting("")).toBe("");
  });

  test("null vira vazio", () => {
    expect(normalizeForRouting(null)).toBe("");
  });

  test("undefined vira vazio", () => {
    expect(normalizeForRouting(undefined)).toBe("");
  });
});

// ============================================================
// B. Opt-out
// ============================================================

describe("isRoutingOptOut", () => {
  const canonical = ["SAIR", "PARAR", "CANCELAR", "NAO QUERO", "REMOVER", "STOP"];

  for (const cmd of canonical) {
    test(`${cmd} exato é opt-out`, () => {
      expect(isRoutingOptOut(cmd)).toBe(true);
    });
    test(`${cmd.toLowerCase()} é opt-out`, () => {
      expect(isRoutingOptOut(cmd.toLowerCase())).toBe(true);
    });
    test(`${cmd} com espaços/pontas é opt-out`, () => {
      expect(isRoutingOptOut(`  ${cmd}  `)).toBe(true);
    });
  }

  test("NÃO QUERO com acento é opt-out", () => {
    expect(isRoutingOptOut("NÃO QUERO")).toBe(true);
    expect(isRoutingOptOut("não quero")).toBe(true);
    expect(isRoutingOptOut("Não Quero")).toBe(true);
  });

  test("frases contendo opt-out mas diferentes NÃO são opt-out", () => {
    expect(isRoutingOptOut("quero sair depois")).toBe(false);
    expect(isRoutingOptOut("parar carro")).toBe(false);
    expect(isRoutingOptOut("por favor cancelar minha revisão")).toBe(false);
    expect(isRoutingOptOut("stop the world")).toBe(false);
  });

  test("comandos help não são opt-out", () => {
    expect(isRoutingOptOut("ajuda")).toBe(false);
    expect(isRoutingOptOut("AJUDA")).toBe(false);
    expect(isRoutingOptOut("menu")).toBe(false);
    expect(isRoutingOptOut("oi")).toBe(false);
    expect(isRoutingOptOut("olá")).toBe(false);
  });

  test("string vazia / whitespace / null / undefined não é opt-out", () => {
    expect(isRoutingOptOut("")).toBe(false);
    expect(isRoutingOptOut("   ")).toBe(false);
    expect(isRoutingOptOut(null)).toBe(false);
    expect(isRoutingOptOut(undefined)).toBe(false);
  });

  test("texto livre normal não é opt-out", () => {
    expect(isRoutingOptOut("gastei 200 reais em gasolina")).toBe(false);
    expect(isRoutingOptOut("quando é minha próxima revisão?")).toBe(false);
  });
});

// ============================================================
// C. Ownership
// ============================================================

describe("decideRouteOwner", () => {
  const modes = ["off", "shadow", "test", "active"] as const;

  test("texto normal + off → legacy", () => {
    expect(
      decideRouteOwner({ messageType: "text", textBody: "gastei 100", orchestratorMode: "off" }),
    ).toBe("legacy" as RouteOwner);
  });

  test("texto normal + shadow → legacy", () => {
    expect(
      decideRouteOwner({ messageType: "text", textBody: "oi jarvys", orchestratorMode: "shadow" }),
    ).toBe("legacy");
  });

  test("texto normal + test → orchestrator", () => {
    expect(
      decideRouteOwner({ messageType: "text", textBody: "oi jarvys", orchestratorMode: "test" }),
    ).toBe("orchestrator");
  });

  test("texto normal + active → orchestrator", () => {
    expect(
      decideRouteOwner({ messageType: "text", textBody: "oi jarvys", orchestratorMode: "active" }),
    ).toBe("orchestrator");
  });

  for (const mode of modes) {
    test(`opt-out (SAIR) + ${mode} → legacy`, () => {
      expect(
        decideRouteOwner({ messageType: "text", textBody: "SAIR", orchestratorMode: mode }),
      ).toBe("legacy");
    });
    test(`opt-out (não quero) + ${mode} → legacy`, () => {
      expect(
        decideRouteOwner({ messageType: "text", textBody: "não quero", orchestratorMode: mode }),
      ).toBe("legacy");
    });
    test(`opt-out (stop) + ${mode} → legacy`, () => {
      expect(
        decideRouteOwner({ messageType: "text", textBody: "stop", orchestratorMode: mode }),
      ).toBe("legacy");
    });
  }

  const mediaTypes = ["image", "pdf", "video", "file", "system", "unknown"];
  for (const mt of mediaTypes) {
    for (const mode of modes) {
      test(`${mt} + ${mode} → legacy`, () => {
        expect(
          decideRouteOwner({ messageType: mt, textBody: null, orchestratorMode: mode }),
        ).toBe("legacy");
      });
    }
  }

  // Audio segue o mesmo caminho de texto (WIRE-2): opt-out e modo já se
  // aplicam sem distinção, então só off/shadow continuam legacy.
  test("audio + off → legacy", () => {
    expect(
      decideRouteOwner({ messageType: "audio", textBody: null, orchestratorMode: "off" }),
    ).toBe("legacy");
  });

  test("audio + shadow → legacy", () => {
    expect(
      decideRouteOwner({ messageType: "audio", textBody: null, orchestratorMode: "shadow" }),
    ).toBe("legacy");
  });

  test("audio + test → orchestrator", () => {
    expect(
      decideRouteOwner({ messageType: "audio", textBody: null, orchestratorMode: "test" }),
    ).toBe("orchestrator");
  });

  test("audio + active → orchestrator", () => {
    expect(
      decideRouteOwner({ messageType: "audio", textBody: null, orchestratorMode: "active" }),
    ).toBe("orchestrator");
  });

  // Prova de que o escopo não vazou pra outros tipos de mídia além de
  // audio, mesmo sob o modo mais permissivo (active).
  const nonAudioMediaTypes = ["image", "pdf", "video", "file", "system"];
  for (const mt of nonAudioMediaTypes) {
    test(`${mt} + active → legacy (escopo não vazou além de audio)`, () => {
      expect(
        decideRouteOwner({ messageType: mt, textBody: null, orchestratorMode: "active" }),
      ).toBe("legacy");
    });
  }

  test("modo null → legacy", () => {
    expect(
      decideRouteOwner({ messageType: "text", textBody: "ola", orchestratorMode: null }),
    ).toBe("legacy");
  });

  test("modo undefined → legacy", () => {
    expect(
      decideRouteOwner({ messageType: "text", textBody: "ola", orchestratorMode: undefined }),
    ).toBe("legacy");
  });

  test("modo desconhecido → legacy (fallback seguro, sem throw)", () => {
    expect(
      decideRouteOwner({ messageType: "text", textBody: "ola", orchestratorMode: "banana" }),
    ).toBe("legacy");
  });

  test("textBody null + test → orchestrator (mensagem de texto vazia continua sendo texto)", () => {
    expect(
      decideRouteOwner({ messageType: "text", textBody: null, orchestratorMode: "test" }),
    ).toBe("orchestrator");
  });

  test("textBody vazio + active → orchestrator", () => {
    expect(
      decideRouteOwner({ messageType: "text", textBody: "", orchestratorMode: "active" }),
    ).toBe("orchestrator");
  });

  test("messageType null → legacy", () => {
    expect(
      decideRouteOwner({ messageType: null, textBody: "oi", orchestratorMode: "test" }),
    ).toBe("legacy");
  });

  test("conjunto canônico tem exatamente 6 comandos", () => {
    expect(OPT_OUT_COMMANDS.size).toBe(6);
  });
});

// ============================================================
// D. Segurança estática do módulo routing.ts
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTING_SRC = readFileSync(join(HERE, "..", "routing.ts"), "utf8");

describe("routing.ts segurança estática", () => {
  test("não importa Supabase", () => {
    expect(ROUTING_SRC.includes("@supabase/")).toBe(false);
    expect(ROUTING_SRC.includes("supabase-js")).toBe(false);
  });
  test("não importa provider/sender/orchestrator", () => {
    expect(ROUTING_SRC.includes("zapi")).toBe(false);
    expect(ROUTING_SRC.includes("provider-router")).toBe(false);
    expect(ROUTING_SRC.includes("orchestrator/")).toBe(false);
  });
  test("não lê env", () => {
    expect(ROUTING_SRC.includes("Deno.env")).toBe(false);
    expect(ROUTING_SRC.includes("process.env")).toBe(false);
  });
  test("não faz I/O", () => {
    expect(ROUTING_SRC.includes("fetch(")).toBe(false);
    expect(ROUTING_SRC.includes("readFile")).toBe(false);
    expect(ROUTING_SRC.includes("writeFile")).toBe(false);
  });
  test("não tem imports externos", () => {
    // Módulo puro: nenhuma linha `import ... from "..."`
    const hasImport = /^\s*import\s+/m.test(ROUTING_SRC);
    expect(hasImport).toBe(false);
  });
});

// ============================================================
// E. Wiring estático de webhook e worker legado
// ============================================================

const WEBHOOK_SRC = readFileSync(
  join(HERE, "..", "..", "..", "whatsapp-webhook", "index.ts"),
  "utf8",
);
const WORKER_SRC = readFileSync(
  join(HERE, "..", "..", "..", "whatsapp-process-inbound", "index.ts"),
  "utf8",
);

describe("wiring do webhook", () => {
  test("importa decideRouteOwner do módulo compartilhado", () => {
    expect(WEBHOOK_SRC.includes("decideRouteOwner")).toBe(true);
    expect(WEBHOOK_SRC.includes("../_shared/whatsapp/routing.ts")).toBe(true);
  });
  test("INSERT da processing queue inclui route_owner", () => {
    // Aceita `route_owner:` (shorthand ou explícito) próximo ao insert da fila.
    const idx = WEBHOOK_SRC.indexOf("whatsapp_processing_queue");
    expect(idx > -1).toBe(true);
    const window = WEBHOOK_SRC.slice(idx, idx + 800);
    expect(window.includes("route_owner")).toBe(true);
  });
  test("lookup da instância inclui orchestrator_mode", () => {
    expect(WEBHOOK_SRC.includes("orchestrator_mode")).toBe(true);
  });
});

describe("wiring do worker legado", () => {
  test("importa isRoutingOptOut do módulo compartilhado", () => {
    expect(WORKER_SRC.includes("isRoutingOptOut")).toBe(true);
    expect(WORKER_SRC.includes("../_shared/whatsapp/routing.ts")).toBe(true);
  });
  test("claimNext filtra route_owner='legacy'", () => {
    expect(WORKER_SRC.includes('"route_owner"')).toBe(true);
    expect(WORKER_SRC.includes("'legacy'") || WORKER_SRC.includes('"legacy"')).toBe(true);
  });
});
