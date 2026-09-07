'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApplicationForm } from '@/components/ApplicationForm';
import { Masthead } from '@/components/Masthead';
import {
  ApiError,
  createApplication,
  listApplications,
  type Application,
  type ApplicationStatus,
} from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Customer-facing status wording.
 *
 * Deliberately soft, and deliberately incapable of naming which check caused a
 * problem (invariant 9). "We are reviewing your application" covers a fuzzy
 * name match, a provider outage and a genuine mismatch alike, so the customer
 * cannot use this page to work out which and therefore cannot use it to probe.
 */
const STATUS_COPY: Record<ApplicationStatus, { pill: string; label: string; blurb: string }> = {
  draft: {
    pill: 'pill-pending',
    label: 'Not submitted',
    blurb: 'Finish your details and submit when you are ready.',
  },
  submitted: {
    pill: 'pill-pending',
    label: 'Submitted',
    blurb: 'We have your application and will start the checks shortly.',
  },
  verifying: {
    pill: 'pill-pending',
    label: 'In progress',
    blurb: 'We are running the usual identity checks. This is normally quick.',
  },
  verification_pending: {
    pill: 'pill-pending',
    label: 'In progress',
    blurb: 'We are experiencing a short delay. Nothing is needed from you.',
  },
  review: {
    pill: 'pill-review',
    label: 'Being reviewed',
    blurb: 'One of our team is looking at your application.',
  },
  verified: {
    pill: 'pill-pass',
    label: 'Approved',
    blurb: 'Your account is open. Welcome.',
  },
  rejected: {
    pill: 'pill-fail',
    label: 'Not approved',
    blurb: 'We are not able to open an account at this time.',
  },
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export default function ApplicationPage() {
  const session = useSession();
  const router = useRouter();
  const [application, setApplication] = useState<Application | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (session.status === 'signed-out') router.replace('/login');
  }, [session.status, router]);

  const wrongSurface = session.status === 'signed-in' && session.user.role !== 'CUSTOMER';

  const load = useCallback(() => {
    listApplications()
      .then(({ applications }) => setApplication(applications[0] ?? null))
      .catch((caught) =>
        setError(
          caught instanceof ApiError ? caught.message : 'Could not load your application.',
        ),
      )
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (session.status !== 'signed-in' || wrongSurface) return;
    load();
  }, [session.status, wrongSurface, load]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const { application: created } = await createApplication();
      setApplication(created);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not start an application.',
      );
    } finally {
      setStarting(false);
    }
  }

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
  const isDraft = application?.status === 'draft';

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
              You are signed in as a member of staff, who has no application of their own.
              Use the staff dashboard to review applications.
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

        {loaded && !wrongSurface && !application && (
          <div className="card">
            <h2>Ready when you are</h2>
            <p style={{ color: 'var(--ink-muted)', marginTop: 0 }}>
              You will need your PAN and your current address. It takes a few minutes and
              you can save and come back at any point.
            </p>
            <div className="actions">
              <button type="button" onClick={start} disabled={starting}>
                {starting ? 'Starting…' : 'Start application'}
              </button>
            </div>
          </div>
        )}

        {application && copy && (
          <>
            <div className="card card-tight">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>Status</h2>
                <span className={`pill ${copy.pill}`}>{copy.label}</span>
                <span style={{ color: 'var(--ink-muted)', fontSize: 14 }}>{copy.blurb}</span>
              </div>
            </div>

            {isDraft ? (
              <ApplicationForm application={application} onChanged={setApplication} />
            ) : (
              <div className="card">
                <h2>What you submitted</h2>
                <p style={{ color: 'var(--ink-muted)', marginTop: -6 }}>
                  This is a record of the details we are checking. It can no longer be
                  changed.
                </p>
                <dl className="facts">
                  <Detail label="Reference" value={application.id} />
                  {application.personalData.fullName && (
                    <Detail label="Name" value={application.personalData.fullName} />
                  )}
                  {application.personalData.dateOfBirth && (
                    <Detail
                      label="Date of birth"
                      value={new Date(application.personalData.dateOfBirth).toLocaleDateString(
                        'en-GB',
                        { day: 'numeric', month: 'long', year: 'numeric' },
                      )}
                    />
                  )}
                  {application.personalData.pan && (
                    <Detail label="PAN" value={application.personalData.pan} />
                  )}
                  {application.personalData.address && (
                    <Detail
                      label="Address"
                      value={[
                        application.personalData.address.line1,
                        application.personalData.address.line2,
                        application.personalData.address.city,
                        application.personalData.address.state,
                        application.personalData.address.postalCode,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    />
                  )}
                  <Detail
                    label="Consent"
                    value={application.consentRecorded ? 'Recorded' : 'Not recorded'}
                  />
                  {application.submittedAt && (
                    <Detail
                      label="Submitted"
                      value={new Date(application.submittedAt).toLocaleString('en-GB')}
                    />
                  )}
                </dl>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
