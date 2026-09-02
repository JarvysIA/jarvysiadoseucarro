// Build Maintenance-Alert — prova de paridade: confirma que as cópias em
// supabase/functions/_shared/whatsapp/maintenance-engine/ produzem
// EXATAMENTE a mesma saída que os originais de src/lib/, pro mesmo input.
// Só possível rodar num único processo bun test porque ambos os arquivos
// são TypeScript puro sem I/O — não prova nada sobre o runtime Deno em
// produção, só que a cópia manual não divergiu da lógica original.

import { describe, expect, test } from "bun:test";

import { buildJarvysMilestone as buildJarvysMilestoneOriginal } from "../../../../../../src/lib/maintenance-jarvys-schedule-rules";
import { buildJarvysMilestone as buildJarvysMilestoneCopy } from "../jarvys-schedule-rules.ts";

import { buildJarvysVisualGroups as buildJarvysVisualGroupsOriginal } from "../../../../../../src/lib/maintenance-visual-groups";
import { buildJarvysVisualGroups as buildJarvysVisualGroupsCopy } from "../visual-groups.ts";

import { buildMercadoLivreAffiliateSearchUrl as buildAffiliateUrlOriginal } from "../../../../../../src/lib/mercado-livre-affiliate-links";
import { buildMercadoLivreAffiliateSearchUrl as buildAffiliateUrlCopy } from "../affiliate-links.ts";

describe("paridade — buildJarvysMilestone (cópia vs original)", () => {
  const PROFILES = [
    {
      name: "combustão, correia dentada, manual, hidráulica",
      profile: {
        fuelKind: "combustao" as const,
        timingSystem: "correia_dentada" as const,
        transmissionKind: "manual" as const,
        steeringKind: "hidraulica" as const,
      },
    },
    {
      name: "híbrido, corrente, automático, elétrica",
      profile: {
        fuelKind: "hibrido_combustao" as const,
        timingSystem: "corrente" as const,
        transmissionKind: "automatico" as const,
        steeringKind: "eletrica" as const,
      },
    },
    {
      name: "elétrico puro (matriz EV)",
      profile: {
        fuelKind: "eletrico_puro" as const,
        timingSystem: "nao_aplicavel" as const,
        transmissionKind: "caixa_reducao" as const,
        steeringKind: "eletrica" as const,
      },
    },
    {
      name: "desconhecido em tudo (degrada graciosamente)",
      profile: {
        fuelKind: "combustao" as const,
        timingSystem: "desconhecido" as const,
        transmissionKind: "desconhecido" as const,
        steeringKind: "desconhecida" as const,
      },
    },
  ];

  const KMS = [10000, 60000, 90000, 100000, 120000, 180000, 200000, 118500, 250000, 430000];

  for (const { name, profile } of PROFILES) {
    for (const km of KMS) {
      test(`perfil "${name}", km=${km}: cópia === original`, () => {
        const original = buildJarvysMilestoneOriginal(km, profile);
        const copy = buildJarvysMilestoneCopy(km, profile);
        expect(copy).toEqual(original);
      });
    }
  }
});

describe("paridade — buildJarvysVisualGroups (cópia vs original)", () => {
  test("marco 120000, perfil combustão/correia dentada/automático/hidráulica: cópia === original", () => {
    const profile = {
      fuelKind: "combustao" as const,
      timingSystem: "correia_dentada" as const,
      transmissionKind: "automatico" as const,
      steeringKind: "hidraulica" as const,
    };
    const milestoneOriginal = buildJarvysMilestoneOriginal(120000, profile);
    const groupsOriginal = buildJarvysVisualGroupsOriginal(milestoneOriginal.items);

    const milestoneCopy = buildJarvysMilestoneCopy(120000, profile as any);
    const groupsCopy = buildJarvysVisualGroupsCopy(milestoneCopy.items as any);

    expect(groupsCopy).toEqual(groupsOriginal as any);
  });

  test("marco 60000, perfil elétrico puro: cópia === original", () => {
    const profile = {
      fuelKind: "eletrico_puro" as const,
      timingSystem: "nao_aplicavel" as const,
      transmissionKind: "caixa_reducao" as const,
      steeringKind: "eletrica" as const,
    };
    const milestoneOriginal = buildJarvysMilestoneOriginal(60000, profile);
    const groupsOriginal = buildJarvysVisualGroupsOriginal(milestoneOriginal.items);

    const milestoneCopy = buildJarvysMilestoneCopy(60000, profile as any);
    const groupsCopy = buildJarvysVisualGroupsCopy(milestoneCopy.items as any);

    expect(groupsCopy).toEqual(groupsOriginal as any);
  });
});

describe("paridade — buildMercadoLivreAffiliateSearchUrl (cópia vs original)", () => {
  const QUERIES = [
    "Toyota Corolla Óleo e filtro de óleo",
    "Fiat Argo Kit sincronismo",
    "Hyundai HB20 Pastilhas e discos de freio",
    "  espaços   extras  e ACENTUAÇÃO  ",
  ];

  for (const query of QUERIES) {
    test(`query "${query}": cópia === original`, () => {
      const original = buildAffiliateUrlOriginal({ query });
      const copy = buildAffiliateUrlCopy({ query });
      expect(copy).toEqual(original);
    });
  }

  test("query vazia: ambas lançam empty_query", () => {
    expect(() => buildAffiliateUrlOriginal({ query: "" })).toThrow("empty_query");
    expect(() => buildAffiliateUrlCopy({ query: "" })).toThrow("empty_query");
  });
});
