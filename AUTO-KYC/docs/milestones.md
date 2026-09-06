# KYCFlow — Milestones

## M0 — Walking Skeleton (mock everything, NO uploads yet)
Target: register → login → create app → patch → consent → submit →
mock PAN → auto-PASS or REVIEW case → employee list/detail/resolve →
audit rows present. Test with curl/Postman before any UI.
Exit: every route in docs/endpoint-contract.md works with tests.
Build order: scaffold → DB schema → auth (register/login/middleware) →
applications → cases → notifications.

## M1 — Hardening + async verification
Async worker with retry/backoff; NOT_AVAILABLE state + VERIFICATION_PENDING;
idempotent runs (run_id); state machine enforced; audit coverage complete.

## M2 — Real document pipeline
Backblaze B2 + signed upload/download URLs; documents table wired to
storage; upload-then-submit flow; doc_quality check.

## M3 — OCR + matching
OCR adapter (mock first, real later); extraction → normalize → match;
name/dob/address matching with deterministic + fuzzy tiers; thresholds
configurable (ADR-gated).

## M4 — Rules config + admin
Rules engine reads config (not hardcoded); ADMIN employee management;
compliance read-only role scaffold.

## M5 — UI polish
Customer app + employee dashboard UX; notifications surfaced; error
copy hardened (soft messages, no enumeration leaks).

## Definition of done per slice
Diff reviewed by human · tests pass · contract / schema / adapter docs
updated if touched · .build-log entry appended with WHY.
