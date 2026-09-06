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
      await login(email, password);
      router.replace('/application');
    } catch (caught) {
      // Whatever the server said is what the customer sees. The API returns
      // one identical message for a wrong password, an unknown address and a
      // suspended account, and the UI must not helpfully guess between them.
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
        <h1>Sign in</h1>
        <p className="lede">Continue your account application.</p>
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
            <span style={{ fontSize: 13 }}>
              No account? <a href="/register">Create one</a>
            </span>
          </div>
        </form>
      </div>
    </main>
  );
}
