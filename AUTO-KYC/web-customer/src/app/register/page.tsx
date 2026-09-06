'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, register } from '@/lib/api';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await register(email, password);
      setAccepted(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (accepted) {
    return (
      <main className="narrow">
        <div className="page-head" style={{ marginTop: 48 }}>
          <h1>Thanks</h1>
        </div>
        <div className="card">
          {/*
            Careful with this copy. The API answers 202 whether or not the
            address was already registered, precisely so that nobody can learn
            who banks here (ADR-006). Saying "account created" would put that
            back — the page would be asserting something the server
            deliberately declined to tell it. So it says only what is true in
            both cases.
          */}
          <p style={{ marginTop: 0 }}>
            Your details have been accepted. Sign in to continue your application.
          </p>
          <div className="actions">
            <a href="/login">
              <button type="button">Go to sign in</button>
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="narrow">
      <div className="page-head" style={{ marginTop: 48 }}>
        <h1>Create an account</h1>
        <p className="lede">This takes a minute. You will need your PAN and an address proof later.</p>
      </div>

      <div className="card">
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="hint">At least 12 characters. Length matters more than symbols.</p>
          </div>

          <div className="actions">
            <button type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
            <span style={{ fontSize: 13 }}>
              Already registered? <a href="/login">Sign in</a>
            </span>
          </div>
        </form>
      </div>
    </main>
  );
}
