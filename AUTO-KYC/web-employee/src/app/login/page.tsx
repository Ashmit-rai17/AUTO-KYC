'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, login } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const { user } = await login(email, password);

      // A customer's credentials are valid here — same API, same session — so
      // the check is on ROLE, not on whether the sign-in worked. Sending them
      // to a queue they cannot read would produce a wall of 403s instead of
      // one clear sentence.
      if (user.role === 'CUSTOMER') {
        setError('This sign-in is for staff. Customers should use the customer app.');
        setBusy(false);
        return;
      }

      router.replace('/queue');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not reach the server. Check your connection and try again.',
      );
      setBusy(false);
    }
  }

  return (
    <main className="narrow">
      <div className="page-head" style={{ marginTop: 48 }}>
        <h1>Staff sign-in</h1>
        <p className="lede">Review queue for account applications.</p>
      </div>

      <div className="card">
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Work email</label>
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="actions">
            <button type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>

      <p className="hint" style={{ marginTop: 16, textAlign: 'center' }}>
        Staff accounts are created by an administrator. There is no self-registration.
      </p>
    </main>
  );
}
