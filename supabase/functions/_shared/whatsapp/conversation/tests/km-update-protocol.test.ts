// Build 5.7F2E1A.5-MD — Testes dos discriminantes desconectados.
import { describe, expect, it } from "bun:test";

import {
  CONFIRM_KM_UPDATE_HANDOFF_KIND,
  type ConfirmKmUpdateHandoff,
  type ConfirmKmUpdateHandoffKind,
  KM_REPORTED_EVENT_KIND,
  type KmReportedEvent,
  type KmReportedEventKind,
} from "../km-update-protocol.ts";

import * as barrel from "../index.ts";

describe("km-update-protocol — literais congelados", () => {
  it("KM_REPORTED_EVENT_KIND é exatamente 'km_reported'", () => {
    expect(KM_REPORTED_EVENT_KIND).toBe("km_reported");
    const _typecheck: "km_reported" = KM_REPORTED_EVENT_KIND;
    void _typecheck;
  });

  it("CONFIRM_KM_UPDATE_HANDOFF_KIND é exatamente 'confirm_km_update'", () => {
    expect(CONFIRM_KM_UPDATE_HANDOFF_KIND).toBe("confirm_km_update");
    const _typecheck: "confirm_km_update" = CONFIRM_KM_UPDATE_HANDOFF_KIND;
    void _typecheck;
  });

  it("os dois literais são distintos", () => {
    expect(KM_REPORTED_EVENT_KIND).not.toBe(CONFIRM_KM_UPDATE_HANDOFF_KIND);
  });
});

describe("km-update-protocol — marcadores mínimos", () => {
  it("KmReportedEvent possui somente o discriminante 'kind'", () => {
    const event = {
      kind: KM_REPORTED_EVENT_KIND,
    } satisfies KmReportedEvent;
    const keys = Object.keys(event);
    expect(keys).toEqual(["kind"]);
    expect(keys.length).toBe(1);
    expect(event.kind).toBe("km_reported");
  });

  it("ConfirmKmUpdateHandoff possui somente o discriminante 'kind'", () => {
    const handoff = {
      kind: CONFIRM_KM_UPDATE_HANDOFF_KIND,
    } satisfies ConfirmKmUpdateHandoff;
    const keys = Object.keys(handoff);
    expect(keys).toEqual(["kind"]);
    expect(keys.length).toBe(1);
    expect(handoff.kind).toBe("confirm_km_update");
  });

  it("KmReportedEvent não carrega payload de domínio nem IDs", () => {
    const event = {
      kind: KM_REPORTED_EVENT_KIND,
    } satisfies KmReportedEvent;
    const forbidden = [
      "newKm",
      "expectedPreviousKm",
      "vehicleId",
      "requestMessageId",
      "isCorrection",
      "draft",
      "draftId",
      "draftVersion",
      "statePatch",
      "responseKey",
      "queueItemId",
      "conversationStateId",
      "confirmationMessageId",
      "sourceMessageId",
      "actionExecutionId",
      "userId",
      "contactId",
      "orchestratorVersion",
      "payload",
      "data",
      "metadata",
      "timestamp",
    ];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(event, key)).toBe(false);
    }
  });

  it("ConfirmKmUpdateHandoff não carrega payload de domínio nem IDs", () => {
    const handoff = {
      kind: CONFIRM_KM_UPDATE_HANDOFF_KIND,
    } satisfies ConfirmKmUpdateHandoff;
    const forbidden = [
      "newKm",
      "expectedPreviousKm",
      "vehicleId",
      "requestMessageId",
      "isCorrection",
      "draft",
      "draftId",
      "draftVersion",
      "statePatch",
      "responseKey",
      "queueItemId",
      "conversationStateId",
      "confirmationMessageId",
      "sourceMessageId",
      "actionExecutionId",
      "userId",
      "contactId",
      "orchestratorVersion",
      "payload",
      "data",
      "metadata",
      "timestamp",
    ];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(handoff, key)).toBe(false);
    }
  });

  it("duas construções equivalentes possuem a mesma estrutura", () => {
    const a = { kind: KM_REPORTED_EVENT_KIND } satisfies KmReportedEvent;
    const b = { kind: KM_REPORTED_EVENT_KIND } satisfies KmReportedEvent;
    expect(Object.keys(a)).toEqual(Object.keys(b));
    expect(a.kind).toBe(b.kind);

    const c = {
      kind: CONFIRM_KM_UPDATE_HANDOFF_KIND,
    } satisfies ConfirmKmUpdateHandoff;
    const d = {
      kind: CONFIRM_KM_UPDATE_HANDOFF_KIND,
    } satisfies ConfirmKmUpdateHandoff;
    expect(Object.keys(c)).toEqual(Object.keys(d));
    expect(c.kind).toBe(d.kind);
  });

  it("evento e handoff são tipos distintos por seu literal", () => {
    const event = { kind: KM_REPORTED_EVENT_KIND } satisfies KmReportedEvent;
    const handoff = {
      kind: CONFIRM_KM_UPDATE_HANDOFF_KIND,
    } satisfies ConfirmKmUpdateHandoff;
    expect(event.kind).not.toBe(handoff.kind);

    // Alias-level: KmReportedEventKind e ConfirmKmUpdateHandoffKind são
    // literais disjuntos.
    const ek: KmReportedEventKind = KM_REPORTED_EVENT_KIND;
    const hk: ConfirmKmUpdateHandoffKind = CONFIRM_KM_UPDATE_HANDOFF_KIND;
    expect(ek).not.toBe(hk);
  });
});

describe("km-update-protocol — barrel", () => {
  it("re-exporta constantes e tipos pelo index", () => {
    expect(barrel.KM_REPORTED_EVENT_KIND).toBe("km_reported");
    expect(barrel.CONFIRM_KM_UPDATE_HANDOFF_KIND).toBe("confirm_km_update");
  });
});
