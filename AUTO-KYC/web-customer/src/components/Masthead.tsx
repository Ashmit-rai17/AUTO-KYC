'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { logout } from '@/lib/api';
import type { Session } from '@/lib/session';

export function Masthead({ session }: { session: Session }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setLeaving(true);
    try {
      await logout();
    } catch {
      // Already gone as far as the server is concerned; either way the right
      // thing to do next is send them to the sign-in page.
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="masthead">
      <div className="masthead-inner">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">K</span>
          KYCFlow
        </a>
        <span className="brand-surface">Customer</span>
        <div className="masthead-spacer" />
        {session.status === 'signed-in' && (
          <div className="masthead-user">
            <span>{session.user.email}</span>
            <button className="ghost" onClick={signOut} disabled={leaving}>
              {leaving ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
