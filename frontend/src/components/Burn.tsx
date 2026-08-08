import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { fmt } from '../format';
import { usePoll } from '../usePoll';

export default function Burn({
  refreshTick,
  trackJob,
}: {
  refreshTick: number;
  trackJob: (jobId: string) => void;
}) {
  const accounts = usePoll(() => api.accounts(), refreshTick);
  const nicknames = useMemo(
    () => (accounts.data?.accounts ?? []).map((a) => a.nickname),
    [accounts.data],
  );

  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { jobId } = await api.burn(account, amount);
      trackJob(jobId);
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>Voluntary Burn</h2>
      <p className="muted">
        Permanently remove tokens from the circulating supply — 100% of the amount is burned.
      </p>
      {error && <p className="error">{error}</p>}

      <form className="form" onSubmit={onSubmit}>
        <label>
          Account
          <select value={account} onChange={(e) => setAccount(e.target.value)} required>
            <option value="" disabled>Select account</option>
            {nicknames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <label>
          Amount to burn (TBURN)
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 500"
            required
          />
        </label>

        <button type="submit" disabled={!account || !amount || submitting}>
          {submitting ? 'Submitting…' : `Burn ${amount ? fmt(amount) : ''} TBURN`}
        </button>
      </form>
    </section>
  );
}
