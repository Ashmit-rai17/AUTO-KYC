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
