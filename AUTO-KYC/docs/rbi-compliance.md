# KYCFlow — the RBI rules this system is built against

## What this document is, and is not

This maps the obligations in the **Master Direction – Know Your Customer (KYC)
Direction, 2016** (RBI/DBR/2015-16/18, DBR.AML.BC.No.81/14.01.001/2015-16, as
updated on **14 August 2025**) onto the parts of this codebase that have to
satisfy them, and says plainly which ones are not satisfied yet.

It is **not** legal advice, it is **not** a substitute for the Direction, and it
is **not** a compliance certification. Paragraph numbers are given so every
claim can be checked against the source. Where this document and the Direction
disagree, the Direction is right.

The most important framing, and the one that decides who is accountable for
what:

> **KYCFlow is not a Regulated Entity. The bank is.**

The Direction binds "REs" — banks and other regulated entities. It does not bind
software. A bank deploying KYCFlow does so under **its own Board-approved KYC
policy** (para 4(a)), and that policy, not this repository, is the compliant
artefact. What this system can do is make the bank's policy *executable and
evidenced*: carry out the steps, record what happened, and be unable to lose the
record. Everything below is written from that position.

## The regulatory stack

```
Prevention of Money-Laundering Act, 2002        the statute
   └─ PML (Maintenance of Records) Rules, 2005  record-keeping, CKYCR, reporting
        └─ RBI KYC Master Direction, 2016       what a bank must actually do
             └─ the bank's Board-approved KYC policy   (para 4(a))
                  └─ KYCFlow                    software executing that policy
```

## The two paragraphs that govern this product most directly

Most of the Direction is about a bank's organisation. Two paragraphs are about
*exactly* what this system is.

### Para 8(b) — decision-making cannot be outsourced

The Direction states that REs shall ensure decision-making functions of
determining compliance with KYC norms **are not outsourced**.

This is the regulatory basis for the line the project already holds, written in
[rules-engine.md](rules-engine.md) before anyone had read this paragraph:

> OCR and ML produce **evidence**. The rules engine produces **decisions** with
> **reasons**.

A model that emitted `risk = 73` and an approval would be a decision function
living inside a vendor's weights. A deterministic rule that a bank's compliance
officer can read, change and be answerable for is the bank exercising its own
judgement. **Keep it that way** — this is not a design preference, it is the
shape the regulation requires.

It also means the `reason` column on `verification_checks` is a compliance
artefact, not a nicety. That is why it is `NOT NULL`.

### Para 40 — non-face-to-face onboarding is Enhanced Due Diligence

Everything KYCFlow does is non-face-to-face. Para 40 therefore applies to the
whole product, and it imposes conditions that are *not* currently modelled:

| Para 40 requires | Status here |
| --- | --- |
| V-CIP offered as the **first option** for remote onboarding | **Not built.** See V-CIP below. |
| PAN **verified from the issuing authority's** verification facility | The provider adapter is exactly this seam (`PAN_PROVIDER`); real access is the bank's, per [ADR-004](adr/session-cookies.md). |
| First transaction must be a **credit from an existing KYC-complied account** | Out of scope — a core-banking control, not ours. Must be stated to the bank, not silently assumed. |
| Such accounts **categorised as high risk**, with enhanced monitoring | **planned** M1 — no risk category exists in the schema yet. |
| Current address confirmed positively before operations | Not modelled. |

**This was the single largest compliance gap in the design**: the product is an
EDD-triggering channel that carried no notion of risk category at all. It is now
planned in [M1](milestones.md), which is the earliest it could land — the
category is an output of a verification run, and M1 is where runs begin.

## Obligation map

Status key: **built** · **planned** (with milestone) · **bank** (the RE's
responsibility, not the software's) · **gap** (needed, unplanned).

### Customer Due Diligence

| Para | Obligation | Status |
| --- | --- | --- |
| 10 | No anonymous, fictitious or benami accounts | **built** — every application hangs off an authenticated `users` row |
| 10 | No account where CDD cannot be applied; consider filing an STR | **planned** M1 — this is `FAIL`, and it must never be an automatic *rejection letter*; see "tipping off" below |
| 16 | Obtain proof of possession of Aadhaar **or** an OVD | **planned** M2/M4 — `documents.type` |
| 16(b) | Obtain **PAN or Form 60** | **planned** M1 — `personal_data.pan` exists; Form 60, the lawful alternative for a customer with no PAN, arrives as a declaration in M1 and as a stored signed form in M4. A form that demands a PAN excludes people the Direction expects to be onboarded. |
| 16 | Recent photograph | **gap** — not in the schema |
| 3(a)(xiv) | OVD list: passport, driving licence, proof of possession of Aadhaar, Voter's ID, NREGA job card, NPR letter | **planned** M4 — `documents.type` must encode this set, not a free string |
| 34 | Beneficial owner for non-individuals (>10% companies/partnerships, 15% unincorporated) | **out of scope** — individuals only; say so explicitly to the bank |
| 41 | PEP: senior-management approval, source of funds, enhanced monitoring | **gap** — not modelled |

### Aadhaar

| Para | Obligation | Status |
| --- | --- | --- |
| 16, Expl. 1 | The Aadhaar number must be **redacted/blacked out** where authentication is not required | **partial** — [provider-adapters.md](provider-adapters.md) already says never store the full number and keep it in a Data Vault behind a reference key. **Not yet enforced in the schema**, unlike append-only, which is. |
| 16, Expl. 2 | Biometric/OTP e-KYC authentication is performed by the **bank**, its BCs or BFs | **bank** — we are not an AUA/KUA and cannot be. ADR-004's seam is "when the bank's credentials are configured", which is the honest claim. |
| 17 | OTP-based e-KYC accounts: aggregate balance ≤ ₹1 lakh, aggregate credits ≤ ₹2 lakh per year, not beyond one year without full CDD or V-CIP, customer declaration of no other such account | **bank** for the limits (core banking enforces balances). **gap** for the flag: para 17(8) requires the CKYCR upload to *mark* such accounts so other REs do not rely on them. If KYCFlow ever performs OTP e-KYC it must carry that marker. |
| — | Offline verification of the signed XML | **planned** M2 — real XMLDSig against a swappable trust anchor, per ADR-004 |

### V-CIP (para 18)

**Deliberately out of scope, and the reason should be stated to the bank rather
than hidden.** Para 18 is not a feature; it is an infrastructure programme:
technology hosted in the RE's own premises, end-to-end encryption, connections
refused from IP addresses outside India, live GPS geo-tagging, face liveness and
spoof detection, VA/PT and security audit by **CERT-In empanelled** auditors,
specially trained officials, varied real-time questions, concurrent audit of
every account before it goes operational, and all data stored in India.

A demonstration that pretended to do V-CIP would be the exact failure
[AGENTS.md invariant 10](../AGENTS.md) exists to prevent. Note the consequence
though: **para 40 wants V-CIP offered first** for remote onboarding, so a
deployment without it is a deployment operating under the rest of para 40's
conditions, not a deployment that has skipped them.

### Risk, monitoring and periodic updation

| Para | Obligation | Status |
| --- | --- | --- |
| 12 | Categorise every customer low / medium / high risk | **planned** M1 |
| 12 | The risk category is **confidential and must not be revealed to the customer** — to avoid tipping off | **planned** M1, **and a hard system constraint.** The category must never reach a customer-facing response. The existing rule that customer-facing errors stay soft and non-enumerating is the same instinct; this makes it a requirement. |
| 38 | Periodic updation: high risk **2 years**, medium **8 years**, low **10 years** | **gap** — nothing schedules re-verification |
| 35–37 | Ongoing monitoring of transactions against the customer's profile | **out of scope** — a transaction monitoring system, not an onboarding system |
| 40 | Non-face-to-face accounts are high risk | **planned** M1 — see above |

**Periodic updation, as revised 12 June 2025** (DOR.AML.REC.30/14.01.001/2025-26):
at least **three advance intimations** before the due date and **three
reminders** after it, **each including at least one by letter**; an
**acknowledgement** to the customer on receipt; an **intimation** once the record
is updated; BCs may facilitate updation and the BC's details must be retained.
Low-risk individual customers get until one year past due or 30 June 2026,
whichever is later, with implementation required by 1 January 2026.

None of this is built. It is a notification/scheduling surface, and the
`notifications` table is the only piece of it that exists.

### Records — where this design is already aligned

| Para | Obligation | Status |
| --- | --- | --- |
| 46 | Transaction records kept **at least five years from the transaction** | **built in spirit** — `audit_log` is append-only and cannot be edited or truncated |
| 46 | Identification records kept **at least five years after the relationship ends** | **built in spirit** — `consents` is append-only with `ON DELETE RESTRICT` |
| 46 | Records retrievable easily and quickly, available swiftly to competent authorities | **partial** — indexed, but there is no export |

This is worth stating clearly because it reframes an item the project has been
carrying as *debt*:

> "A consented customer cannot be deleted."

Under para 46 that is not a defect. A five-year retention obligation that
survives the end of the relationship is **incompatible** with unconditional
erasure on request, and the schema encoding that refusal at the database level —
rather than trusting an application to remember — is the stronger position. It
remains a position the bank must be told about and must own in its privacy
notice, and the cascade is wider than first recorded: the customer, the
application, the case and the acting employee are all undeletable once a case
event exists.

### Reporting and confidentiality

| Para | Obligation | Status |
| --- | --- | --- |
| 6, 7 | Designated Director and Principal Officer, notified to FIU-IND and RBI | **bank** |
| 11A | Where CDD would **tip off** the customer, do not pursue it — file an STR instead | **bank** decides; **system constraint** for us: there must be a path that stops an application without telling the customer why, and that path must look ordinary from outside |
| — | STR / CTR filing to FIU-IND | **out of scope** |
| 12 | Risk categorisation confidential | see above |
| 4(b) | Group-wide information sharing with tipping-off safeguards | **bank** |
| 14 | Third-party / CKYCR reliance — records obtained immediately | **gap** |
| 56(h) | Incremental upload of KYC records to **CKYCR**; updated information furnished **within seven days** (or as notified by the Central Government) | **gap** — no CKYCR integration exists |
| 16(ac) | A KYC Identifier may be used only with the customer's **explicit consent** to download from CKYCR | **gap**, though `consents` is the right shape to record it — it already versions what was consented to |

### Governance

| Para | Obligation | Status |
| --- | --- | --- |
| 4(a) | Board-approved KYC policy | **bank** |
| 8 | Concurrent/internal audit of KYC/AML compliance, quarterly to the Audit Committee | **bank** — but the audit needs *evidence*, and `audit_log` is what it reads |
| 8(b) | KYC decision-making not outsourced | **built** — see above |
| 18(b)(i) | Officials performing V-CIP specially trained | n/a |

## The honest gap list

Ordered by how much they matter for a bank demonstration:

1. **No risk categorisation.** Para 12 and para 40 both require it, and para 40
   applies to everything this product does. It affects the schema, the rules
   engine output and the review queue. **Now planned in M1.**
2. **No Form 60.** Para 16(b) makes it the lawful alternative to PAN. The
   customer form currently requires a PAN, which excludes people the Direction
   expects to be onboarded. **Now planned in M1** as a declaration, with the
   stored signed form in M4.
3. **No periodic updation.** Para 38 plus the June 2025 revision is a whole
   subsystem — scheduling, three intimations, three reminders, letters,
   acknowledgements.
4. **No CKYCR.** Para 56(h), seven days for updates.
5. **Aadhaar masking is documented but not enforced.** Everything else in this
   schema that matters is enforced by the database.
6. **No photograph.** Para 16.
7. **No PEP handling.** Para 41.

## What this changes about the roadmap

Nothing already planned becomes wrong. But the milestone plan was written from a
product view, and two items above are *legal* preconditions for onboarding a
real customer rather than features: **risk categorisation** (para 40) and
**Form 60** (para 16(b)).

Both are now on the plan, in [milestones.md](milestones.md) M1, with the
document-backed Form 60 following in M4. A sixth demonstration scenario — a
customer with no PAN — was added with them, because a rule nobody demonstrates
is a rule nobody notices is missing.

## Sources

- Master Direction – Know Your Customer (KYC) Direction, 2016, as updated
  14 August 2025 — RBI/DBR/2015-16/18, DBR.AML.BC.No.81/14.01.001/2015-16.
  <https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=11566>
- Updation / Periodic Updation of KYC – Revised Instructions, 12 June 2025 —
  RBI/2025-26/51, DOR.AML.REC.30/14.01.001/2025-26.
- FAQs on the Master Direction on KYC, 9 June 2025.
- Prevention of Money-Laundering Act, 2002; PML (Maintenance of Records)
  Rules, 2005 — the statutory basis the Direction implements.

Paragraph numbering follows the consolidated Master Direction and moves between
amendments. Re-check against the current consolidated version before relying on
a number here.
