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

Two items here are REGULATORY PRECONDITIONS rather than features, added once
docs/rbi-compliance.md mapped the Master Direction onto this system. Neither is
optional for onboarding a real customer, and both are cheap now and expensive
after cases, notifications and the dashboard have been built on the current
shape.

- RISK CATEGORISATION (MD paras 12 and 40). Every customer carries low, medium
  or high, and para 40 fixes the answer for this product: all onboarding here
  is non-face-to-face, so these customers are HIGH RISK by rule rather than by
  judgement. The engine emits the category as an output of a run, the way it
  already emits per-check results. Two things to settle before writing it:
  whether the category belongs on the CUSTOMER (para 12 categorises customers,
  and para 38 drives periodic updation off it) or on the application; and how a
  category the regulation fixes coexists with M5's configurable rules, because
  it must not be configurable downwards. Para 12 also makes the category
  CONFIDENTIAL - it must never appear in a customer-facing response, which is a
  constraint on the API and not a preference about the UI.
- FORM 60 (MD para 16(b)). Form 60 is the lawful alternative to a PAN, so a
  form that demands a PAN excludes people the Direction expects to be
  onboarded. The minimum here is a declaration rather than a document: personal
  data accepts PAN or Form 60, the customer form offers the choice, and the
  `pan` check follows a different route instead of failing. The document-backed
  version, where the signed form is stored and read, lands with M4.

Exit: all six scenarios below are reproducible on demand from the API, and a
verified application carries a risk category that no customer-facing response
can reveal.

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
puts the six personas in place so a demonstration is one command. The risk
category shows on the queue and the case, and nowhere a customer can see.
Exit: all six scenarios can be walked end to end in a browser, unrehearsed.

## M4 — Documents + OCR
Backblaze B2 + signed upload/download URLs; documents table wired to storage;
upload-then-submit flow; doc_quality check. OCR adapter (simulated first);
extraction → normalize → match; name/dob/address matching with deterministic
and fuzzy tiers; thresholds configurable (ADR-gated).
Form 60 as a stored document rather than the M1 declaration: the signed form
uploaded, retained and readable, which is what a bank's own auditor will ask to
see. The declaration route from M1 keeps working; this adds the evidence behind
it.
Also: extracting the offline e-KYC XML from UIDAI's share-code-protected ZIP,
which is NOT yet proven and may need its own spike.

## M5 — Rules config + admin + polish
Rules engine reads config (not hardcoded); ADMIN employee management;
compliance read-only role scaffold; notifications surfaced; error copy
hardened (soft messages, no enumeration leaks).

## The six demonstration scenarios
These are a specification, not a slide. Each must be reachable on demand.

| Persona | Path | What it proves |
|---|---|---|
| Clean applicant | all PASS → auto-verified | No human touched it — the cost saving |
| Name typo | name_match → REVIEW | Exceptions reach a human WITH a reason |
| PAN absent | FAIL | Deterministic refusal on authoritative data |
| Provider outage | NOT_AVAILABLE → parks | The customer is not punished for our outage |
| Poor scan | doc_quality → REVIEW | OCR gives evidence, never a verdict |
| No PAN, Form 60 | pan check takes the Form 60 route, not FAIL | A lawful alternative is handled, not treated as an exclusion |

The fourth is the one that wins the meeting, and the one a naive stub cannot
demonstrate at all. The sixth is the one a compliance officer asks for, because
refusing everyone without a PAN is the most common way an onboarding product is
quietly non-compliant.

Every one of these ends with the customer categorised HIGH RISK under para 40,
because all of it is non-face-to-face. That is worth showing on the dashboard:
it is a conclusion the regulation reaches for us, not one we chose.

## Definition of done per slice
Diff reviewed by human · tests pass · contract / schema / adapter docs
updated if touched · .build-log entry appended with WHY.
