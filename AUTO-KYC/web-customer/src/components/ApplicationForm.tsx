'use client';

import { useState, type ChangeEvent } from 'react';
import {
  ApiError,
  recordConsent,
  saveApplication,
  submitApplication,
  type Application,
  type PersonalData,
} from '@/lib/api';

interface Props {
  application: Application;
  onChanged: (application: Application) => void;
}

/** Empty strings rather than undefined, so every input stays controlled. */
interface FormValues {
  fullName: string;
  dateOfBirth: string;
  pan: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
}

function toForm(data: PersonalData): FormValues {
  return {
    fullName: data.fullName ?? '',
    dateOfBirth: data.dateOfBirth ?? '',
    pan: data.pan ?? '',
    line1: data.address?.line1 ?? '',
    line2: data.address?.line2 ?? '',
    city: data.address?.city ?? '',
    state: data.address?.state ?? '',
    postalCode: data.address?.postalCode ?? '',
  };
}

/**
 * Works out what to send.
 *
 * Only changed fields go over the wire, because the audit log records which
 * fields were touched and re-sending everything on every save would claim the
 * customer edited their whole identity each time.
 *
 * The address is the exception and it matters: the server merges at the TOP
 * level only, so sending `{ address: { city } }` would replace the whole
 * address object and quietly discard the other lines. So if any part of the
 * address changed, the entire address goes.
 */
function changedOnly(values: FormValues, saved: PersonalData): PersonalData {
  const out: PersonalData = {};

  if (values.fullName !== (saved.fullName ?? '')) out.fullName = values.fullName;
  if (values.dateOfBirth !== (saved.dateOfBirth ?? '')) out.dateOfBirth = values.dateOfBirth;
  if (values.pan !== (saved.pan ?? '')) out.pan = values.pan;

  const before = saved.address ?? {};
  const addressChanged =
    values.line1 !== (before.line1 ?? '') ||
    values.line2 !== (before.line2 ?? '') ||
    values.city !== (before.city ?? '') ||
    values.state !== (before.state ?? '') ||
    values.postalCode !== (before.postalCode ?? '');

  if (addressChanged) {
    // The whole address, exactly as typed, blanks included. The server
    // replaces this key rather than merging into it, so sending a blank line
    // is how a customer clears one.
    out.address = {
      line1: values.line1,
      line2: values.line2,
      city: values.city,
      state: values.state,
      postalCode: values.postalCode,
    };
  }

  return out;
}

export function ApplicationForm({ application, onChanged }: Props) {
  const [values, setValues] = useState<FormValues>(toForm(application.personalData));
  const [saved, setSaved] = useState<PersonalData>(application.personalData);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [consentGiven, setConsentGiven] = useState(application.consentRecorded);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);

  const dirty = Object.keys(changedOnly(values, saved)).length > 0;

  function set(field: keyof FormValues) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((current) => ({ ...current, [field]: event.target.value }));
      setSavedAt(null);
    };
  }

  function handle(caught: unknown): void {
    if (caught instanceof ApiError) {
      const byField = caught.byField();
      setFieldErrors(byField);
      // Only show the sentence when there is nothing to attach to an input.
      setNotice(Object.keys(byField).length === 0 ? caught.message : null);
    } else {
      setFieldErrors({});
      setNotice('Could not reach the server. Check your connection and try again.');
    }
  }

  async function save(): Promise<Application | null> {
    const patch = changedOnly(values, saved);
    if (Object.keys(patch).length === 0) return application;

    const { application: updated } = await saveApplication(application.id, patch);
    setSaved(updated.personalData);
    setValues(toForm(updated.personalData));
    onChanged(updated);
    return updated;
  }

  async function onSave() {
    setBusy('save');
    setNotice(null);
    setFieldErrors({});
    try {
      await save();
      setSavedAt(new Date().toLocaleTimeString('en-GB'));
    } catch (caught) {
      handle(caught);
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit() {
    setBusy('submit');
    setNotice(null);
    setFieldErrors({});
    try {
      // Save first, so nothing typed but unsaved is lost when the application
      // becomes read-only.
      await save();

      /**
       * Try to submit BEFORE recording consent, and record it only if the
       * server says that is the one thing missing.
       *
       * The obvious order is the wrong one. Recording consent first means a
       * submission rejected for anything else (a missing date of birth, say)
       * still leaves a consent row behind for a submission that never
       * happened, and every retry adds another. consents is append-only, so
       * those rows could never be cleaned up: the table that exists to be
       * trustworthy evidence would fill with events that did not occur.
       *
       * The server checks completeness before it checks consent, so
       * CONSENT_REQUIRED can only mean everything else is already in order.
       */
      try {
        const { application: submitted } = await submitApplication(application.id);
        onChanged(submitted);
        return;
      } catch (firstAttempt) {
        const needsConsent =
          firstAttempt instanceof ApiError && firstAttempt.code === 'CONSENT_REQUIRED';
        if (!needsConsent) throw firstAttempt;
      }

      await recordConsent(application.id);
      const { application: submitted } = await submitApplication(application.id);
      onChanged(submitted);
    } catch (caught) {
      handle(caught);
    } finally {
      setBusy(null);
    }
  }

  function field(
    id: keyof FormValues,
    label: string,
    errorKey: string,
    extra: { type?: string; hint?: string; placeholder?: string; optional?: boolean } = {},
  ) {
    const error = fieldErrors[errorKey];
    return (
      <div className="field">
        <label htmlFor={id}>
          {label}
          {extra.optional && <span style={{ color: 'var(--ink-faint)' }}> (optional)</span>}
        </label>
        <input
          id={id}
          type={extra.type ?? 'text'}
          value={values[id]}
          onChange={set(id)}
          placeholder={extra.placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          style={error ? { borderColor: 'var(--fail)' } : undefined}
        />
        {error ? (
          <p id={`${id}-error`} className="hint" style={{ color: 'var(--fail)' }}>
            {label} {error}
          </p>
        ) : (
          extra.hint && <p className="hint">{extra.hint}</p>
        )}
      </div>
    );
  }

  return (
    <>
      {notice && (
        <div className="notice notice-error" role="alert">
          {notice}
        </div>
      )}

      {Object.keys(fieldErrors).length > 0 && (
        <div className="notice notice-error" role="alert">
          Some details need attention. See the highlighted boxes below.
        </div>
      )}

      <div className="card">
        <h2>Your details</h2>
        <p style={{ color: 'var(--ink-muted)', marginTop: -6 }}>
          You can save and come back at any time. Nothing is checked until you submit.
        </p>

        {field('fullName', 'Full name', 'fullName', {
          hint: 'As it appears on your PAN card.',
        })}

        <div className="row-2">
          {field('dateOfBirth', 'Date of birth', 'dateOfBirth', { type: 'date' })}
          {field('pan', 'PAN', 'pan', {
            placeholder: 'ABCDE1234F',
            hint: 'Ten characters, as printed on your PAN card.',
          })}
        </div>
      </div>

      <div className="card">
        <h2>Your address</h2>
        {field('line1', 'Address line 1', 'address.line1')}
        {field('line2', 'Address line 2', 'address.line2', { optional: true })}
        <div className="row-2">
          {field('city', 'City', 'address.city')}
          {field('state', 'State', 'address.state')}
        </div>
        {field('postalCode', 'PIN code', 'address.postalCode', {
          placeholder: '682020',
          hint: 'Six digits.',
        })}

        <div className="actions">
          <button type="button" className="secondary" onClick={onSave} disabled={busy !== null || !dirty}>
            {busy === 'save' ? 'Saving…' : 'Save progress'}
          </button>
          {savedAt && (
            <span style={{ fontSize: 13, color: 'var(--pass)' }}>Saved at {savedAt}</span>
          )}
          {!savedAt && dirty && (
            <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>Unsaved changes</span>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Consent and submit</h2>

        {application.consentRecorded ? (
          <div className="notice notice-muted">
            Consent has already been recorded for this application.
          </div>
        ) : (
          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              fontWeight: 400,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={(e) => setConsentGiven(e.target.checked)}
              style={{ width: 'auto', marginTop: 3 }}
            />
            <span>
              I confirm the details above are mine and are correct, and I consent to them
              being verified against official records for the purpose of opening an account.
            </span>
          </label>
        )}

        <p className="hint" style={{ marginTop: 14 }}>
          Once submitted, an application cannot be changed. Your consent is recorded with
          the date and time and cannot be edited afterwards.
        </p>

        <div className="actions">
          <button type="button" onClick={onSubmit} disabled={busy !== null || !consentGiven}>
            {busy === 'submit' ? 'Submitting…' : 'Submit application'}
          </button>
        </div>
      </div>
    </>
  );
}
