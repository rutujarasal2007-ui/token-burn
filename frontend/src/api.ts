export interface LedgerData {
  totalSupply: string;
  totalBurned: string;
  burnRateBps: string;
  initialSupply: string;
  burnedPercent: number;
  burnRatePercent: number;
}

export interface AccountInfo {
  nickname: string;
  index: number;
  accountKeyHex: string;
  balance: string;
  isOwner: boolean;
}

export interface WalletInfo {
  address: string;
  tNight: string;
  dust: string;
  synced: boolean;
}

export interface JobResult {
  ledger?: LedgerData | null;
  blockHeight?: number;
  amount?: string;
  burn?: string;
  from?: string;
  to?: string;
  account?: string;
}

export interface Job {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  result?: JobResult;
  error?: string;
}

export interface Health {
  ok: boolean;
  ready: boolean;
  network: string;
  contractAddress: string | null;
  bootError: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = (await res.json().catch(() => null)) as
    | { ok: boolean; error?: string }
    | null;
  if (!res.ok || !body?.ok) {
    throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  health: () => request<Health>('/api/health'),
  ledger: () => request<{ ok: boolean; ledger: LedgerData | null }>('/api/ledger'),
  accounts: () => request<{ ok: boolean; accounts: AccountInfo[] }>('/api/accounts'),
  wallet: () => request<{ ok: boolean; wallet: WalletInfo }>('/api/wallet'),
  job: (id: string) => request<{ ok: boolean; job: Job }>(`/api/jobs/${id}`),
  createAccount: (nickname: string) =>
    request<{ ok: boolean; account: AccountInfo }>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    }),
  fund: (nickname: string, amount: string) =>
    request<{ ok: boolean; jobId: string }>(`/api/accounts/${encodeURIComponent(nickname)}/fund`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  transfer: (from: string, to: string, amount: string) =>
    request<{ ok: boolean; jobId: string }>('/api/transfer', {
      method: 'POST',
      body: JSON.stringify({ from, to, amount }),
    }),
  burn: (account: string, amount: string) =>
    request<{ ok: boolean; jobId: string }>('/api/burn', {
      method: 'POST',
      body: JSON.stringify({ account, amount }),
    }),
};
