// Build 5.7F2A — Classificação determinística de comandos WhatsApp.
// Grupos disjuntos. Match EXATO no texto normalizado (após normalizeCommandText).
//
// BUILD CORRETIVO 1/5: expandido o vocabulário de confirm/deny/cancel_task
// com variações casuais reais (testadas antes deste build) + emojis de
// polegar checados no texto original, antes da normalização apagar
// emojis. Continua sendo match EXATO (lista fechada) — nenhuma tentativa
// de reconhecer "contém uma palavra parecida com sim/não" no meio de uma
// frase qualquer, pra não criar falso positivo perigoso (uma despesa/km
// sendo confirmada sem o usuário ter dito sim de verdade).

import type { NormalizedText } from "./normalize.ts";

export type CommandKind =
  | "greeting"
  | "help"
  | "confirm"
  | "deny"
  | "cancel_task"
  | "reset_conversation"
  | "explicit_opt_out"
  | "none";

const GREETING = new Set<string>([
  "OI",
  "OLA",
  "OPA",
  "E AI",
  "EAI",
  "BOM DIA",
  "BOA TARDE",
  "BOA NOITE",
]);

const HELP = new Set<string>(["AJUDA", "MENU", "HELP", "COMO FUNCIONA", "O QUE VOCE FAZ", "?"]);

const CONFIRM = new Set<string>([
  "SIM",
  "PODE",
  "CONFIRMA",
  "CONFIRMAR",
  "CORRETO",
  "ISSO",
  "OK",
  "PODE SIM",
  "PODE CONFIRMAR",
  "BLZ",
  "BELEZA",
  "SHOW",
  "FECHADO",
  "MANDA",
  "PODE IR",
  "ISSO MESMO",
  "YES",
  "COM CERTEZA",
  "SIM PODE",
  "CLARO",
  "TA BOM",
  "TA BOM E AI",
  "TA CERTO",
  "TA OTIMO",
  "PERFEITO",
]);

const DENY = new Set<string>([
  "NAO",
  "ERRADO",
  "NEGATIVO",
  "NAO ESTA CERTO",
  "NAO PERA",
  "NAO, PERA",
  "ACHO QUE NAO",
  "MELHOR NAO",
  "NAO ISSO NAO",
]);

const CANCEL_TASK = new Set<string>([
  "CANCELA",
  "CANCELAR",
  "DEIXA PRA LA",
  "DEIXA PRA LA ISSO",
  "ESQUECE",
  "PODE IGNORAR",
  "NAO QUERO CONTINUAR ISSO",
  "DEIXA QUIETO",
  "CANCELA ISSO AI",
]);

// Emojis inequívocos de sim/não, checados no texto ORIGINAL (antes da
// normalização apagar emojis). Só variações de tom de pele do polegar —
// a mensagem inteira precisa ser só o emoji (trim simples), sem mais
// nada junto.
const THUMBS_UP = new Set<string>(["👍", "👍🏻", "👍🏼", "👍🏽", "👍🏾", "👍🏿"]);
const THUMBS_DOWN = new Set<string>(["👎", "👎🏻", "👎🏼", "👎🏽", "👎🏾", "👎🏿"]);

const RESET_CONVERSATION = new Set<string>(["RECOMECAR", "COMECAR DE NOVO", "REINICIAR CONVERSA"]);

// Opt-out EXPLÍCITO. Match exato no texto normalizado inteiro.
const EXPLICIT_OPT_OUT = new Set<string>([
  "SAIR",
  "PARAR",
  "STOP",
  "REMOVER MEU NUMERO",
  "NAO QUERO RECEBER MENSAGENS",
  "PARE DE ME ENVIAR MENSAGENS",
  "CANCELAR MENSAGENS",
]);

export function classifyCommand(n: NormalizedText): CommandKind {
  const rawTrimmed = n.originalText.trim();
  if (THUMBS_UP.has(rawTrimmed)) return "confirm";
  if (THUMBS_DOWN.has(rawTrimmed)) return "deny";

  if (n.isEmpty && !n.isQuestionMarkOnly) return "none";
  const t = n.normalizedText;
  if (t === "") return "none";

  if (EXPLICIT_OPT_OUT.has(t)) return "explicit_opt_out";
  if (GREETING.has(t)) return "greeting";
  if (HELP.has(t)) return "help";
  if (CANCEL_TASK.has(t)) return "cancel_task";
  if (RESET_CONVERSATION.has(t)) return "reset_conversation";
  if (CONFIRM.has(t)) return "confirm";
  if (DENY.has(t)) return "deny";
  return "none";
}

export function looksLikeCorrectionHint(n: NormalizedText): boolean {
  const t = n.normalizedText;
  if (t === "") return false;
  if (t.startsWith("NAO ") && t.length > 4) return true;
  return false;
}
