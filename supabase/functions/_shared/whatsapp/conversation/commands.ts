// Build 5.7F2A — Classificação determinística de comandos WhatsApp.
// Grupos disjuntos. Match EXATO no texto normalizado (após normalizeCommandText).

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

const HELP = new Set<string>([
  "AJUDA",
  "MENU",
  "HELP",
  "COMO FUNCIONA",
  "O QUE VOCE FAZ",
  "?",
]);

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
]);

const DENY = new Set<string>([
  "NAO",
  "ERRADO",
  "NEGATIVO",
  "NAO ESTA CERTO",
]);

const CANCEL_TASK = new Set<string>([
  "CANCELA",
  "CANCELAR",
  "DEIXA PRA LA",
  "DEIXA PRA LA ISSO",
  "ESQUECE",
  "PODE IGNORAR",
  "NAO QUERO CONTINUAR ISSO",
]);

const RESET_CONVERSATION = new Set<string>([
  "RECOMECAR",
  "COMECAR DE NOVO",
  "REINICIAR CONVERSA",
]);

// Opt-out EXPLÍCITO. Match exato no texto normalizado inteiro.
// Palavras isoladas ambíguas (ex.: "REMOVER", "NAO QUERO") NUNCA são opt-out.
const EXPLICIT_OPT_OUT = new Set<string>([
  "SAIR",
  "PARAR",
  "STOP",
  "REMOVER MEU NUMERO",
  "NAO QUERO RECEBER MENSAGENS",
  "PARE DE ME ENVIAR MENSAGENS",
  "CANCELAR MENSAGENS",
]);

/**
 * Classifica um texto já normalizado. Retorna "none" quando nada casa.
 * Ordem interna importa quando um mesmo token aparece em dois grupos —
 * por design, GREETING vem antes de HELP para que "OI" nunca vire ajuda.
 */
export function classifyCommand(n: NormalizedText): CommandKind {
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

/**
 * Diferencia negação simples de possível indício de correção futura.
 * O core NÃO implementa correção de valor/KM neste build; apenas expõe o sinal.
 */
export function looksLikeCorrectionHint(n: NormalizedText): boolean {
  const t = n.normalizedText;
  if (t === "") return false;
  // negativa curta seguida de complemento ("NAO ESTA CERTO", "NAO E ISSO", etc.)
  if (t.startsWith("NAO ") && t.length > 4) return true;
  return false;
}
