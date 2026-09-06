'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Masthead } from '@/components/Masthead';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** The shape docs/endpoint-contract.md promises for GET /api/cases. */
interface CaseSummary {
  id: string;
  applicationId: string;
  status: 'open' | 'resolved';
  reasonSummary: string;
  assignedTo: string | null;
  createdAt: string;
  /** Present once verification runs; marks results produced by a simulator. */
  providerMode?: 'mock' | 'real';
}

function age(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function QueuePage() {
  const session = useSession();
  const router = useRouter();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [pendingApi, setPendingApi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (session.status === 'signed-out') router.replace('/login');
    if (session.status === 'signed-in' && session.user.role === 'CUSTOMER') {
      router.replace('/login');
    }
  }, [session, router]);

  useEffect(() => {
    if (session.status !== 'signed-in' || session.user.role === 'CUSTOMER') return;

    api<{ cases: CaseSummary[] }>('/api/cases')
      .then(({ cases: rows }) => setCases(rows))
      .catch((caught) => {
        // Cases are M0 slice 5 and do not exist yet. Say so plainly rather
        // than seed the table with invented rows: a demonstration that shows
        // fabricated cases is worth less than one that admits what is built.
        if (caught instanceof ApiError && caught.status === 404) setPendingApi(true);
        else setError(caught instanceof ApiError ? caught.message : 'Could not load the queue.');
      })
      .finally(() => setLoaded(true));
  }, [session]);

  if (session.status !== 'signed-in') {
    return (
      <main className="narrow">
        <div className="empty">
          <span className="spinner" aria-hidden="true" />
        </div>
      </main>
    );
  }

  const open = cases.filter((c) => c.status === 'open');

  return (
    <>
      <Masthead session={session} />
      <main>
        <div className="page-head">
          <h1>Review queue</h1>
          <p className="lede">
            Only applications that need a human decision appear here. Everything clean is
            approved automatically.
          </p>
        </div>

        {!loaded && (
          <div className="card">
            <span className="spinner" aria-hidden="true" /> Loading queue…
          </div>
        )}

        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        {pendingApi && (
          <div className="card">
            <h2>Not built yet</h2>
            <p style={{ color: 'var(--ink-muted)', marginTop: 0 }}>
              This queue is wired to <span className="mono">GET /api/cases</span>, which is M0
              slice 5. Cases are created by the verification worker, which arrives in M1 along
              with the provider simulators.
            </p>
            <p style={{ color: 'var(--ink-muted)' }}>
              Left empty on purpose. Filling it with invented rows would make the demonstration
              less trustworthy, not more — the point of this system is that every decision has a
              real reason behind it.
            </p>
            <p style={{ color: 'var(--ink-muted)', marginBottom: 0 }}>
              Sign-in, roles and session handling are real and talk to the live API.
            </p>
          </div>
        )}

        {loaded && !pendingApi && open.length === 0 && (
          <div className="empty">
            <h2>Nothing waiting</h2>
            <p>
              No application currently needs a human decision. That is the system working as
              intended, not an error.
            </p>
          </div>
        )}

        {open.length > 0 && (
          <div className="card" style={{ padding: '18px 8px 8px' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Why it is here</th>
                    <th>Assigned</th>
                    <th>Waiting</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {open.map((row) => (
                    <tr key={row.id}>
                      <td className="mono">{row.applicationId.slice(0, 8)}</td>
                      <td>
                        {row.reasonSummary}
                        {row.providerMode === 'mock' && (
                          <span className="pill pill-simulated" style={{ marginLeft: 8 }}>
                            simulated
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--ink-muted)' }}>{row.assignedTo ?? 'Unassigned'}</td>
                      <td style={{ color: 'var(--ink-muted)' }}>{age(row.createdAt)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <a href={`/cases/${row.id}`}>Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
