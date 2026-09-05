# KYCFlow — Rules Engine

## Golden line
ML/OCR produce EVIDENCE ("I read 'Priya Naîr', confidence 61%").
The RULES ENGINE produces DECISIONS + REASONS. Never conflate.

## Pipeline order
1. GATHER evidence (form data, provider response, OCR output)
2. NORMALIZE (trim, lowercase, unify punctuation: "RAHUL SHARMA" == "rahul sharma")
3. MATCH (compare evidence → similarity/comparison result)
4. RULES (combine results → per-check PASS/REVIEW/FAIL/NOT_AVAILABLE + reason)
5. ROUTE (all pass → auto-verified; else review_cases row)

## Two kinds of logic — keep separate
- MATCHING: answers "how similar are A and B?" → numbers/comparisons.
  Start deterministic (exact, normalized), add fuzzy (typo/OCR) only where
  needed, with a threshold.
- RULES: answers "what do we DO with that?" → decision + reason.
  e.g. IF pan_verification == valid AND name_similarity >= 0.95
       THEN name_check = PASS, reason = "Application and verified info match"

## Check enum (every check has result + reason)
pan · name_match · dob_match · address_match · doc_quality

## Result states
- PASS — evidence clean
- REVIEW — needs human judgment (e.g. fuzzy name match)
- FAIL — deterministic mismatch with authoritative data (e.g. PAN not found)
- NOT_AVAILABLE — provider outage; application parks (not customer's fault)

## Routing semantics
- All PASS → auto-verified, no case.
- Any REVIEW/FAIL/NOT_AVAILABLE → review case with the failing checks +
  reasons attached. Human resolves; system never auto-rejects on ambiguity.
- Application state machine: draft → submitted → verifying →
  verification_pending → review → verified | rejected (+ employee-gated
  "request correction" loop).

## Worked example
Form: Priya Nair · PAN verification: valid, official name PRIYA NAIR
→ pan PASS · name PASS · dob PASS → auto-verified.
Form: Rahul Sharrma (typo) vs official RAHUL SHARMA
→ name REVIEW (similarity 0.96 < exact) → review case, employee requests
  re-confirmation. Customer message is SOFT, never "your name check failed".

## Anti-patterns
- ❌ ML decides final status · ❌ single "risk = 73" score
- ❌ rules scattered as if/else across code · ❌ not storing reasons
