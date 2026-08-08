import { api } from '../api';
import { fmt } from '../format';
import { usePoll } from '../usePoll';

export default function Dashboard({ refreshTick }: { refreshTick: number }) {
  const { data, error, loading } = usePoll(() => api.ledger(), refreshTick);
  const ledger = data?.ledger ?? null;

  return (
    <section>
      <h2>Token Dashboard</h2>
      {error && <p className="error">{error}</p>}
      {loading && !ledger && <p className="muted">Loading…</p>}

      <div className="cards">
        <div className="card">
          <div className="card-label">Initial supply</div>
          <div className="card-value">{ledger ? `${fmt(ledger.initialSupply)} TBURN` : '—'}</div>
        </div>
        <div className="card">
          <div className="card-label">Circulating supply</div>
          <div className="card-value">{ledger ? `${fmt(ledger.totalSupply)} TBURN` : '—'}</div>
        </div>
        <div className="card">
          <div className="card-label">Total burned</div>
          <div className="card-value">{ledger ? `${fmt(ledger.totalBurned)} TBURN` : '—'}</div>
        </div>
        <div className="card">
          <div className="card-label">Burned of initial</div>
          <div className="card-value">{ledger ? `${ledger.burnedPercent}%` : '—'}</div>
        </div>
        <div className="card">
          <div className="card-label">Burn rate</div>
          <div className="card-value">{ledger ? `${ledger.burnRatePercent}% per transfer` : '—'}</div>
        </div>
      </div>

      {ledger && (
        <div className="burn-bar">
          <div className="burn-bar-fill" style={{ width: `${Math.min(100, ledger.burnedPercent)}%` }} />
        </div>
      )}
      <p className="muted small">
        A deflationary Midnight token: every transfer automatically burns {ledger ? `${ledger.burnRatePercent}%` : '—'}{' '}
        of the transferred amount. Only the aggregate burn is ever revealed on-chain.
      </p>
    </section>
  );
}
