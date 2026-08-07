import { describe, expect, test } from "bun:test";
import { enrichExpenseDraftWithMaintenanceItems } from "../enrich-expense-draft-with-items.ts";
import type { ParsedReceipt } from "../parse-receipt.ts";
import {
  validateAwaitingConfirmationExpenseDraft,
  validateAwaitingVehicleExpenseDraft,
  type AwaitingConfirmationExpenseDraft,
  type AwaitingVehicleExpenseDraft,
  type ExpenseCategory,
} from "../../conversation/expense-create-draft.ts";

const REQUEST_MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const VEHICLE_ID = "22222222-2222-4222-9222-222222222222";

function makeReceipt(itensDescricoes: string[]): ParsedReceipt {
  return {
    data_servico: null,
    km_registrada: null,
    valor_total: 100,
    categoria: "Manutenção",
    itens_identificados: itensDescricoes.map((descricao) => ({
      descricao,
      categoria: "outro",
      valor: 10,
    })),
  };
}

function makeVehicleDraft(categoria: ExpenseCategory): AwaitingVehicleExpenseDraft {
  return {
    phase: "awaiting_vehicle",
    categoria,
    valor: 100,
    requestMessageId: REQUEST_MESSAGE_ID,
  };
}

function makeConfirmationDraft(categoria: ExpenseCategory): AwaitingConfirmationExpenseDraft {
  return {
    phase: "awaiting_confirmation",
    categoria,
    valor: 100,
    vehicleId: VEHICLE_ID,
    requestMessageId: REQUEST_MESSAGE_ID,
  };
}

describe("enrichExpenseDraftWithMaintenanceItems", () => {
  test("categoria Combustível (não é Revisão/Manutenção) → draft retornado sem nenhuma alteração, mesmo com itens que bateriam no parser", () => {
    const receipt = makeReceipt(["Óleo 5W30", "Pastilha de freio"]);
    const draft = makeVehicleDraft("Combustível");

    const result = enrichExpenseDraftWithMaintenanceItems(receipt, draft);

    expect(result).toEqual(draft);
  });

  test("categoria Revisão, itens Óleo 5W30 + Filtro de óleo → recognizedTags inclui oleo, descricao contém [oleo], passa no validador (awaiting_vehicle)", () => {
    const receipt = makeReceipt(["Óleo 5W30", "Filtro de óleo"]);
    const draft = makeVehicleDraft("Revisão");

    const result = enrichExpenseDraftWithMaintenanceItems(receipt, draft);

    if (result.phase !== "awaiting_vehicle") throw new Error("esperava awaiting_vehicle");
    expect(result.recognizedTags).toEqual(["oleo"]);
    expect(result.descricaoPreliminar).toContain("[oleo]");
    expect(result.descricaoPreliminar).toContain("Óleo 5W30, Filtro de óleo");
    expect(result.ambiguousFilterMention).toBe(false);

    const validated = validateAwaitingVehicleExpenseDraft(result);
    expect(validated.ok).toBe(true);
  });

  test("mesmo caso do item 2, mas draft na fase awaiting_confirmation → popula descricao (não descricaoPreliminar), passa no validador", () => {
    const receipt = makeReceipt(["Óleo 5W30", "Filtro de óleo"]);
    const draft = makeConfirmationDraft("Revisão");

    const result = enrichExpenseDraftWithMaintenanceItems(receipt, draft);

    if (result.phase !== "awaiting_confirmation") throw new Error("esperava awaiting_confirmation");
    expect(result.recognizedTags).toEqual(["oleo"]);
    expect(result.descricao).toContain("[oleo]");
    expect("descricaoPreliminar" in result).toBe(false);

    const validated = validateAwaitingConfirmationExpenseDraft(result);
    expect(validated.ok).toBe(true);
  });

  test("categoria Manutenção, item 'pastilha de freio dianteira' → recognizedTags inclui pastilha", () => {
    const receipt = makeReceipt(["Pastilha de freio dianteira"]);
    const draft = makeVehicleDraft("Manutenção");

    const result = enrichExpenseDraftWithMaintenanceItems(receipt, draft);

    if (result.phase !== "awaiting_vehicle") throw new Error("esperava awaiting_vehicle");
    expect(result.recognizedTags).toEqual(["pastilha"]);

    const validated = validateAwaitingVehicleExpenseDraft(result);
    expect(validated.ok).toBe(true);
  });

  test("categoria Revisão, item 'filtro' isolado (sem qualificador, sem óleo junto) → ambiguousFilterMention true, recognizedTags vazio, passa no validador", () => {
    const receipt = makeReceipt(["Troca de filtro"]);
    const draft = makeVehicleDraft("Revisão");

    const result = enrichExpenseDraftWithMaintenanceItems(receipt, draft);

    if (result.phase !== "awaiting_vehicle") throw new Error("esperava awaiting_vehicle");
    expect(result.ambiguousFilterMention).toBe(true);
    expect(result.recognizedTags).toEqual([]);

    const validated = validateAwaitingVehicleExpenseDraft(result);
    expect(validated.ok).toBe(true);
  });

  test("categoria Revisão, itens_identificados vazio → nada reconhecido, nada ambíguo, draft retornado sem alteração", () => {
    const receipt = makeReceipt([]);
    const draft = makeVehicleDraft("Revisão");

    const result = enrichExpenseDraftWithMaintenanceItems(receipt, draft);

    expect(result).toEqual(draft);
  });

  test("categoria Revisão, muitos itens longos (15 itens) → descricaoFinal com no máximo 500 caracteres, tagsSuffix completo e intacto no final, passa no validador", () => {
    const keywordItems = [
      "Óleo 5W30 sintetico premium especial X1",
      "Filtro de ar do motor original genuino",
      "Pastilha de freio dianteira ceramica X2",
      "Arrefecimento aditivo radiador completo",
    ];
    const fillerItems = Array.from(
      { length: 11 },
      (_, i) => `Peca generica de reposicao numero ${String(i).padStart(2, "0")}xx`,
    );
    const receipt = makeReceipt([...keywordItems, ...fillerItems]);
    const draft = makeVehicleDraft("Revisão");

    const result = enrichExpenseDraftWithMaintenanceItems(receipt, draft);

    if (result.phase !== "awaiting_vehicle") throw new Error("esperava awaiting_vehicle");
    expect(result.recognizedTags).toEqual(["oleo", "filtro", "pastilha", "arrefecimento"]);

    const descricao = result.descricaoPreliminar;
    expect(typeof descricao).toBe("string");
    const descricaoStr = descricao as string;
    const tagsSuffix = " [oleo] [filtro] [pastilha] [arrefecimento]";
    expect(descricaoStr.length).toBeLessThanOrEqual(500);
    expect(descricaoStr.endsWith(tagsSuffix)).toBe(true);

    const validated = validateAwaitingVehicleExpenseDraft(result);
    expect(validated.ok).toBe(true);
  });

  test("categoria Revisão, item 'correia dentada' (fora das 4 tags do parser) → não vira tag, ambiguousFilterMention false, mas o texto aparece no resumo", () => {
    const receipt = makeReceipt(["Óleo 5W30", "Kit correia dentada Dayco"]);
    const draft = makeVehicleDraft("Revisão");

    const result = enrichExpenseDraftWithMaintenanceItems(receipt, draft);

    if (result.phase !== "awaiting_vehicle") throw new Error("esperava awaiting_vehicle");
    expect(result.recognizedTags).toEqual(["oleo"]);
    expect(result.ambiguousFilterMention).toBe(false);
    expect(result.descricaoPreliminar).toContain("Kit correia dentada Dayco");
    expect(result.descricaoPreliminar).not.toContain("[correia_dentada]");

    const validated = validateAwaitingVehicleExpenseDraft(result);
    expect(validated.ok).toBe(true);
  });
});
