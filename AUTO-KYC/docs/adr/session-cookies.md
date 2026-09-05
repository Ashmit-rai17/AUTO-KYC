# ADR Log

| ADR | Decision | Status |
|---|---|---|
| 001 | Server-side sessions over JWT | Accepted |

Format: context → decision → consequences. Append new ADRs; never edit an
accepted one (supersede instead).

---
# ADR-001: Server-side sessions over JWT
Date: <today>
Context: KYC demands instantly revoking access (compromised/fired employee).
JWT is stateless and can't be killed without extra revocation machinery.
Decision: PostgreSQL sessions table; HttpOnly cookie holding a token whose
SHA-256 hash is stored server-side. Delete the row = revoke instantly.
Consequences: + revocation, + simple security model. − one DB lookup per
request; − CORS/cookie handling for separate frontend origins (Next.js
rewrite proxy solves this in dev).
