'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Masthead } from '@/components/Masthead';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** The shape docs/endpoint-contract.md promises. Not yet served — see below. */
interface Application {
  id: string;
  status:
    | 'draft'
    | 'submitted'
    | 'verifying'
    | 'verification_pending'
    | 'review'
    | 'verified'
    | 'rejected';
  submittedAt: string | null;
}

/**
 * Customer-facing status wording.
 *
 * Deliberately soft, and deliberately incapable of naming which check caused a
 * problem (invariant 9). "We are reviewing your application" covers a fuzzy
 * name match, a provider outage and a genuine mismatch alike — the customer
 * cannot use this page to work out which, so it cannot be used to probe.
 */
const STATUS_COPY: Record<Application['status'], { pill: string; label: string; blurb: string }> = {
  draft: { pill: 'pill-pending', label: 'Not submitted', blurb: 'Finish your details and submit when you are ready.' },
  submitted: { pill: 'pill-pending', label: 'Submitted', blurb: 'We have your application and will start checks shortly.' },
  verifying: { pill: 'pill-pending', label: 'In progress', blurb: 'We are running the usual identity checks. This is normally quick.' },
  verification_pending: { pill: 'pill-pending', label: 'In progress', blurb: 'We are experiencing a short delay. Nothing is needed from you.' },
  review: { pill: 'pill-review', label: 'Being reviewed', blurb: 'One of our team is looking at your application.' },
  verified: { pill: 'pill-pass', label: 'Approved', blurb: 'Your account is open. Welcome.' },
  rejected: { pill: 'pill-fail', label: 'Not approved', blurb: 'We are not able to open an account at this time.' },
};

export default function ApplicationPage() {
  const session = useSession();
  const router = useRouter();
  const [application, setApplication] = useState<Application | null>(null);
  const [pendingApi, setPendingApi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (session.status === 'signed-out') router.replace('/login');
  }, [session.status, router]);

  const wrongSurface = session.status === 'signed-in' && session.user.role !== 'CUSTOMER';

  useEffect(() => {
    if (session.status !== 'signed-in' || wrongSurface) return;

    api<{ applications: Application[] }>('/api/applications/me')
      .then(({ applications }) => setApplication(applications[0] ?? null))
      .catch((caught) => {
        // The applications API is M0 slice 4 and is not built yet. Rather than
        // mock a screen that would lie to a demonstration audience, say so.
        if (caught instanceof ApiError && caught.status === 404) setPendingApi(true);
        else setError(caught instanceof ApiError ? caught.message : 'Could not load your application.');
      })
      .finally(() => setLoaded(true));
  }, [session.status, wrongSurface]);

  if (session.status !== 'signed-in') {
    return (
      <main className="narrow">
        <div className="empty">
          <span className="spinner" aria-hidden="true" />
        </div>
      </main>
    );
  }

  const copy = application ? STATUS_COPY[application.status] : null;

  return (
    <>
      <Masthead session={session} />
      <main>
        <div className="page-head">
          <h1>Your application</h1>
          <p className="lede">Signed in as {session.user.email}</p>
        </div>

        {/*
          A member of staff signing in here is not a customer and has no
          application of their own. This is easy to hit in development because
          cookies ignore the port number, so signing into the staff dashboard
          on :3001 replaces the session on :3000. Rather than render a customer
          screen for an employee, say so.
        */}
        {wrongSurface && (
          <div className="card">
            <h2>This is the customer app</h2>
            <p style={{ color: 'var(--ink-muted)', marginTop: 0 }}>
              You are signed in as a member of staff, who has no application of their own. Use
              the staff dashboard to review applications.
            </p>
          </div>
        )}

        {!loaded && !wrongSurface && (
          <div className="card">
            <span className="spinner" aria-hidden="true" /> Loading…
          </div>
        )}

        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        {pendingApi && !wrongSurface && (
          <div className="card">
            <h2>Not built yet</h2>
            <p style={{ color: 'var(--ink-muted)', marginTop: 0 }}>
              This screen is wired to <span className="mono">GET /api/applications/me</span>, which
              is M0 slice 4 and does not exist yet. It is left honest rather than filled with
              invented data — a demonstration should never show a screen that cannot happen.
            </p>
            <p style={{ color: 'var(--ink-muted)' }}>
              Sign-in, sign-out and session handling above are real and talk to the live API.
            </p>
          </div>
        )}

        {loaded && !pendingApi && !wrongSurface && !application && (
          <div className="card">
            <h2>No application yet</h2>
            <p style={{ color: 'var(--ink-muted)', marginTop: 0 }}>
              Start one and we will guide you through it.
            </p>
            <div className="actions">
              <button type="button" disabled>
                Start application
              </button>
            </div>
          </div>
        )}

        {application && copy && (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Status</h2>
              <span className={`pill ${copy.pill}`}>{copy.label}</span>
            </div>
            <p style={{ color: 'var(--ink-muted)', margin: 0 }}>{copy.blurb}</p>
            <dl className="facts" style={{ marginTop: 20 }}>
              <dt>Reference</dt>
              <dd className="mono">{application.id}</dd>
              {application.submittedAt && (
                <>
                  <dt>Submitted</dt>
                  <dd>{new Date(application.submittedAt).toLocaleString('en-GB')}</dd>
                </>
              )}
            </dl>
          </div>
        )}
      </main>
    </>
  );
}
