import { api } from '../api';
import { fmt } from '../format';
import { usePoll } from '../usePoll';

export default function Wallet({ refreshTick }: { refreshTick: number }) {
  const { data, error } = usePoll(() => api.wallet(), refreshTick, 10_000);
  const wallet = data?.wallet;

  return (
    <section>
      <h2>Operator Wallet</h2>
      {error && <p className="error">{error}</p>}
      {wallet ? (
        <div className="cards">
          <div className="card wide">
            <div className="card-label">Address</div>
            <div className="card-value mono small">{wallet.address}</div>
          </div>
          <div className="card">
            <div className="card-label">tNight</div>
            <div className="card-value">{fmt(wallet.tNight)}</div>
          </div>
          <div className="card">
            <div className="card-label">DUST</div>
            <div className="card-value">{fmt(wallet.dust)}</div>
          </div>
          <div className="card">
            <div className="card-label">Sync status</div>
            <div className="card-value">{wallet.synced ? 'Synced ✓' : 'Syncing…'}</div>
          </div>
        </div>
      ) : (
        <p className="muted">Loading wallet…</p>
      )}
    </section>
  );
}
