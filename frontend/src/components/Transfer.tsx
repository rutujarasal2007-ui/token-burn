import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { fmt } from '../format';
import { usePoll } from '../usePoll';

export default function Transfer({
  refreshTick,
  trackJob,
}: {
  refreshTick: number;
  trackJob: (jobId: string) => void;
}) {
  const accounts = usePoll(() => api.accounts(), refreshTick);
  const ledger = usePoll(() => api.ledger(), refreshTick);

  const nicknames = useMemo(
    () => (accounts.data?.accounts ?? []).map((a) => a.nickname),
    [accounts.data],
  );

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const burnRateBps = ledger.data?.ledger ? BigInt(ledger.data.ledger.burnRateBps) : 0n;
  const expectedBurn = useMemo(() => {
    try {
      const amt = BigInt(amount.trim());
      if (amt <= 0n) return null;
      return (amt * burnRateBps) / 10000n;
    } catch {
      return null;
    }
  }, [amount, burnRateBps]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { jobId } = await api.transfer(from, to, amount);
      trackJob(jobId);
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = !from || !to || from === to || !amount || submitting;

  return (
    <section>
      <h2>Transfer Tokens</h2>
      <p className="muted">
        Transfers automatically burn {ledger.data?.ledger ? `${ledger.data.ledger.burnRatePercent}%` : '—'} of the
        transferred amount. Proof generation can take 30–60 seconds.
      </p>
      {error && <p className="error">{error}</p>}

      <form className="form" onSubmit={onSubmit}>
        <label>
          From
          <select value={from} onChange={(e) => setFrom(e.target.value)} required>
            <option value="" disabled>Select account</option>
            {nicknames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <label>
          To
          <select value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="" disabled>Select account</option>
            {nicknames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <label>
          Amount (TBURN)
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 10000"
            required
          />
        </label>

        {expectedBurn !== null && (
          <div className="notice">
            Recipient receives <strong>{fmt(amount)}</strong> TBURN and <strong>{fmt(expectedBurn)}</strong> TBURN is
            burned.
          </div>
        )}

        <button type="submit" disabled={disabled}>
          {submitting ? 'Submitting…' : 'Transfer'}
        </button>
      </form>
    </section>
  );
}
