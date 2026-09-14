// Cupom-Promocional: cálculo puro do valor com desconto percentual
// aplicado. Vive em _shared/ (não específico de WhatsApp) seguindo o
// mesmo precedente de pagamento-pipeline.ts, e é usado por
// gerar-pix-asaas/index.ts.

export function calcularValorComCupom(precoBase: number, descontoPercentual: number): number {
  const valor = precoBase * (1 - descontoPercentual / 100);
  return Math.round(valor * 100) / 100;
}
