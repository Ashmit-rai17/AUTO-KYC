# ADR Log

| ADR | Decision | Status |
|---|---|---|
| 001 | Server-side sessions over JWT | Accepted |
| 002 | TypeScript + Express 5 + raw pg for the M0 API | Accepted |

Format: context → decision → consequences. Append new ADRs; never edit an
accepted one (supersede instead).

---
# ADR-001: Server-side sessions over JWT
Date: 2026-09-05
Context: KYC demands instantly revoking access (compromised/fired employee).
JWT is stateless and can't be killed without extra revocation machinery.
Decision: PostgreSQL sessions table; HttpOnly cookie holding a token whose
SHA-256 hash is stored server-side. Delete the row = revoke instantly.
Consequences: + revocation, + simple security model. − one DB lookup per
request; − CORS/cookie handling for separate frontend origins (Next.js
rewrite proxy solves this in dev).

---
# ADR-002: M0 stack and repository layout
Date: 2026-09-06
Context: AGENTS.md already fixes Node.js, PostgreSQL, Next.js and the npm
script names (`npm test`, `npm run db:migrate`, `npm run lint`), but leaves
the API framework, database client, migration tool, test runner and folder
layout open. M0 cannot start until those are settled, and AGENTS.md requires
an ADR before any cross-cutting change.
Decision:
- TypeScript, ES modules, Node >= 20.11. Types make the provider interfaces in
  docs/provider-adapters.md enforceable rather than aspirational.
- Express 5 for the API, chosen over Fastify for familiarity and weight of
  documentation. This is a two-person project; the code has to stay readable
  to whoever picks it up next.
- `pg` used directly, no ORM. docs/db-schema.md is written as SQL, and the
  append-only guarantee on audit_log has to be enforced in the database. An
  ORM would hide precisely the layer that matters here.
- `node-pg-migrate` for migrations, wired to `npm run db:migrate`.
- Vitest for tests, supertest for HTTP-level assertions.
- ESLint flat config with typescript-eslint.
- Zod for both environment and request validation — step 4 of the security
  checklist needs a schema layer, and one library should serve both.
- npm workspaces: `api/` today, `web-customer/` and `web-employee/` at M5.
- Dependencies are passed into `createApp()` rather than imported as module
  singletons, so routes can be tested without a live database.
Consequences: + every gate in the definition of done is wired from the first
commit; + raw SQL keeps the "PostgreSQL stores facts" model visible;
- more hand-written query code than an ORM would need; - TypeScript 7 was
available and deliberately not adopted, being a native rewrite too new to
found a KYC codebase on. Revisit after M2.
