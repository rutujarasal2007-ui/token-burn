const nf = new Intl.NumberFormat('en-US');

export function fmt(value: string | bigint | number | undefined | null): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'number') return nf.format(value);
  try {
    return nf.format(BigInt(value));
  } catch {
    return String(value);
  }
}

export function shortKey(key: string): string {
  if (key.length <= 16) return key;
  return `${key.slice(0, 12)}…${key.slice(-6)}`;
}
