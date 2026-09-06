# KYCFlow — Architecture

## Diagram
        Customer App (:3000)   Employee Dashboard (:3001)
                    \                /
                     \              /
                 HTTPS + session cookie (HttpOnly, SameSite=Lax)
                          \        /
                     Node.js API (:4000)
        ----------------------------------------------
        Every route: 1 authenticate → 2 authorize →
                     3 ownership/case-access → 4 validate → 5 audit
        Modules (folders in ONE codebase): auth · applications ·
        documents · verification · rules · cases · notifications · admin
        ----------------------------------------------
           |            |            |          |          |
        PostgreSQL  Object Storage  OCR        PAN      Aadhaar
        (facts +    (B2 private,   (adapter)  (adapter) (adapter)
         append-only signed URLs)
         audit_log)

## Rules of the diagram
- OCR & PAN have NO arrows from the outside: only the backend calls them.
- Frontends never reach PostgreSQL/storage directly.
- Modules are LOGICAL folders, not separate services (MVP).
- OCR and PAN run against SIMULATORS until the bank's credentials are
  configured. The simulators reproduce the real contract — envelope, latency,
  failure taxonomy — so the swap is one implementation plus env vars
  (ADR-004). Every check records which mode produced it.
- Aadhaar is the exception and points the other way: offline e-KYC needs no
  licence, because the customer supplies a UIDAI-signed file and nothing is
  called. That adapter is REAL production code verifying a signature; only the
  trust anchor changes on the day.

## End-to-end request trace
1. Customer submits form → POST /api/applications (auth + ownership).
2. Docs: backend signs upload URL → browser PUTs file to storage directly.
3. Submit → system worker: OCR → PAN check → normalize → match →
   rules engine per check.
4. All PASS → application auto-verified (no case). Any REVIEW/FAIL/
   NOT_AVAILABLE → review_cases row created with reasons.
5. Employee opens case → sees checks + docs (authorized GET, short-lived
   signed view URL) → resolves with reason.
6. Every state change → audit_log row (append-only).

## Boundaries / why
- Files ≠ rows → object storage (see docs/provider-adapters.md).
- ML/OCR produce evidence → rules decide (see docs/rules-engine.md).
- Append-only only for audit_log; other tables are mutable (typo fixes).
