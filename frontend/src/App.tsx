import { useCallback, useEffect, useState } from 'react';
import { api, type Health, type Job } from './api';
import Dashboard from './components/Dashboard';
import Accounts from './components/Accounts';
import Transfer from './components/Transfer';
import Burn from './components/Burn';
import Wallet from './components/Wallet';
import JobBanner from './components/JobBanner';

type Tab = 'dashboard' | 'accounts' | 'transfer' | 'burn' | 'wallet';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'burn', label: 'Burn' },
  { id: 'wallet', label: 'Wallet' },
];

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [reachable, setReachable] = useState(true);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [refreshTick, setRefreshTick] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const h = await api.health();
        if (active) {
          setHealth(h);
          setReachable(true);
        }
      } catch {
        if (active) setReachable(false);
      }
    };
    void poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const trackJob = useCallback(
    (jobId: string) => {
      const poll = async () => {
        try {
          const { job } = await api.job(jobId);
          setJobs((prev) => {
            const exists = prev.some((j) => j.id === job.id);
            return exists ? prev.map((j) => (j.id === job.id ? job : j)) : [...prev, job];
          });
          if (job.status === 'done' || job.status === 'error') {
            clearInterval(interval);
            refresh();
          }
        } catch {
          clearInterval(interval);
        }
      };
      const interval = setInterval(poll, 2000);
      void poll();
    },
    [refresh],
  );

  if (!reachable) {
    return (
      <div className="center-screen">
        <h1>Token Burn</h1>
        <p className="error">API server unreachable. Start it with <code>npm run api</code> in the project root.</p>
      </div>
    );
  }

  if (!health?.ready) {
    return (
      <div className="center-screen">
        <h1>Token Burn</h1>
        <p className="muted">Connecting to the operator wallet…</p>
        {health?.bootError && <p className="error">{health.bootError}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot">▲</span> Token Burn
          <span className="badge">{health.network}</span>
        </div>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="contract-addr" title={health.contractAddress ?? ''}>
          {health.contractAddress ? `Contract: ${health.contractAddress}` : 'No contract'}
        </span>
      </header>

      {jobs.length > 0 && <JobBanner jobs={jobs} onDone={refresh} />}

      <main className="content">
        {tab === 'dashboard' && <Dashboard refreshTick={refreshTick} />}
        {tab === 'accounts' && <Accounts refreshTick={refreshTick} trackJob={trackJob} />}
        {tab === 'transfer' && <Transfer refreshTick={refreshTick} trackJob={trackJob} />}
        {tab === 'burn' && <Burn refreshTick={refreshTick} trackJob={trackJob} />}
        {tab === 'wallet' && <Wallet refreshTick={refreshTick} />}
      </main>
    </div>
  );
}
