# KYCFlow

Automated KYC and account opening. A customer submits a form and identity documents;
the backend gathers evidence from OCR and authorised providers; a deterministic rules
engine turns that evidence into explainable per-check decisions; only exceptions reach
a human review queue. Every action is audited.

> **Status — M0 in progress.** Scaffold, database schema and authentication are
> done: all ten tables exist, `audit_log` is append-only at the database level,
> sessions revoke instantly, credential routes are rate limited, state-changing
> requests carry a CSRF token, and 82 tests pass. Applications are next.

## The idea the whole design rests on

**OCR and ML produce evidence. The rules engine produces decisions.**

OCR says *"I read 'Priya Naîr', confidence 61%"*. It never says *approved*. A rule says
*"PAN valid AND name similarity ≥ 0.95 → PASS, reason: application and verified info
match"*. There is no opaque `risk = 73` score anywhere, and every outcome carries a
human-readable reason a regulator can read.

## How a request flows

```
   Customer App (:3000)        Employee Dashboard (:3001)
              \                        /
        HTTPS + HttpOnly session cookie (SameSite=Lax)
                        \      /
                  Node.js API (:4000)
    every route: authenticate -> authorise -> ownership
                 -> validate -> audit
                        |
   PostgreSQL     Object storage      OCR         PAN
   (facts +       (private bucket,   (adapter,   (adapter,
    append-only    signed URLs)       mock 1st)   mock 1st)
    audit_log)
```

1. Customer creates an application, records consent, submits.
2. A worker runs OCR, calls the PAN provider, normalises and matches.
3. The rules engine emits one result per check.
4. All `PASS` → auto-verified, no human involved. Anything else → a review case with
   the failing checks and their reasons attached.
5. An employee resolves the case. Every state change writes an `audit_log` row.

## Check results

| Result | Meaning |
| --- | --- |
| `PASS` | Evidence is clean. |
| `REVIEW` | Needs human judgement — e.g. a fuzzy name match after an OCR typo. |
| `FAIL` | Deterministic mismatch against authoritative data, e.g. PAN not found. |
| `NOT_AVAILABLE` | Provider outage. The application parks; this is never the customer's fault. |

`NOT_AVAILABLE` is deliberately distinct from `FAIL`. A provider being down is not the
same answer as a provider saying *not found*, and the customer should never be penalised
for the first. The system never auto-rejects on an ambiguous signal — a human does.

## Running it locally

Needs Node 20.11+ and Docker for PostgreSQL.

```bash
cd AUTO-KYC
cp .env.example .env
npm install
npm run db:up
npm run dev
```

The API comes up on `http://localhost:4000`:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/health/ready
```

| Command | Does |
| --- | --- |
| `npm test` | Vitest suite |
| `npm run typecheck` | TypeScript across `src` and `test` |
| `npm run lint` | ESLint |
| `npm run build` | Compile to `api/dist` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:up` / `npm run db:down` | Start / stop PostgreSQL |
| `npm run test:integration` | Schema tests against a real PostgreSQL |

`npm test` never touches the database, so it runs anywhere. The integration
suite does, and needs `npm run db:up && npm run db:migrate` first.

## Documentation

Start with [`AGENTS.md`](AUTO-KYC/AGENTS.md). It carries the invariants that the rest of
the design is not allowed to violate.

| Document | Covers |
| --- | --- |
| [AGENTS.md](AUTO-KYC/AGENTS.md) | Invariants, security checklist, working protocol |
| [context.md](AUTO-KYC/docs/context.md) | Overview and actors |
| [prd.md](AUTO-KYC/docs/prd.md) | Requirements and MVP scope |
| [architecture.md](AUTO-KYC/docs/architecture.md) | Services, boundaries, request trace |
| [endpoint-contract.md](AUTO-KYC/docs/endpoint-contract.md) | Every route with its role and ownership check |
| [db-schema.md](AUTO-KYC/docs/db-schema.md) | Tables, mutability rules, indexes |
| [rules-engine.md](AUTO-KYC/docs/rules-engine.md) | Evidence to decision pipeline |
| [provider-adapters.md](AUTO-KYC/docs/provider-adapters.md) | PAN, OCR and storage interfaces |
| [milestones.md](AUTO-KYC/docs/milestones.md) | M0 to M5 |
| [adr/](AUTO-KYC/docs/adr/) | Decision records |

## Security posture

- The API is the only door. Browsers never reach PostgreSQL or object storage directly.
- Document bytes live in object storage; PostgreSQL stores metadata and a storage key.
- Signed URLs are minted by the backend only: short-lived, one purpose, one user.
- Sessions are rows in PostgreSQL, not JWTs, so access can be revoked instantly
  ([ADR-001](AUTO-KYC/docs/adr/session-cookies.md)). The cookie holds a token; only its
  SHA-256 hash is stored.
- `audit_log` is append-only — INSERT only, enforced at the database.
- Customer-facing messages are vague on purpose. Field-level failure detail would turn
  the status endpoint into an enumeration oracle.
- Every external provider sits behind an adapter. Development runs against deterministic
  mocks, so the decision paths can be tested offline.

## Roadmap

| | Milestone | |
| --- | --- | --- |
| **M0** | Walking skeleton | Mock providers, no uploads. Register through to employee resolution, proven with tests before any UI. |
| **M1** | Hardening | Async worker, retry and backoff, idempotent runs, enforced state machine. |
| **M2** | Documents | Object storage, signed upload and download, `doc_quality` check. |
| **M3** | OCR and matching | Extraction, normalisation, deterministic then fuzzy matching tiers. |
| **M4** | Configurable rules | Rules from config rather than code, admin employee management. |
| **M5** | UI | Customer app and employee dashboard, hardened error copy. |

## Stack

TypeScript on Node 20.11+ · Express 5 · PostgreSQL via `pg`, no ORM ·
node-pg-migrate · Vitest · Zod. Customer and employee front ends (Next.js) and
S3-compatible object storage (Backblaze B2) arrive at M5 and M2 respectively.

The reasoning is in [ADR-002](AUTO-KYC/docs/adr/session-cookies.md).
