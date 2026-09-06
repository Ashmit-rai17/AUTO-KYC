# Current milestone

**M0 — Walking Skeleton.** Not started. No application code exists in this
repository yet; everything so far is specification.

## Goal
register → login → create application → patch → consent → submit →
mock PAN check → auto-PASS or REVIEW case → employee list / detail / resolve
→ audit rows present. Proven with curl or Postman, and tests, before any UI.

## Exit criteria
Every route in docs/endpoint-contract.md (auth, applications, cases) works
and has a test. Mock providers only. No document uploads — those are M2.

## Build order
scaffold → DB schema → auth (register / login / middleware) → applications
→ cases → notifications

## Next slice
**Scaffold.** Nothing about the repository layout is decided yet: language
runtime, framework choice, migration tool and test runner are all open. Per
AGENTS.md this is a cross-cutting decision — propose an ADR and get human
sign-off before writing code.
