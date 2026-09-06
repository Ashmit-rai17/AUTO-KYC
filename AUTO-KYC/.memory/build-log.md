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
