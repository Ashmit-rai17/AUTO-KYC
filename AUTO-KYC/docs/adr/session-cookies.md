# ADR Log

| ADR | Decision | Status |
|---|---|---|
| 001 | Server-side sessions over JWT | Accepted |
| 002 | TypeScript + Express 5 + raw pg for the M0 API | Accepted |
| 003 | UUID keys, CHECK'd status text, trigger-enforced append-only | Accepted |

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

---
# ADR-003: Schema shape and how append-only is enforced
Date: 2026-09-06
Context: docs/db-schema.md lists the tables but leaves the key type, the way
status columns are constrained, and the mechanism behind "append-only"
unspecified. It also gives applications a consent_id without defining a
consents table anywhere.
Decision:
- UUID primary keys via gen_random_uuid(). Application ids appear in
  customer-facing URLs; sequential integers would let a customer count and
  probe other people's applications, which is the same enumeration concern
  behind invariant 9.
- status columns are TEXT with a CHECK constraint rather than PostgreSQL
  enums. docs/rules-engine.md expects the state machine to grow; a CHECK can
  be altered in a migration, whereas an enum value cannot be removed or
  renamed without pain.
- Append-only is enforced by a BEFORE UPDATE OR DELETE trigger that RAISEs,
  plus a separate BEFORE TRUNCATE statement trigger. Two reasons for choosing
  triggers over revoked privileges: a trigger fires for the table owner too,
  and TRUNCATE never fires a row-level trigger, so without the statement
  trigger a single command could erase the audit trail. Revoking privileges
  from a dedicated application role is still worth adding later as defence in
  depth; it is not a substitute.
- A consents table is added, and it is append-only. The PRD requires consent
  be explicit and recorded with timestamp and metadata; a consent record that
  can be edited afterwards is worthless as evidence of what was agreed.
- Check names follow docs/rules-engine.md (name_match, dob_match,
  address_match) rather than the shorter forms in docs/db-schema.md, which
  have been corrected to match.
Consequences: + the guarantees the PRD promises regulators are database facts
rather than conventions, and are covered by integration tests;
- integration tests need a live PostgreSQL, so they are a separate
`npm run test:integration` and `npm test` stays runnable anywhere;
- TRUNCATE on consents is actually refused by its foreign key before the
trigger is reached. Protected either way, but by two different mechanisms.
