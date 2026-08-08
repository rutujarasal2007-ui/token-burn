import { useState, type FormEvent } from 'react';
import { api, type AccountInfo } from '../api';
import { fmt, shortKey } from '../format';
import { usePoll } from '../usePoll';

export default function Accounts({
  refreshTick,
  trackJob,
}: {
  refreshTick: number;
  trackJob: (jobId: string) => void;
}) {
  const { data, error } = usePoll(() => api.accounts(), refreshTick);
  const accounts: AccountInfo[] = data?.accounts ?? [];

  const [nickname, setNickname] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [funding, setFunding] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState('');

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreating(true);
    try {
      await api.createAccount(nickname);
      setNickname('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  function onFund(nick: string, e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amount = fundAmount.trim();
    if (!amount) {
      setFormError('Enter an amount');
      return;
    }
    try {
      api.fund(nick, amount)
        .then(({ jobId }) => trackJob(jobId))
        .catch((err: unknown) => setFormError(err instanceof Error ? err.message : String(err)));
      setFunding(null);
      setFundAmount('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section>
      <h2>Accounts</h2>
      {error && <p className="error">{error}</p>}
      {formError && <p className="error">{formError}</p>}

      <form className="row" onSubmit={onCreate}>
        <input
          placeholder="New account nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          pattern="[a-zA-Z0-9_-]+"
          required
        />
        <button type="submit" disabled={creating || !nickname}>
          {creating ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <table className="table">
        <thead>
          <tr>
            <th>Account</th>
            <th className="num">Balance (TBURN)</th>
            <th>Key</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((acc) => (
            <tr key={acc.nickname}>
              <td>
                {acc.nickname}
                {acc.isOwner && <span className="badge badge-sm">owner</span>}
              </td>
              <td className="num">{fmt(acc.balance)}</td>
              <td className="mono">{shortKey(acc.accountKeyHex)}</td>
              <td className="num">
                {acc.isOwner ? (
                  <span className="muted small">funding source</span>
                ) : funding === acc.nickname ? (
                  <form
                    className="row inline"
                    onSubmit={(e) => onFund(acc.nickname, e)}
                  >
                    <input
                      placeholder="Amount"
                      value={fundAmount}
                      onChange={(e) => setFundAmount(e.target.value)}
                      inputMode="numeric"
                      required
                    />
                    <button type="submit" className="btn-sm">Fund</button>
                    <button
                      type="button"
                      className="btn-sm ghost"
                      onClick={() => setFunding(null)}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => {
                      setFunding(acc.nickname);
                      setFundAmount('');
                    }}
                  >
                    Fund
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        The <code>owner</code> account holds the initial supply and is used to fund new accounts.
      </p>
    </section>
  );
}
