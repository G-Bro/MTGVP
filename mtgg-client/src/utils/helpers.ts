/** Shuffle an array in-place using Fisher-Yates. Returns the same array. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Roll a die with `sides` faces (default d20). */
export function rollDie(sides = 20): number {
  return Math.floor(Math.random() * sides) + 1;
}

function normalizeWorkerUrl(raw?: string): string {
  const value = (raw ?? '').trim();
  if (!value) return 'http://localhost:8787';

  // If protocol is missing, default to https for deployed worker domains.
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, '');
}

/** Worker base URL – set VITE_WORKER_URL in .env or GitHub Actions secrets. */
export const WORKER_URL = normalizeWorkerUrl(
  import.meta.env.VITE_WORKER_URL as string | undefined,
);
