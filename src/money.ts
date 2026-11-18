import { z } from 'zod';

export const decimalAmount = z.string().regex(/^-?(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/, 'Use a decimal string with at most three decimal places, e.g. "-12.34".');

/** Never round a floating-point currency input. YNAB amounts are integer milliunits. */
export function toMilliunits(value: string): number {
  decimalAmount.parse(value);
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  const milliunits = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  return Number(negative ? -milliunits : milliunits);
}

export function fromMilliunits(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error('Invalid milliunit amount.');
  const absolute = BigInt(value < 0 ? -value : value);
  return `${value < 0 ? '-' : ''}${absolute / 1000n}.${String(absolute % 1000n).padStart(3, '0')}`;
}
