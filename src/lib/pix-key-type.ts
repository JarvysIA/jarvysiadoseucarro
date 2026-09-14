// Saque-Padrinho: detecta o tipo de uma chave PIX (profiles.pix_recebimento
// guarda só o VALOR da chave, nunca o tipo) — necessário pro campo
// pixAddressKeyType exigido pelo endpoint POST /v3/transfers da Asaas.

export type PixAddressKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";

export function detectPixKeyType(chaveRaw: string): PixAddressKeyType {
  const chave = (chaveRaw ?? "").trim();

  // EMAIL: chave de e-mail sempre contém "@".
  if (chave.includes("@")) return "EMAIL";

  // PHONE: chave de telefone no Pix é sempre representada no formato E.164
  // com "+" (ex: +5511987654321) — nunca como dígitos soltos.
  if (chave.startsWith("+")) return "PHONE";

  const digits = chave.replace(/\D/g, "");

  // CPF: 11 dígitos (com ou sem máscara "000.000.000-00").
  if (digits.length === 11) return "CPF";

  // CNPJ: 14 dígitos (com ou sem máscara "00.000.000/0000-00").
  if (digits.length === 14) return "CNPJ";

  // EVP (chave aleatória, formato UUID) — último recurso: qualquer chave
  // que não bateu em nenhum caso acima (UUIDs têm letras hexadecimais que
  // nunca reduzem a exatamente 11 ou 14 dígitos numéricos).
  return "EVP";
}
