# KYCFlow — PRD (distilled)

## Who this is for
KYCFlow is built to be DEMONSTRATED to a bank, and then deployed by one. That
shapes every decision below.

The important consequence: a bank is itself an eligible entity. It can hold
Protean/NSDL PAN verification access, and it is the kind of organisation that
can be licensed as an AUA/KUA for Aadhaar. We are not. So the seam is not
"when we get permissions" — it is "when the bank's own credentials are
configured". The product's job is to make that seam small, visible and
provable, and to behave correctly on the day it is crossed.

## Goals
1. Customers open accounts fully online with minimal human touch.
2. Clean applications auto-pass; exceptions reach humans with reasons.
3. Full auditability for regulators ("who did what, when, why").
4. Demonstrate the real process before any credential exists — including the
   failure paths, which are the part a bank is actually buying.
5. Keep the provider seam to one implementation plus configuration, and be
   able to show that this is true rather than assert it.

## Functional requirements
1. Customer: register, create application, enter personal data, upload
   PAN + address-proof documents, consent capture, submit, view status,
   correct data when the employee permits.
2. System: run OCR on documents, verify PAN via an AUTHORIZED provider
   (behind adapter), verify Aadhaar offline e-KYC signatures, run matching
   checks, emit per-check results.
3. Employee: review queue of exceptions, view case + documents, request
   more info, approve / reject with reason.
4. Admin: create employee accounts, configure rules (post-MVP).
5. Audit: append-only log of all significant actions.
6. SIMULATION: every provider has a simulator reproducing its real contract —
   response envelope, latency, and failure taxonomy. All five demonstration
   scenarios in docs/milestones.md are reachable on demand, including a
   provider outage, without editing code or fixtures.

## Non-functional requirements (core)
- SECURITY: RBAC, ownership checks, signed uploads, no creds in frontend.
- CONSENT: explicit, recorded with timestamp + metadata.
- AUDITABILITY: every decision explainable; every action logged.
- DETERMINISTIC verification: rules engine, not an opaque model.
- HUMAN CONTROL: employees decide exceptions; system never auto-rejects on
  ambiguous signals.
- DATA MINIMIZATION: store only what verification requires.
- PROVENANCE: a simulated result must never be mistakable for a real one.
  Every check records which provider produced it and in what mode. The API
  refuses to start with simulators under NODE_ENV=production unless
  explicitly overridden. A bank's auditors will ask this question; the answer
  has to be a row, not a promise.
- AADHAAR HANDLING: the full number is never stored. Masked to the last four
  digits, and any retained number belongs in a data vault behind a reference
  key — never in applications.personal_data.

## What cannot be built without the bank's credentials
- Live PAN verification (Protean/NSDL — eligible entities only).
- Aadhaar online eKYC, OTP or biometric authentication (AUA/KUA licensing).
- CKYC record retrieval (CERSAI — regulated entities).
- V-CIP video KYC (RBI-permitted entities).

Each of these sits behind an adapter with a simulator, so the demonstration
shows the real flow and the real failure handling. Swapping in the bank's
credentials is one implementation plus environment variables.

The exception, and it matters: Aadhaar Paperless Offline e-KYC needs NO
licence. The customer supplies a UIDAI-signed file and we verify the
signature — nothing is called. That path is built as real production code
against a test certificate, and only the trust anchor changes on the day.

## MVP scope decisions
- Providers are SIMULATORS, not stubs (ADR-004). An instant canned answer
  hides the async worker, the verifying state and the outage handling, which
  is precisely what is being demonstrated.
- Aadhaar offline e-KYC is REAL code from the start, against a test anchor.
- Uploads deferred until the decision logic is proven with simulators.
- No notifications UI early beyond status strings (poll later).
- Compliance = read-only role: post-MVP.
