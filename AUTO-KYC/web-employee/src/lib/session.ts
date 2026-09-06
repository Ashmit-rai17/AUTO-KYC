'use client';

import { useEffect, useState } from 'react';
import { getMe, type SessionUser } from './api';

export type Session =
  | { status: 'loading' }
  | { status: 'signed-in'; user: SessionUser }
  | { status: 'signed-out' };

/**
 * Asks the API who is calling.
 *
 * There is no client-side token to inspect and no decoded claim to trust: the
 * session lives in PostgreSQL and the cookie is httpOnly, so the only way to
 * know is to ask. That is the cost ADR-001 accepted in exchange for being able
 * to revoke a session instantly — and it means the front end can never believe
 * it is signed in after the server has decided otherwise.
 */
export function useSession(): Session {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  useEffect(() => {
    let live = true;

    getMe()
      .then(({ user }) => {
        if (live) setSession({ status: 'signed-in', user });
      })
      .catch(() => {
        if (live) setSession({ status: 'signed-out' });
      });

    return () => {
      live = false;
    };
  }, []);

  return session;
}
