'use client';

/**
 * The only place this app talks to the API.
 *
 * Requests go to a relative path, never to http://localhost:4000. Next.js
 * rewrites them to the API server, so as far as the browser is concerned this
 * is a same-origin request and the session cookie is first-party — which is
 * what lets the cookie stay SameSite=Lax (ADR-005).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);

  if (UNSAFE.has(method)) {
    // Echo the readable CSRF cookie back in a header. A cross-site attacker
    // can cause the browser to send the cookie but cannot read it, so cannot
    // set this header (ADR-006).
    const csrf = readCookie('kyc_csrf');
    if (csrf) headers.set('x-csrf-token', csrf);
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }

  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'Something went wrong. Please try again.',
    );
  }

  return body as T;
}

export type Role = 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

export function getMe(): Promise<{ user: SessionUser }> {
  return api<{ user: SessionUser }>('/api/auth/me');
}

export function login(email: string, password: string): Promise<{ user: SessionUser }> {
  return api<{ user: SessionUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function register(email: string, password: string): Promise<{ status: string }> {
  return api<{ status: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function logout(): Promise<void> {
  return api<void>('/api/auth/logout', { method: 'POST' });
}
