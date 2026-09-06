# KYCFlow — Provider Adapters

## Why
Every external dependency (PAN authority, OCR, object storage) is wrapped
in a small interface. Dev runs against MOCKS. Swapping real providers =
one implementation change + env vars, not a codebase surgery.

## Pattern
interface XProvider { ... } → implementations: MockXProvider (dev),
RealXProvider (prod). Selected by env var. Mocks are deterministic so
tests can assert PASS/REVIEW paths.

## Mocks are simulators, not stubs (ADR-004)
No provider licence exists yet, so the demonstration has to show what will
happen once one does. Every mock therefore reproduces:
- the real response ENVELOPE, so the real implementation is a drop-in;
- a realistic LATENCY (~1.2s + jitter, configurable). A zero-millisecond
  answer hides the async worker, the verifying state and the retry logic,
  which is precisely what is being demonstrated;
- the full FAILURE TAXONOMY: timeout, 5xx, rate-limited, genuine not-found.

Outcomes are reachable three ways:
1. a fixture registry of named personas, so a demonstration is repeatable;
2. a deterministic fallback derived from the input, so any value typed on the
   day produces a stable, explainable result rather than an error;
3. a runtime fault switch, so an outage can be triggered live without editing
   fixtures.

## Provenance - every result says where it came from
Each verification_checks.evidence carries:
{ provider: { name, mode: 'mock' | 'real', request_id, latency_ms } }
A bank's auditors will ask how they can tell a result was not fabricated, and
a mock result must never be mistakable for a real one. The API refuses to boot
with mock providers when NODE_ENV=production unless
ALLOW_MOCK_PROVIDERS_IN_PROD is explicitly set.

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
- Real: the authorized channel is Protean/NSDL Online PAN Verification, open
  only to eligible regulated entities. Backend-only call; log result to
  verification_checks; NEVER let the customer probe it (see security #9).
- TWO RESPONSE SHAPES, and both must be handled. Some modes return the
  official name for us to compare; others take a submitted name and return
  only match / no-match. Where only a boolean comes back there is no
  similarity score, so the name_match rule in docs/rules-engine.md must accept
  a boolean as well as a score - it cannot assume a threshold always applies.

## 3. Aadhaar offline e-KYC adapter (real code, test trust anchor)
- Interface: verifyOfflineKyc({ xml }) -> { status: valid | invalid_signature |
  malformed, fields?: { name, dob, gender, address }, raw }
- UIDAI Paperless Offline e-KYC is a digitally signed XML. Verifying it means
  checking an XML signature against a trust anchor. No licence is required
  because nothing is called: the customer supplies the signed file.
- This path is REAL production code in the demonstration. Only the trust
  anchor changes: a self-signed test certificate now, the UIDAI certificate
  once available. Fixtures are signed with the matching test key.
- Implementation note, proven by spike (ADR-004): the XML signature library
  RETURNS false on a digest mismatch but THROWS on a signature-value mismatch.
  Catch both, or a forged document becomes a 500 rather than a FAIL.
- Not yet solved: UIDAI ships the XML inside a share-code-protected ZIP.
  Accepting raw XML is enough for the demonstration; extraction waits for M2.
- Never store the full Aadhaar number. UIDAI requires masking to the last four
  digits, and any retained number belongs in an Aadhaar Data Vault behind a
  reference key - never in applications.personal_data.

## 4. OCR provider adapter
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
