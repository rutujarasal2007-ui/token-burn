import { type Job } from '../api';
import { fmt } from '../format';

function describe(job: Job): string {
  const r = job.result;
  if (job.status === 'done' && r) {
    const parts: string[] = [];
    if (r.from && r.to) parts.push(`${r.from} → ${r.to}`);
    if (r.account && r.account !== 'owner') parts.push(`account ${r.account}`);
    if (r.amount) parts.push(`${fmt(r.amount)} TBURN`);
    if (r.burn) parts.push(`burned ${fmt(r.burn)}`);
    if (r.blockHeight !== undefined) parts.push(`block ${r.blockHeight}`);
    return `${job.kind}: ${parts.join(', ')}`;
  }
  return `${job.kind}: ${job.status}`;
}

export default function JobBanner({ jobs, onDone }: { jobs: Job[]; onDone: () => void }) {
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');

  return (
    <div className="jobbanner">
      {active.map((job) => (
        <div key={job.id} className="job job-active">
          <span className="spinner" />
          <span>{describe(job)}</span>
        </div>
      ))}
      {jobs
        .filter((j) => j.status === 'done')
        .slice(-3)
        .map((job) => (
          <div key={job.id} className="job job-done">
            <span className="job-icon">✓</span>
            <span>{describe(job)}</span>
            <button className="btn-sm ghost" onClick={onDone}>dismiss</button>
          </div>
        ))}
      {jobs
        .filter((j) => j.status === 'error')
        .slice(-3)
        .map((job) => (
          <div key={job.id} className="job job-error">
            <span className="job-icon">✕</span>
            <span>
              {describe(job)}
              {job.error && <span className="muted"> — {job.error}</span>}
            </span>
            <button className="btn-sm ghost" onClick={onDone}>dismiss</button>
          </div>
        ))}
    </div>
  );
}
