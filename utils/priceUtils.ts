/** "$29.99" or "Item total: $29.99" -> 29.99 */
export function parsePrice(text: string): number {
  const match = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!match) throw new Error(`Could not parse price from "${text}"`);
  return Number(match[1].replace(/,/g, ''));
}

/** Round to cents to avoid floating point noise when summing prices. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
