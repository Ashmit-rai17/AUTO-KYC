'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/lib/session';

export default function Home() {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === 'signed-in') router.replace('/application');
    if (session.status === 'signed-out') router.replace('/login');
  }, [session.status, router]);

  return (
    <main className="narrow">
      <div className="empty">
        <span className="spinner" aria-hidden="true" />
        <p style={{ marginTop: 12 }}>Checking your session…</p>
      </div>
    </main>
  );
}
