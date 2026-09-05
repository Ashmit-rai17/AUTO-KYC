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
           |            |              |             |
        PostgreSQL   Object Storage   OCR          PAN
        (mutable     (B2 private,    (adapter,   (adapter,
         rows +       signed URLs)    mock first)  mock first)
         append-only
         audit_log)

## Rules of the diagram
- OCR & PAN have NO arrows from the outside: only the backend calls them.
- Frontends never reach PostgreSQL/storage directly.
- Modules are LOGICAL folders, not separate services (MVP).

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
- Files ≠ rows → object storage (see docs/05).
- ML/OCR produce evidence → rules decide (see docs/06).
- Append-only only for audit_log; other tables are mutable (typo fixes).
