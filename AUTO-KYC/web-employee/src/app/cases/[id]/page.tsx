'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Masthead } from '@/components/Masthead';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';

type CheckResult = 'pass' | 'review' | 'fail' | 'not_available';

interface Check {
  checkType: string;
  result: CheckResult;
  /** Invariant 5: every check carries a human-readable reason. */
  reason: string;
  provider?: { name: string; mode: 'mock' | 'real' };
}

interface CaseDetail {
  id: string;
  applicationId: string;
  status: 'open' | 'resolved';
  reasonSummary: string;
  checks: Check[];
}

const RESULT_PILL: Record<CheckResult, string> = {
  pass: 'pill-pass',
  review: 'pill-review',
  fail: 'pill-fail',
  not_available: 'pill-pending',
};

const RESULT_LABEL: Record<CheckResult, string> = {
  pass: 'Pass',
  review: 'Review',
  fail: 'Fail',
  not_available: 'Unavailable',
};

export default function CasePage() {
  const session = useSession();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [pendingApi, setPendingApi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (session.status === 'signed-out') router.replace('/login');
  }, [session.status, router]);

  useEffect(() => {
    if (session.status !== 'signed-in' || !params?.id) return;

    api<{ case: CaseDetail }>(`/api/cases/${params.id}`)
      .then((body) => setDetail(body.case))
      .catch((caught) => {
        if (caught instanceof ApiError && caught.status === 404) setPendingApi(true);
        else setError(caught instanceof ApiError ? caught.message : 'Could not load this case.');
      })
      .finally(() => setLoaded(true));
  }, [session.status, params?.id]);

  if (session.status !== 'signed-in') {
    return (
      <main className="narrow">
        <div className="empty">
          <span className="spinner" aria-hidden="true" />
        </div>
      </main>
    );
  }

  return (
    <>
      <Masthead session={session} />
      <main>
        <div className="page-head">
          <a href="/queue" style={{ fontSize: 13 }}>
            ← Back to queue
          </a>
          <h1 style={{ marginTop: 10 }}>Case</h1>
          {detail && <p className="lede">{detail.reasonSummary}</p>}
        </div>

        {!loaded && (
          <div className="card">
            <span className="spinner" aria-hidden="true" /> Loading…
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
              Wired to <span className="mono">GET /api/cases/:id</span> (M0 slice 5). The check
              rows below are what it will render: one line per check, each with the result and
              the reason behind it.
            </p>
            <p style={{ color: 'var(--ink-muted)', marginBottom: 0 }}>
              No sample data is shown, because a reason that nobody produced is not a reason.
            </p>
          </div>
        )}

        {detail && (
          <>
            <div className="card">
              <h2>Checks</h2>
              <p style={{ color: 'var(--ink-muted)', marginTop: -6 }}>
                Each line is a decision made by the rules engine, with the evidence that led to
                it. OCR and providers supply evidence; they never decide.
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Result</th>
                      <th>Reason</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.checks.map((check) => (
                      <tr key={check.checkType}>
                        <td>{check.checkType.replace(/_/g, ' ')}</td>
                        <td>
                          <span className={`pill ${RESULT_PILL[check.result]}`}>
                            {RESULT_LABEL[check.result]}
                          </span>
                        </td>
                        <td>{check.reason}</td>
                        <td>
                          {check.provider?.mode === 'mock' ? (
                            // Invariant 10: a simulated result must never be
                            // mistakable for a real one, least of all by the
                            // person deciding a customer's application.
                            <span className="pill pill-simulated">simulated</span>
                          ) : (
                            <span className="mono">{check.provider?.name ?? '—'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <h2>Decision</h2>
              <p style={{ color: 'var(--ink-muted)', marginTop: -6 }}>
                A reason is required. It is written to the audit log and cannot be edited
                afterwards.
              </p>
              <div className="field">
                <label htmlFor="reason">Reason</label>
                <textarea id="reason" rows={3} disabled />
              </div>
              <div className="actions">
                <button type="button" disabled>
                  Approve
                </button>
                <button type="button" className="secondary" disabled>
                  Request more information
                </button>
                <button type="button" className="secondary" disabled>
                  Reject
                </button>
              </div>
              <p className="hint">
                Disabled until <span className="mono">POST /api/cases/:id/resolution</span> exists.
              </p>
            </div>
          </>
        )}
      </main>
    </>
  );
}
