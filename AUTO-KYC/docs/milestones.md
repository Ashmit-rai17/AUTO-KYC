# KYCFlow — Milestones

Re-planned once the audience became a bank demonstration rather than a
build-it-then-show-it project. Two things changed. Provider simulation was
promoted from an implementation detail to a milestone of its own, because the
simulators ARE the demonstration. And the employee dashboard moved much
earlier: a bank buys the review queue and the audit trail, so a plan that
finishes the UI last would have nothing to show until the very end.

## M0 — Walking Skeleton (simulated providers, NO uploads yet)
Target: register → login → create app → patch → consent → submit →
PAN check → auto-PASS or REVIEW case → employee list/detail/resolve →
audit rows present. Test with curl/Postman before any UI.
Exit: every route in docs/endpoint-contract.md works with tests.
Build order: scaffold → DB schema → auth (register/login/middleware) →
applications → cases → notifications.

## M1 — Verification engine + provider simulators
The worker and the thing it calls, together — a simulator's latency and
failure modes only mean anything once something is orchestrating retries.
Async worker with retry/backoff; NOT_AVAILABLE state + VERIFICATION_PENDING;
idempotent runs (run_id); state machine enforced; audit coverage complete.
Full-fidelity PAN simulator per ADR-004: real response envelope, ~1.2s latency
with jitter, complete failure taxonomy, named fixture personas, deterministic
fallback for any input, runtime fault injection, provenance stamped on every
check, and the production guard that refuses to boot on simulators.
Exit: all five scenarios below are reproducible on demand from the API.

## M2 — Aadhaar offline e-KYC (real signature verification)
XMLDSig verification against a configurable trust anchor; fixture generator
signing test documents; both failure paths handled (the library returns false
on a digest mismatch but throws on a signature-value mismatch). Masking rules
enforced — the full number is never persisted.
Exit: a tampered document is rejected, and the trust anchor is one env var.

## M3 — Demonstration surface
Employee dashboard: review queue, case detail with per-check reasons, the
audit trail, and a visible marker wherever a result came from a simulator.
Thin customer flow, enough to walk an application through. `npm run demo:seed`
puts the five personas in place so a demonstration is one command.
Exit: all five scenarios can be walked end to end in a browser, unrehearsed.

## M4 — Documents + OCR
Backblaze B2 + signed upload/download URLs; documents table wired to storage;
upload-then-submit flow; doc_quality check. OCR adapter (simulated first);
extraction → normalize → match; name/dob/address matching with deterministic
and fuzzy tiers; thresholds configurable (ADR-gated).
Also: extracting the offline e-KYC XML from UIDAI's share-code-protected ZIP,
which is NOT yet proven and may need its own spike.

## M5 — Rules config + admin + polish
Rules engine reads config (not hardcoded); ADMIN employee management;
compliance read-only role scaffold; notifications surfaced; error copy
hardened (soft messages, no enumeration leaks).

## The five demonstration scenarios
These are a specification, not a slide. Each must be reachable on demand.

| Persona | Path | What it proves |
|---|---|---|
| Clean applicant | all PASS → auto-verified | No human touched it — the cost saving |
| Name typo | name_match → REVIEW | Exceptions reach a human WITH a reason |
| PAN absent | FAIL | Deterministic refusal on authoritative data |
| Provider outage | NOT_AVAILABLE → parks | The customer is not punished for our outage |
| Poor scan | doc_quality → REVIEW | OCR gives evidence, never a verdict |

The fourth is the one that wins the meeting, and the one a naive stub cannot
demonstrate at all.

## Definition of done per slice
Diff reviewed by human · tests pass · contract / schema / adapter docs
updated if touched · .build-log entry appended with WHY.
