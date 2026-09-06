# Build log

One entry per slice, newest at the bottom. Record **why**, not just what —
the diff already records what. Never rewrite an existing entry; append a
correcting entry instead.

## Template

### YYYY-MM-DD — <slice name>
**What:** one or two lines.
**Why:** the reasoning that is not visible in the diff.
**Decisions:** anything that should become an ADR, or "none".
**Docs touched:** endpoint-contract / db-schema / provider-adapters / none.
**Tests:** what proves this slice works.

---

### 2026-09-06 — Repository documentation
**What:** Added the project README, replacing a 2-byte placeholder, and
repointed 11 broken references across AGENTS.md, architecture.md,
db-schema.md, milestones.md and provider-adapters.md.
**Why:** the docs referred to each other by numeric prefix
(docs/00-context.md, docs/03, docs/06) but the files on disk are unnumbered,
so every one of those paths was dead. AGENTS.md tells each session that docs
are the source of truth and then handed out paths that do not resolve — the
first lookup of a session would fail.
**Decisions:** none. Documentation only; no design decision was changed.
**Docs touched:** AGENTS.md, architecture, db-schema, milestones,
provider-adapters.
**Tests:** not applicable, no code yet.

### 2026-09-06 — Session memory scaffold
**What:** Created .memory/current-milestone.md and .memory/build-log.md, and
filled the unset `Date: <today>` placeholder in ADR-001.
**Why:** AGENTS.md mandates reading current-milestone.md at every session
start and appending here after every slice, but neither file existed, so the
session protocol could not actually be followed as written.
**Decisions:** none.
**Docs touched:** docs/adr/session-cookies.md (date only).
**Tests:** not applicable, no code yet.

### 2026-09-06 — M0 slice 1: scaffold
**What:** npm workspace with an `api/` package. TypeScript (ESM, strict),
Express 5, `pg`, Zod, node-pg-migrate, Vitest + supertest, ESLint flat config,
Docker PostgreSQL, and liveness / readiness probes.
**Why:** M0 could not begin while the framework, database client, migration
tool and test runner were undecided. Wiring every gate in the definition of
done (`npm test`, `npm run lint`, `npm run db:migrate`) from the first commit
means later slices cannot quietly skip them.
**Decisions:** ADR-002. Notably: raw `pg` over an ORM, because audit_log's
append-only guarantee belongs in the database and an ORM would hide that
layer; and TypeScript 5.9 rather than the newly released TypeScript 7, which
is a native rewrite and too new to found this on.
**Docs touched:** endpoint-contract (operational routes), adr (ADR-002).
**Tests:** 10 passing. Config defaults and validation, including a test that a
config error names the offending KEY without echoing its VALUE — invariant 8
is a rule that can rot silently, so it is pinned by a test. Health liveness
asserts the database is never queried; readiness covers both up and down.
**Verified:** install, typecheck, lint, build, and the compiled server
answering all three routes over HTTP.

### 2026-09-06 — M0 slice 2: database schema
**What:** One migration creating all ten tables from docs/db-schema.md, plus a
consents table that the docs referenced but never defined. Append-only
enforcement, an updated_at trigger, and 25 integration tests run against a real
PostgreSQL.
**Why:** the append-only promise on audit_log is the one this project makes to
regulators, so it had to become a database fact rather than a convention that
application code is trusted to honour.
**Decisions:** ADR-003. UUID keys (a sequential id in a customer-facing URL is
an enumeration oracle, same concern as invariant 9); TEXT + CHECK over enums
(the state machine will grow); triggers over REVOKE (a trigger fires for the
table owner, a REVOKE does not).
**Docs touched:** db-schema (consents table, corrected check names, decisions
section), adr (ADR-003).
**Tests:** 25 integration + the existing 10 unit. Verified up, down, and up
again; the rollback leaves no orphan functions.
**Worth remembering — three things the tests caught that review would not:**
1. UPDATE and DELETE against an EMPTY table match no rows, so a row trigger
   never fires and the statement succeeds. The first version of the
   append-only tests passed for that entirely wrong reason until the tables
   were seeded.
2. TRUNCATE never fires a row-level trigger. Without the separate statement
   trigger, one command would have erased the audit trail with no error.
3. TRUNCATE on consents is refused by its foreign key BEFORE the trigger is
   reached, so that table is protected by two mechanisms and reports a
   different error than the other two.

### 2026-09-06 - ADR-004: how providers get simulated
**What:** No code. Recorded how the provider layer behaves for a bank
demonstration, and updated docs/provider-adapters.md with the Aadhaar adapter,
the two PAN response shapes, and the provenance envelope.
**Why:** the audience changed the requirement. This is shown to a bank before
any licence exists, so the mocks have to demonstrate the real process rather
than return canned answers. Settling it now means the provider interface and
the evidence shape are not retrofitted later around whatever was convenient.
**Decisions:** ADR-004. Mocks simulate the contract - envelope, ~1.2s latency,
full failure taxonomy - because a zero-millisecond {valid:true} hides the async
worker and the outage handling, which is the part a bank actually buys. Every
check row stamps provider mode, and the API refuses to boot with mocks under
NODE_ENV=production, so a simulated result can never be mistaken for a real
one.
**Docs touched:** adr (ADR-004), provider-adapters.
**Tests:** none - documentation only.
**Spiked before accepting:** proved the Aadhaar offline e-KYC signature path
works in Node (xml-crypto 6.1.2, RSA-SHA256, enveloped): signs and verifies
against the right anchor, rejects an altered name, rejects a different anchor.
Trap found: xml-crypto RETURNS false on a digest mismatch but THROWS on a
signature-value mismatch - catch both or a forged document becomes a 500
instead of a FAIL. Worth the detour: the ADR now claims only what was actually
observed. Still unproven, and flagged as such: extracting the XML from UIDAI's
share-code-protected ZIP.

### 2026-09-06 - Re-pointed the PRD and the plan at the bank demonstration
**What:** Rewrote docs/prd.md and docs/milestones.md. Added invariant 10 to
AGENTS.md and widened invariant 7 to cover Aadhaar; refreshed the commands
line, which had gone stale after the integration-test split.
**Why:** the PRD still read as a portfolio build - "mock providers first, real
ones later" - which is now actively misleading. The bank is the eligible
entity, not us. It can hold Protean/NSDL PAN access and can be licensed
AUA/KUA, so the seam is "when the bank's credentials are configured", not
"when we get permissions". That is a smaller and far more defensible claim,
and the docs need to say it because it is what the demonstration argues.
**Decisions:** no new ADR - this records the consequences of ADR-004 rather
than deciding anything new. Two structural changes to the plan: provider
simulation promoted into M1 next to the async worker, because a simulator's
latency and failure taxonomy are meaningless without something orchestrating
retries; and the employee dashboard pulled from M5 to M3, because the review
queue and audit trail ARE the demonstration and finishing the UI last would
leave nothing to show.
**Docs touched:** prd, milestones, AGENTS.
**Tests:** none - documentation only.
**Also recorded:** the five demonstration scenarios are now written into
milestones.md as a specification rather than living in conversation. The
provider-outage one is the one a naive stub cannot demonstrate at all, which
is the whole argument for ADR-004.
