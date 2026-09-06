export const ROLES = ['CUSTOMER', 'EMPLOYEE', 'ADMIN'] as const;

export type Role = (typeof ROLES)[number];

/** Who is making the current request, once the session cookie has been resolved. */
export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  sessionId: string;
}
