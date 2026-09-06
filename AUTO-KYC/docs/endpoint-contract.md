# KYCFlow — Endpoint Contract (M0 target set)

## Auth model
- Email + password, hashed with argon2id (ADR-005). Server-side sessions in
  PostgreSQL — NOT JWT (instant revocation for KYC). Token = 32 random bytes;
  only its SHA-256 hash is stored. Cookie: kyc_session, HttpOnly,
  SameSite=Lax, Secure outside development, 8h expiry.
  Roles: CUSTOMER | EMPLOYEE | ADMIN.
- A session is live only while it is unexpired, unrevoked AND its user is
  still active, so suspending an account takes effect on the next request.
- No CORS. Front ends reach the API through a same-origin path proxied by
  Next.js rewrites, so no cross-origin credentialed request is ever needed
  or permitted.

## Deliberate vagueness
Every login failure returns the SAME 401 and the same message, whether the
password was wrong, the address unknown, or the account suspended — and the
same hashing work is spent either way, so the response time does not give away
what the message withholds.

Registration answers 202 { status: "accepted" } in every case, including an
address that is already registered: same status, same body, same timing
(ADR-006). It is therefore not possible to learn from this API whether a given
person banks here. Nothing is written to an existing account, so re-registering
someone else's address cannot alter their row.

Validation errors DO name the offending field. That is not a contradiction of
invariant 9: telling a caller their password is too short reveals nothing
about anyone else, and withholding it would make the form unusable.

## Rate limiting and CSRF (ADR-006)
- Every response may be 429 { error: { code: "RATE_LIMITED" } }. Credential
  routes are limited strictly, everything else generously.
- Any state-changing request (POST/PUT/PATCH/DELETE) that carries a session
  cookie must also send `x-csrf-token` matching the readable `kyc_csrf` cookie
  issued at login. Without it the answer is 403 CSRF_FAILED, and the session
  remains valid — a failed check must not log the victim out.
- Requests with no session cookie are exempt, which is why login and register
  need no special case.

## Conventions
- All routes under /api. JSON in/out. Errors: { error: { code, message } }.
- Auth = [C]ustomer | [E]mployee | [A]dmin | [S]ystem worker.
- Every route marked ✅ passes the 5-step security checklist.

## Auth
| Method & path | Roles | Extra check | Purpose |
|---|---|---|---|
| POST /api/auth/register | public | none | create CUSTOMER; always 202, never reveals a taken address ✅ |
| POST /api/auth/login | public | none | set session cookie ✅ |
| POST /api/auth/logout | any | session | destroy session ✅ |
| GET /api/auth/me | any | session | current user + role ✅ |

## Applications (customer owns their own)
| POST /api/applications | C | ownership=creator | create app (draft) ✅ |
| GET /api/applications/me | C | session | list own apps ✅ |
| GET /api/applications/:id | C | owner | view own app ✅ |
| PATCH /api/applications/:id | C | owner + state=draft | edit data ✅ |
| POST /api/applications/:id/consent | C | owner + draft | record consent ✅ |
| POST /api/applications/:id/submit | C | owner + draft + consent | submit → VERIFYING ✅ |

## Documents
| POST /api/applications/:id/document-upload-url | C | owner | signed PUT url (10 min, one key) ✅ |
| GET /api/documents/:id/url | E | case-access | signed GET url (60 s) ✅ |

## Cases (employees)
| GET /api/cases | E/A | role | list assigned/reviewable cases ✅ |
| GET /api/cases/:id | E/A | case-access | case + checks + reasons ✅ |
| POST /api/cases/:id/resolution | E/A | case-access | approve/reject/request-info + reason ✅ |

## Notifications
| GET /api/notifications | C/E | session | status messages (soft copy) ✅ |

## Admin
| POST /api/admin/employees | A | role | create employee (never self-register) ✅ |

## Operational
| Method & path | Roles | Extra check | Purpose |
|---|---|---|---|
| GET /api/health | public | none | liveness; deliberately does NOT touch PostgreSQL |
| GET /api/health/ready | public | none | readiness; 200 when the database answers, else 503 |

The only routes exempt from the 5-step security checklist: they carry no
customer data and expose no state beyond up/down. Liveness avoids the database
on purpose, so a brief outage does not make an orchestrator restart a healthy
API.

## Internal (worker, no external route)
- Verification runner: collects evidence, runs checks, writes
  verification_checks rows, routes to PASS or case creation.
