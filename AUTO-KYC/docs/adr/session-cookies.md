# ADR Log

| ADR | Decision | Status |
|---|---|---|
| 001 | Server-side sessions over JWT | Accepted |
| 002 | TypeScript + Express 5 + raw pg for the M0 API | Accepted |
| 003 | UUID keys, CHECK'd status text, trigger-enforced append-only | Accepted |
| 004 | Providers are contract simulators; Aadhaar signature path is real | Accepted |

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

---
# ADR-004: Provider simulation for the bank demonstration
Date: 2026-09-06
Context: this system is being shown to a bank before any provider licence
exists. Neither UIDAI nor the Income Tax Department can be called directly:
PAN verification runs through Protean/NSDL and is restricted to eligible
regulated entities, and Aadhaar authentication requires AUA/KUA licensing that
a private project cannot obtain (Section 57 of the Aadhaar Act was struck down
in Puttaswamy, 2018; the 2019 amendment reopened only a narrow permitted
path). The demonstration therefore has to show what WILL happen once the
permissions land, without pretending the permissions already exist.
Decision:
- Mocks are SIMULATORS OF THE CONTRACT, not stubs. A stub returning
  {valid:true} in zero milliseconds hides the very architecture being
  demonstrated: the async worker, the verifying state, retry and backoff, and
  the difference between an outage and a refusal.
- Each mock reproduces the real provider's response envelope, a realistic
  latency (default ~1.2s with jitter, configurable), and the full failure
  taxonomy: timeout, 5xx, rate-limited, and a genuine not-found.
- Outcomes are reachable three ways: a fixture registry of named personas so a
  demonstration is repeatable; a deterministic fallback derived from the input
  so any value a bank officer types produces a stable, explainable result
  instead of an error; and a runtime fault switch so an outage can be
  triggered live, mid-demonstration, without editing fixtures.
- Every verification_checks row records provenance in evidence:
  { provider: { name, mode: mock|real, request_id, latency_ms } }.
  Two reasons: a bank's auditors will ask how they can tell a result was not
  fabricated, and a mock result must never be mistakable for a real one.
- The API refuses to start with any mock provider when NODE_ENV=production,
  unless ALLOW_MOCK_PROVIDERS_IN_PROD is explicitly set.
- The PAN adapter handles BOTH real-world response shapes. Some Protean modes
  return the official name for us to compare; others accept a submitted name
  and return only match/no-match. Where only a boolean comes back there is no
  similarity score, so docs/rules-engine.md cannot assume one is always
  available.
- The Aadhaar offline e-KYC path is built FOR REAL, not simulated. UIDAI
  Paperless Offline e-KYC is a signed XML document; verifying it means
  checking an XML digital signature against a trust anchor. That code is
  identical in production - only the certificate changes. Fixtures are signed
  with a self-signed test key; production points at the UIDAI certificate.
  This is the one place where the demonstration runs genuine production code,
  and it is honest to say so in the room.
Verified by spike before accepting this ADR (xml-crypto 6.1.2 with
@xmldom/xmldom 0.9.12, RSA-SHA256, enveloped signature): a UIDAI-shaped
document signs and verifies against the correct anchor; a document whose name
field is altered is rejected; a document checked against a different anchor is
rejected. One trap found, worth writing down: xml-crypto RETURNS false on a
digest mismatch but THROWS on a signature-value mismatch, so an adapter that
only inspects the return value turns a forged document into a 500 instead of a
FAIL. Both paths must be caught.
Consequences: + the demonstration shows the real process, and the seam is
genuinely one implementation plus environment variables;
+ the Aadhaar path needs no licence and is stronger evidence than any mock;
- the simulator is more code than a stub, and its fixtures need maintaining;
- UIDAI ships the offline e-KYC XML inside a share-code-protected ZIP.
Accepting raw XML is enough for the demonstration; ZIP extraction waits for
M2 and has NOT been proven yet.
