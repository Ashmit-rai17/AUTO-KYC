# KYCFlow — PRD (distilled)

## Goals
- Customers open accounts fully online with minimal human touch.
- Clean applications auto-pass; exceptions reach humans with reasons.
- Full auditability for regulators ("who did what, when, why").

## Functional requirements
1. Customer: register, create application, enter personal data, upload
   PAN + address-proof documents, consent capture, submit, view status,
   correct data when the employee permits.
2. System: run OCR on documents, verify PAN via an AUTHORIZED provider
   (behind adapter), run matching checks, emit per-check results.
3. Employee: review queue of exceptions, view case + documents, request
   more info, approve / reject with reason.
4. Admin: create employee accounts, configure rules (post-MVP).
5. Audit: append-only log of all significant actions.

## Non-functional requirements (core)
- SECURITY: RBAC, ownership checks, signed uploads, no creds in frontend.
- CONSENT: explicit, recorded with timestamp + metadata.
- AUDITABILITY: every decision explainable; every action logged.
- DETERMINISTIC verification: rules engine, not an opaque model.
- HUMAN CONTROL: employees decide exceptions; system never auto-rejects on
  ambiguous signals.
- DATA MINIMIZATION: store only what verification requires.

## MVP scope decisions
- Mock providers first (PAN/OCR behind adapters); real ones later.
- Uploads deferred to M2 (after decision logic is proven with mocks).
- No notifications UI in M0 beyond status strings (poll later).
- Compliance = read-only role: post-MVP.
