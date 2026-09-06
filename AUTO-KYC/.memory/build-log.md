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
