'use client';

/**
 * The only place this app talks to the API.
 *
 * Requests go to a relative path, never to http://localhost:4000. Next.js
 * rewrites them to the API server, so as far as the browser is concerned this
 * is a same-origin request and the session cookie is first-party — which is
 * what lets the cookie stay SameSite=Lax (ADR-005).
 */

export interface FieldError {
  /** Dotted path, e.g. "pan" or "address.postalCode". */
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Present on a validation or completeness failure. */
    readonly fields: readonly FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Field errors keyed by input name, with the request-body prefix removed.
   *
   * An edit sends `{ personalData: {...} }` so the server reports
   * "personalData.pan", while the completeness check at submit runs against the
   * stored object and reports plain "pan". Stripping the prefix lets the form
   * look up one key either way.
   */
  byField(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const item of this.fields) {
      const key = item.field.replace(/^personalData\./, '');
      if (!out[key]) out[key] = item.message;
    }
    return out;
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
      body?.error?.fields ?? [],
    );
  }

  return body as T;
}

// ------------------------------------------------------------------- auth

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

// ----------------------------------------------------------- applications

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'verifying'
  | 'verification_pending'
  | 'review'
  | 'verified'
  | 'rejected';

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

/** Any subset is valid while the application is a draft. */
export interface PersonalData {
  fullName?: string;
  dateOfBirth?: string;
  pan?: string;
  address?: Address;
}

export interface Application {
  id: string;
  status: ApplicationStatus;
  personalData: PersonalData;
  consentRecorded: boolean;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listApplications(): Promise<{ applications: Application[] }> {
  return api<{ applications: Application[] }>('/api/applications/me');
}

export function createApplication(): Promise<{ application: Application }> {
  return api<{ application: Application }>('/api/applications', { method: 'POST' });
}

/** Sends only the fields being changed. The server merges them. */
export function saveApplication(
  id: string,
  personalData: PersonalData,
): Promise<{ application: Application }> {
  return api<{ application: Application }>(`/api/applications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ personalData }),
  });
}

export function recordConsent(id: string): Promise<{ application: Application }> {
  return api<{ application: Application }>(`/api/applications/${id}/consent`, {
    method: 'POST',
  });
}

export function submitApplication(id: string): Promise<{ application: Application }> {
  return api<{ application: Application }>(`/api/applications/${id}/submit`, {
    method: 'POST',
  });
}
