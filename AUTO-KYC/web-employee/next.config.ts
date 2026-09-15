import type { NextConfig } from 'next';

/**
 * The whole reason this proxy exists (ADR-005).
 *
 * The browser only ever talks to this origin. Requests to /api/* are rewritten
 * to the API server, so the session cookie is first-party and SameSite=Lax
 * holds. Without it the front end would be making cross-origin credentialed
 * requests, which would force SameSite=None, HTTPS in development, and a CORS
 * policy — three things this design deliberately does not have.
 */
const nextConfig: NextConfig = {
  async rewrites() {
    // Trailing slashes are stripped deliberately. A destination built from
    // "https://host/" yields "https://host//api/:path*", and that double
    // slash matches no route — the API answers its own 404 and the failure
    // reads as "Resource not found" with nothing pointing at the real cause.
    // It cost one deployment; an origin is a host, so normalise it here.
    const api = (process.env.API_ORIGIN ?? 'http://localhost:4000').replace(/\/+$/, '');
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
