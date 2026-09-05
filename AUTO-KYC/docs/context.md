# KYCFlow — Context

One paragraph: KYCFlow automates the manual bank-branch account-opening
process. Customer submits personal data + documents through a web app;
a backend stores data in PostgreSQL and files in object storage; OCR and
authorized providers produce evidence; a rules engine turns evidence into
explainable per-check decisions; exceptions go to an employee review queue;
everything is audited. There is no opaque ML "risk score" — every outcome
has a reason.

## Mental model
- API = the only door between frontends and the world (waiter in a restaurant).
- PostgreSQL = facts (rows, relationships) — mutable except audit_log.
- Object storage = sealed boxes of file bytes, addressed by key.
- Rules engine = the supervisor who decides; OCR/providers are clerks who report.

## Actors summary
| Actor | Can see | Can do |
|---|---|---|
| CUSTOMER | own application + status | create/update/submit own app, upload own docs |
| EMPLOYEE | authorized cases | review, request info, resolve cases |
| ADMIN | all + config | create employees, manage rules/roles |
| SYSTEM | internal | verification runs, notifications, audit |

## Docs map
01 PRD · 02 Architecture · 03 Endpoint contract · 04 DB schema
05 Provider adapters · 06 Rules engine · 07 Milestones · adr/ decisions
