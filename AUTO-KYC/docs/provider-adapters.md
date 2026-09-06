# KYCFlow — Provider Adapters

## Why
Every external dependency (PAN authority, OCR, object storage) is wrapped
in a small interface. Dev runs against MOCKS. Swapping real providers =
one implementation change + env vars, not a codebase surgery.

## Pattern
interface XProvider { ... } → implementations: MockXProvider (dev),
RealXProvider (prod). Selected by env var. Mocks are deterministic so
tests can assert PASS/REVIEW paths.

## 1. Storage adapter (Backblaze B2 — S3-compatible)
- Interface: requestUploadUrl(applicationId, docType, mime) → { url, key,
  expiresAt }; requestDownloadUrl(storageKey) → { url, expiresAt }
- Backend only. Private bucket `kyc-documents`.
- Env: B2_ENDPOINT, B2_REGION, B2_BUCKET, B2_ACCESS_KEY_ID,
  B2_SECRET_ACCESS_KEY. Skills transfer 1:1 to AWS S3 (same SDK).

## 2. PAN provider adapter
- Interface: verifyPan({ pan, name, dob }) → { status:
  valid | not_found | error, officialName?, matched?, raw }
- Mock: deterministic valid/not_found by config for tests.
- Real: only via authorized channel; backend-only call; log result to
  verification_checks; NEVER let the customer probe it (see security #9).

## 3. OCR provider adapter
- Interface: extractDocument(bytes | storageKey) → { fields: { name,
  dob, pan, confidence… }, raw }
- OCR output is EVIDENCE with confidence — never a decision
  (docs/rules-engine.md).
- Mock: reads a fixture file so matching/rules can be tested offline.

## Failure semantics (per earlier design)
- timeout → retry with backoff (2–3 tries), idempotent (run_id).
- provider down/5xx → check = NOT_AVAILABLE; application parks in
  VERIFICATION_PENDING (NOT failed). Ops incident alert. Customer sees only
  "we're experiencing a delay".
- provider answers "not found" → that is FAIL (a real answer), not an outage.
