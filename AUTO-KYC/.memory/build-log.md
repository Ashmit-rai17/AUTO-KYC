# Build log

One entry per slice, newest at the bottom. Record **why**, not just what —
the diff already records what. Never rewrite an existing entry; append a
correcting entry instead.

## Template

### YYYY-MM-DD — <slice name>
**What:** one or two lines.
**Why:** the reasoning that is not visible in the diff.
**Decisions:** anything that should become an ADR, or "none".
**Docs touched:** endpoint-contract / db-schema / provider-adapters / none.
**Tests:** what proves this slice works.

---

### 2026-09-06 — Repository documentation
**What:** Added the project README, replacing a 2-byte placeholder, and
repointed 11 broken references across AGENTS.md, architecture.md,
db-schema.md, milestones.md and provider-adapters.md.
**Why:** the docs referred to each other by numeric prefix
(docs/00-context.md, docs/03, docs/06) but the files on disk are unnumbered,
so every one of those paths was dead. AGENTS.md tells each session that docs
are the source of truth and then handed out paths that do not resolve — the
first lookup of a session would fail.
**Decisions:** none. Documentation only; no design decision was changed.
**Docs touched:** AGENTS.md, architecture, db-schema, milestones,
provider-adapters.
**Tests:** not applicable, no code yet.

### 2026-09-06 — Session memory scaffold
**What:** Created .memory/current-milestone.md and .memory/build-log.md, and
filled the unset `Date: <today>` placeholder in ADR-001.
**Why:** AGENTS.md mandates reading current-milestone.md at every session
start and appending here after every slice, but neither file existed, so the
session protocol could not actually be followed as written.
**Decisions:** none.
**Docs touched:** docs/adr/session-cookies.md (date only).
**Tests:** not applicable, no code yet.

### 2026-09-06 — M0 slice 1: scaffold
**What:** npm workspace with an `api/` package. TypeScript (ESM, strict),
Express 5, `pg`, Zod, node-pg-migrate, Vitest + supertest, ESLint flat config,
Docker PostgreSQL, and liveness / readiness probes.
**Why:** M0 could not begin while the framework, database client, migration
tool and test runner were undecided. Wiring every gate in the definition of
done (`npm test`, `npm run lint`, `npm run db:migrate`) from the first commit
means later slices cannot quietly skip them.
**Decisions:** ADR-002. Notably: raw `pg` over an ORM, because audit_log's
append-only guarantee belongs in the database and an ORM would hide that
layer; and TypeScript 5.9 rather than the newly released TypeScript 7, which
is a native rewrite and too new to found this on.
**Docs touched:** endpoint-contract (operational routes), adr (ADR-002).
**Tests:** 10 passing. Config defaults and validation, including a test that a
config error names the offending KEY without echoing its VALUE — invariant 8
is a rule that can rot silently, so it is pinned by a test. Health liveness
asserts the database is never queried; readiness covers both up and down.
**Verified:** install, typecheck, lint, build, and the compiled server
answering all three routes over HTTP.

### 2026-09-06 — M0 slice 2: database schema
**What:** One migration creating all ten tables from docs/db-schema.md, plus a
consents table that the docs referenced but never defined. Append-only
enforcement, an updated_at trigger, and 25 integration tests run against a real
PostgreSQL.
**Why:** the append-only promise on audit_log is the one this project makes to
regulators, so it had to become a database fact rather than a convention that
application code is trusted to honour.
**Decisions:** ADR-003. UUID keys (a sequential id in a customer-facing URL is
an enumeration oracle, same concern as invariant 9); TEXT + CHECK over enums
(the state machine will grow); triggers over REVOKE (a trigger fires for the
table owner, a REVOKE does not).
**Docs touched:** db-schema (consents table, corrected check names, decisions
section), adr (ADR-003).
**Tests:** 25 integration + the existing 10 unit. Verified up, down, and up
again; the rollback leaves no orphan functions.
**Worth remembering — three things the tests caught that review would not:**
1. UPDATE and DELETE against an EMPTY table match no rows, so a row trigger
   never fires and the statement succeeds. The first version of the
   append-only tests passed for that entirely wrong reason until the tables
   were seeded.
2. TRUNCATE never fires a row-level trigger. Without the separate statement
   trigger, one command would have erased the audit trail with no error.
3. TRUNCATE on consents is refused by its foreign key BEFORE the trigger is
   reached, so that table is protected by two mechanisms and reports a
   different error than the other two.

### 2026-09-06 - ADR-004: how providers get simulated
**What:** No code. Recorded how the provider layer behaves for a bank
demonstration, and updated docs/provider-adapters.md with the Aadhaar adapter,
the two PAN response shapes, and the provenance envelope.
**Why:** the audience changed the requirement. This is shown to a bank before
any licence exists, so the mocks have to demonstrate the real process rather
than return canned answers. Settling it now means the provider interface and
the evidence shape are not retrofitted later around whatever was convenient.
**Decisions:** ADR-004. Mocks simulate the contract - envelope, ~1.2s latency,
full failure taxonomy - because a zero-millisecond {valid:true} hides the async
worker and the outage handling, which is the part a bank actually buys. Every
check row stamps provider mode, and the API refuses to boot with mocks under
NODE_ENV=production, so a simulated result can never be mistaken for a real
one.
**Docs touched:** adr (ADR-004), provider-adapters.
**Tests:** none - documentation only.
**Spiked before accepting:** proved the Aadhaar offline e-KYC signature path
works in Node (xml-crypto 6.1.2, RSA-SHA256, enveloped): signs and verifies
against the right anchor, rejects an altered name, rejects a different anchor.
Trap found: xml-crypto RETURNS false on a digest mismatch but THROWS on a
signature-value mismatch - catch both or a forged document becomes a 500
instead of a FAIL. Worth the detour: the ADR now claims only what was actually
observed. Still unproven, and flagged as such: extracting the XML from UIDAI's
share-code-protected ZIP.

### 2026-09-06 - Re-pointed the PRD and the plan at the bank demonstration
**What:** Rewrote docs/prd.md and docs/milestones.md. Added invariant 10 to
AGENTS.md and widened invariant 7 to cover Aadhaar; refreshed the commands
line, which had gone stale after the integration-test split.
**Why:** the PRD still read as a portfolio build - "mock providers first, real
ones later" - which is now actively misleading. The bank is the eligible
entity, not us. It can hold Protean/NSDL PAN access and can be licensed
AUA/KUA, so the seam is "when the bank's credentials are configured", not
"when we get permissions". That is a smaller and far more defensible claim,
and the docs need to say it because it is what the demonstration argues.
**Decisions:** no new ADR - this records the consequences of ADR-004 rather
than deciding anything new. Two structural changes to the plan: provider
simulation promoted into M1 next to the async worker, because a simulator's
latency and failure taxonomy are meaningless without something orchestrating
retries; and the employee dashboard pulled from M5 to M3, because the review
queue and audit trail ARE the demonstration and finishing the UI last would
leave nothing to show.
**Docs touched:** prd, milestones, AGENTS.
**Tests:** none - documentation only.
**Also recorded:** the five demonstration scenarios are now written into
milestones.md as a specification rather than living in conversation. The
provider-outage one is the one a naive stub cannot demonstrate at all, which
is the whole argument for ADR-004.

### 2026-09-06 - M0 slice 3: authentication
**What:** register / login / logout / me, session middleware and a role guard.
argon2id password hashing, PostgreSQL-backed sessions, audit on every outcome.
70 tests now pass (26 unit, 44 integration).
**Why:** everything after this depends on knowing who is calling. Ownership
checks, the review queue and the audit trail are all meaningless without it.
**Decisions:** ADR-005, which closes the two questions this file has been
carrying. argon2id via @node-rs/argon2 (a prebuilt Rust binding, not a
node-gyp build - it installed in three seconds on a machine where native
compilation has already failed twice). Cost m=65536/t=3 at ~64ms, configurable
but FLOORED at the OWASP minimum by the config schema, so a deployment can
raise it and cannot quietly weaken it. Cookie stays SameSite=Lax behind a
same-origin Next.js rewrite proxy, which means the API enables no CORS at all
- no cross-origin credentialed request is possible, so there is no
cross-origin surface to defend.
**Docs touched:** adr (ADR-005), endpoint-contract (auth model, and an honest
note about where the vagueness is incomplete).
**Tests:** 26 unit + 44 integration. Beyond the happy paths they pin the
security properties: a role in the request body cannot make you an ADMIN; the
session token is in the database only as a SHA-256; logout locks the holder
out on the very NEXT request, which is the entire reason ADR-001 chose
sessions over a JWT; suspending an account does the same; and no audit row
ever contains a password or a token.
**Two things worth remembering:**
1. Login spends hashing work even when no user matched. Without that decoy an
   unknown address answers in microseconds while a known one spends ~64ms -
   a timing oracle leaking exactly what the shared error message hides.
2. Typecheck caught a test that would have passed on two SUCCESSES: comparing
   two failures via `.catch(e => e)` never asserts that either call actually
   failed. It now goes through a helper that throws if the call succeeds.
**Known gap, stated rather than hidden:** no rate limiting anywhere. Login is
brute-forceable and registration's 409 is a weak enumeration signal (ADR-005).
Both need an ADR because rate limiting adds a dependency and touches every
route. A bank will ask about this.

### 2026-09-06 - Closing the three gaps auth left open
**What:** Rate limiting on every route and strictly on credential routes, CSRF
double-submit tokens on state-changing requests, and a registration endpoint
that answers identically whether or not the address is taken. 82 tests now
pass (26 unit, 56 integration).
**Why:** all three were written down as debt when auth landed. Closing them
before applications means nothing gets built on top of a known hole - and a
bank's reviewer would have found every one of them.
**Decisions:** ADR-006.
**Docs touched:** adr (ADR-006), endpoint-contract (register is now 202, plus
the rate-limit and CSRF contract).
**Tests:** 26 unit + 56 integration, including that a failed CSRF check leaves
the session usable - a defence that logged the victim out would be a
denial-of-service - and that registration's two paths are byte-identical
rather than merely similarly worded.
**The thing worth remembering, because it was silent:** the first version used
ONE rate limiter with skipSuccessfulRequests for both credential routes. The
enumeration fix had just made registration always return 202, so every
registration counted as successful and registration ended up with NO limit at
all. Two individually correct fixes combined into a hole that neither one had
on its own, and nothing about the code looked wrong. It surfaced only because
a test asserted the third registration is refused. Registration now counts
every request; login still skips successes so a shared office address is not
locked out.
**Also fixed the claim, not just the code:** ADR-005 had said rate limiting
would blunt the registration signal. With the shared limiter it would not
have. The ADR now says what is actually true.

### 2026-09-06 - Both front ends
**What:** web-customer (:3000) and web-employee (:3001), Next.js 16 + React 19,
sharing one visual system with a different accent so the two surfaces are
distinguishable on sight. Register, sign in, sign out and session handling are
real and talk to the live API. Screens for the application status, the review
queue and case detail exist and are wired to the documented contract.
**Why:** the demonstration surface was pulled forward to M3 because a bank buys
the review queue. Building the shells now also settles a question ADR-005 had
only asserted.
**Decisions:** none new. This VALIDATES ADR-005 rather than deciding anything:
the Next.js rewrite proxy was assumed to make the session cookie first-party,
and that had never been tested. It does - verified end to end through :3000,
with the cookie landing on the Next origin, httpOnly holding (document.cookie
shows only kyc_csrf), and CSRF working from the browser's own fetch.
**Docs touched:** README (three-process run instructions and the cookie caveat).
**Tests:** none automated for the front ends yet - a gap, and an honest one.
Everything was verified by driving the real UI in a browser against the live
API and confirming rows in PostgreSQL.
**Three things worth remembering:**
1. Cookies ignore the port. :3000 and :3001 share a jar, so signing into the
   staff app hijacked the customer session - the customer app cheerfully showed
   "Signed in as reviewer@bank.example". Both apps now guard on ROLE rather
   than trusting the cookie's owner. Found by trying it, not by reasoning.
2. Windows does not resolve *.localhost, so the customer.localhost /
   employee.localhost idea cannot be done by binding Next to that hostname -
   it needs hosts entries, and only the browser resolves it.
3. Killing `next start` by its npm wrapper leaves the real process holding the
   port. The restart dies with EADDRINUSE and the browser keeps serving the old
   bundle, which is indistinguishable from "my change did nothing". Cost a
   detour chasing a phantom React bug.
**Deliberately left empty:** the queue and the application screens show a plain
"not built yet" panel naming the endpoint they need, rather than sample rows.
A demonstration that shows invented cases is worth less than one that admits
what exists - and this system's whole argument is that every decision has a
real reason behind it.

### 2026-09-07 - M0 slice 4: applications
**What:** All six application routes - create, list own, get own, patch,
consent, submit - plus the personal-data schema. 138 tests now pass (55 unit,
83 integration).
**Why:** first slice with real ownership, which is step 3 of the security
checklist and the thing every later route depends on.
**Decisions:** ADR-007. The one worth repeating: ownership is a WHERE clause
rather than a check performed next to one, and failures answer 404 rather than
403. Because the scoping lives in the SQL there is no branch that COULD answer
403 and thereby confirm a stranger's application exists - the safe behaviour is
structural instead of remembered.
**Docs touched:** adr (ADR-007), endpoint-contract (submit now says SUBMITTED,
plus the ownership and draft rules).
**Corrected a doc rather than matching it:** the contract said submit moves an
application to VERIFYING, which contradicts the state machine in
rules-engine.md and would have claimed work nothing performs - the verification
worker is M1. submit now sets `submitted` and the contract says so.
**Tests:** the ownership ones are the point. Bob asking for Alice's
application, for a made-up uuid, and for "banana" all return byte-identical
404s. Also pinned: PATCH merges rather than replaces, a status in the body is
discarded, and the audit row for an edit records field NAMES and never values.
**A real bug caught by the type checker:** Express 5 types req.params as
possibly-array, and chasing that surfaced something worse - applications.id is
a uuid column, so an unparseable id would have reached PostgreSQL, raised
"invalid input syntax for type uuid", and surfaced as a 500. That is both an
error report and a way to tell "not an id" from "not yours". Ids are now
validated before they reach SQL and answer 404 like everything else.
**A finding that is not a bug:** the test could not delete its own users -
consents.user_id is ON DELETE RESTRICT and consents is append-only, so a
customer who has consented cannot be removed at all. The design doing exactly
what ADR-003 asked. But it means this schema cannot honour an erasure request
for a consented customer, which is a position to hold deliberately rather than
discover. Recorded as carried debt.

### 2026-09-07 - The customer application form
**What:** The form a customer actually fills in: start, save as you go, consent,
submit, then a read-only record. 144 tests pass (61 unit, 83 integration).
**Why:** checking whether the app worked turned up a gap. The applications API
was complete and tested, but the Start button in the browser was still disabled
from when the API did not exist, and there was no form behind it. So the API
could open an account and a person could not.
**Decisions:** no new ADR. One additive contract change: a validation or
completeness failure now also returns `error.fields: [{field, message}]`. The
form maps those dotted paths onto inputs, which keeps the Zod schema the single
source of truth instead of copying the rules into the browser where they would
drift.
**Docs touched:** endpoint-contract (the fields envelope, blank and partial
address semantics, and the top-level merge warning).
**Tests:** six new schema tests, all pinning the bug below.
**Two bugs found by building the form, both of which the API tests had missed
because they only ever sent complete or clearly-invalid data:**
1. `PersonalDataSchema.partial()` makes the TOP-LEVEL keys optional and leaves
   the address object fully required. A customer who had typed one line of
   their address could not save at all - the draft promise was broken for the
   address specifically. The schema now composes both shapes from shared field
   rules, and a draft accepts blanks and a partly filled address. A blank is
   also how a customer clears a field, since the server replaces the address
   key rather than merging into it.
2. Recording consent BEFORE submitting left a consent row behind for every
   failed attempt. Proven, not suspected: three failed submits produced three
   consent rows, and because consents is append-only they cannot be removed -
   the one table that exists to be trustworthy evidence was filling with events
   that never happened. Now the submit is attempted first and consent is
   recorded only if the server answers CONSENT_REQUIRED, which it checks after
   completeness, so that code can only mean everything else is already in
   order. Verified: two failed submits leave zero consent rows, and a
   successful one leaves exactly one.
**Verified end to end in a real browser:** register, sign in, start, save a
half-filled form, a malformed PAN marking only the PAN box, two rejected
submits marking exactly the missing fields, then a successful submit. The
application row, the single consent record and the audit trail were all checked
in PostgreSQL afterwards. The audit shows only the fields actually changed per
save, which is the diffing working.

### 2026-09-14 — Environment loading
**What:** Nothing loaded the .env file the README tells you to create.
Added api/src/env.ts (Node's built-in process.loadEnvFile, no dependency),
imported first in index.ts and registered as the integration suite's
setupFile, plus api/scripts/migrate.mjs to do the same for the migration CLI.
**Why:** the documented setup did not work. `cp .env.example .env` then
`npm run db:migrate` failed with "DATABASE_URL is not set", and `npm run
dev:api` threw "Invalid environment configuration. Check these keys:
DATABASE_URL". config.ts reads process.env directly, nothing populated it,
and dotenv is not a dependency. Anyone cloning this — a colleague, a bank's
technical team — hit a wall on step four of the README. Verified fixed by
wiping the volume and running the documented sequence in a shell with nothing
exported.

The migration needed its own wrapper for three separate reasons, each of
which fails quietly on its own: node-pg-migrate v9 dropped dotenv but kept
--envPath in --help, where it now does nothing; the CLI's working directory
is api/, so a workspace-root .env is out of its reach regardless; and Node's
--env-file-if-exists, which would have been a one-liner, was added in v22.9.0
while package.json declares ">=20.11". process.loadEnvFile is v20.10.0 and
holds that line. Plain --env-file was not an option either — it THROWS on a
missing file, which is precisely the CI and production case.

Precedence is deliberate and matches in both places: a real environment
variable always wins and the file only fills gaps, so a stray .env on a
deployed box cannot override configured settings. Proven by starting the API
with PORT=4099 against a .env saying 4000, and getting 4099.

A GitHub Actions workflow was written alongside this and is held back on the
branch `ci-workflow`: pushing a file under .github/workflows/ needs the
`workflow` OAuth scope, which the current gh login does not carry. It lands as
its own commit once that is granted. 144 tests exist and still run only when
someone remembers to run them.
**Decisions:** none needing an ADR. No dependency added (AGENTS.md), no
schema change, no contract change.
**Docs touched:** none — the README's instructions were already correct on
paper; the code now matches them.
**Tests:** existing 61 unit + 83 integration, all passing, plus a from-scratch
run of the documented setup against a wiped volume with no exported
environment. Lint and typecheck clean.

### 2026-09-14 — ADR-008 and a development seed
**What:** Recorded ADR-008 (case access), and added api/scripts/seed.ts behind
`npm run db:seed`, creating admin@ / reviewer@ / customer@kycflow.test. Also
added `scripts` to tsconfig.typecheck.json's include.
**Why:** the staff dashboard could not be signed into AT ALL. Registration
only ever creates a CUSTOMER — auth.service.ts refuses a caller-supplied role,
which is correct and must stay — and POST /api/admin/employees is M5. So a
clone of this repository can reach the customer app and simply cannot reach
the review queue. The only EMPLOYEE rows in existence were residue the
integration suite leaves behind, which is not something to rely on and not
something a colleague would ever find. That is a bad first five minutes for a
new contributor and a worse one in front of a bank.

The seed REFUSES to run when NODE_ENV=production, and deliberately has no flag
to override that. It installs a known, published password on three accounts;
against a production database that is a backdoor rather than test data. It
also resets rather than skips on re-run, so a seeded environment is in a known
state afterwards including its passwords, and it writes audit rows for what it
creates because "every action is audited" should not have a quiet exception
for the one actor that creates administrators.

tsconfig.typecheck.json included only src, test and the vitest configs, so
anything under scripts/ was never typechecked — seed.ts was passing by being
ignored rather than by being correct. Adding scripts to the include closes
that; the build config is untouched, so nothing new lands in dist (verified).

ADR-008 settles case access, which the cases slice cannot start without:
assignee-only visibility, automatic assignment at creation to the least-loaded
active employee, ADMIN reassignment and full visibility. The ADMIN view is not
a convenience — under assignee-only an unassigned case is invisible to every
employee, so without it work does not queue, it disappears.
**Decisions:** ADR-008. Notably that assignment is recorded in audit_log
rather than case_events: case_events is CHECK-constrained to
request_info/approve/reject/note, and an assignment is not a decision about
the customer. This keeps the whole cases slice free of any schema change.
**Docs touched:** docs/adr/session-cookies.md (ADR-008 plus its index row).
**Tests:** seed verified three ways — re-run resets without duplicating (3
rows, not 6), NODE_ENV=production is refused, and all three accounts return
200 from POST /api/auth/login. Existing 61 unit + 83 integration still pass;
lint, typecheck (now including scripts) and build all clean.

### 2026-09-14 — Invariant 10 enforced, and a deployment path
**What:** Added ALLOW_MOCK_PROVIDERS_IN_PROD and a superRefine on EnvSchema
that refuses to start under NODE_ENV=production while any provider is a
simulator. Added render.yaml and docs/deployment.md for a Vercel (front ends)
/ Render (API) / Neon (PostgreSQL) deployment.
**Why:** invariant 10 and docs/provider-adapters.md both promised that the API
"refuses to boot with mock providers when NODE_ENV=production unless
ALLOW_MOCK_PROVIDERS_IN_PROD is explicitly set". No such code existed — the
variable appeared nowhere outside prose, and the only NODE_ENV==='production'
branch in the codebase sets `trust proxy`. Every provider DEFAULTS to mock, so
a production deploy that merely forgot to configure them would have booted
happily and issued simulated verdicts against real identity documents. That is
precisely the failure the invariant exists to prevent, and it was one unset
variable away. Found while planning a public deployment, which is exactly the
situation that would have triggered it.

The check lives in the schema rather than in index.ts so no future entry point
— a worker, a script, a serverless handler — can skip it by forgetting to
call it. ALLOW_MOCK_PROVIDERS_IN_PROD is an enum and not z.coerce.boolean()
for the same reason RATE_LIMIT_ENABLED is: coercion reads the string "false"
as truthy, and a safety catch that silently disengages when someone writes
false is worse than no catch at all. There is a test asserting exactly that.

Typecheck caught test/helpers.ts missing the new key — the suite itself stayed
green, because vitest does not typecheck. Worth noting as the reason the
separate typecheck step earns its keep.

The deployment splits deliberately. The API stays a long-running Express
process on Render because that is what it is: it binds a port, holds a pool,
keeps rate-limit counters in memory and drains on SIGTERM. Putting it on a
serverless platform would mean rewriting the entry point as a request handler
and would break the login rate limiter, which is a security control rather
than a convenience. Only the two Next.js front ends go to Vercel, where the
existing rewrite keeps the browser on ONE origin so the session cookie stays
first-party and ADR-005 holds with no CORS anywhere.
**Decisions:** none new — this implements ADR-004 and invariant 10 as already
written, rather than deciding anything. No dependency added, no schema change.
**Docs touched:** .env.example (two new variables), docs/deployment.md (new).
**Tests:** six new config tests — refusal under production, every offending
provider named rather than just the first, boot permitted once providers are
real, override honoured, the string "false" treated as off, development left
alone. 67 unit + 83 integration pass; lint, typecheck and build clean. Also
verified by actually booting the API: NODE_ENV=production refused with
"Check these keys: PAN_PROVIDER, OCR_PROVIDER, STORAGE_PROVIDER", and started
normally with the override set.

### 2026-09-14 — Fix the Render build: devDependencies, and a silent failure
**What:** render.yaml now runs `npm ci --include=dev`, and
api/scripts/migrate.mjs checks for its binary and for DATABASE_URL before
spawning, reporting what is wrong instead of exiting 1 with no output.
**Why:** the first Render build failed. Render applies the service's envVars at
BUILD time as well as runtime, so NODE_ENV=production was set while `npm ci`
ran, and npm omits devDependencies when it sees that. node-pg-migrate,
typescript and tsx all live there — 186 packages short, so the migrate step
could not find its binary and `npm run build:api` would have failed next for
the same reason. Render installed 116 packages where a local install produces
302, which was the tell.

The worse half was mine. migrate.mjs called spawnSync and checked only
`result.status`, but a missing binary surfaces on `result.error` as ENOENT
rather than by throwing — so the script exited 1 having printed nothing at
all. The build log showed npm's wrapper error and no cause. A script that
fails silently costs more than the bug it hides, so it now checks existsSync
on the binary, checks DATABASE_URL, and reports result.error explicitly.

Reproduced locally before fixing rather than reasoning about it: NODE_ENV=
production npm ci gives 112 packages here against Render's 116, and the
migrate step then fails with exactly the same shape. After the fix the whole
buildCommand chain exits 0 against the live Neon database.
**Decisions:** none. No dependency added, no schema change, no contract change.
**Docs touched:** none — docs/deployment.md already described the sequence
correctly; only the command needed the flag.
**Tests:** 67 unit + 83 integration pass, lint and typecheck clean. The build
chain was verified twice: failing the way Render failed, then succeeding with
--include=dev, both with NODE_ENV=production set. The local .env path still
works unchanged.

### 2026-09-23 — `npm run db:migrate` could never have worked on Windows
**What:** api/scripts/migrate.mjs now spawns node-pg-migrate's own JS entry
point with `process.execPath`, instead of spawning the extensionless shim in
node_modules/.bin. The entry path is read from the package's `bin` field rather
than hardcoded, and both the workspace root and api/node_modules are searched
so a non-hoisted install still resolves.
**Why:** the shim in .bin has no file extension. On Linux its shebang makes it
executable, which is why Render has always been fine. On Windows CreateProcess
has nothing to run it with and spawnSync fails ENOENT — so step 4 of the
README's setup, `npm run db:migrate`, failed for every Windows clone. The
obvious repair is worse than it looks: reaching for the .cmd shim beside it
gives EINVAL instead, because Node has refused to spawn .cmd/.bat without
shell: true since 18.20/20.12 (CVE-2024-27980), and shell: true would then
need every argument quoted against paths containing spaces. Spawning the JS
entry with the current node binary avoids the shell on every platform.

Worth noting what hid this. The previous commit fixed a DIFFERENT failure in
the same three lines — a missing binary reported on result.error rather than
by throwing — and its existsSync check passes here, because the shim really is
present. The script found the file and then could not execute it, which is a
failure mode the check was never looking for. A green check next to a red
outcome is why this needed running rather than reading.
**Decisions:** none. No dependency added, no schema change, no contract change.
ADR-008 already settles case access; nothing here touches it.
**Docs touched:** none — the documented command is unchanged, it now works.
**Tests:** 67 unit + 83 integration pass, typecheck and lint clean. The fix was
verified on Windows four ways rather than by reasoning: the success path against
the live database; the missing-DATABASE_URL path still reporting both lines; and
a migration applied from scratch against a throwaway `migrate_probe` database,
which produced 11 tables and 7 triggers before being dropped. The pre-existing
failure was reproduced first, and the .cmd alternative was measured as EINVAL
rather than assumed.

### 2026-09-23 — Case custody enforced in the database (ADR-009)
**What:** a second migration, 1790158447000_case-custody-audit. An AFTER INSERT
OR UPDATE trigger on review_cases writes a 'case.custody.changed' row to
audit_log whenever assigned_to or status changes. Seven integration tests.
**Why:** ADR-008 made review_cases.assigned_to the access-control predicate, so
that one nullable column decides who may read a customer's PAN, date of birth
and address — and review_cases was the only table on the case path with no
trigger at all. Any UPDATE could move a case to a different reader with nothing
left behind. ADR-008 says audit_log absorbs assignment events and the
application does write them, but that is a promise the CALLER keeps, and every
other guarantee in this schema is one the DATABASE keeps. M1's worker, a
maintenance script and a future handler all touch this column and none of them
is covered by a promise made in ADR-008.

The trigger deliberately does not name the actor. A trigger sees a row, not a
request, and identifying the employee would need the application to set a
session variable first — so a path that forgot would report NULL exactly when
it mattered. An unattributed truth that cannot be skipped beats an attribution
that can. Two rows per assignment, answering different questions.

Unplanned dividend, verified rather than hoped for: assigned_to is ON DELETE
SET NULL, and PostgreSQL performs that referential action as an UPDATE, so the
trigger fires. Deleting an employee writes assigned_from = them, assigned_to =
null. That is the gap ADR-008 flagged and deferred to M5, closed for free.
**Decisions:** ADR-009. Second migration, deliberately separate: enforcement
should land BEFORE the cases slice depends on it, not alongside it.
**Docs touched:** docs/adr/session-cookies.md (ADR-009), docs/db-schema.md.
**Tests:** 67 unit + 90 integration (was 83) pass, typecheck and lint clean.
Migration down/up round-tripped: trigger count 0 after down, 1 after up.

One test failed first and the trigger was not at fault. It asserted on the LAST
custody row, but audit_log.created_at defaults to now() — the TRANSACTION
timestamp — so every row this file writes carries the same instant and the only
tiebreak left is a random UUID. The assertion passed or failed by luck. This is
the same now() trap already recorded in current-milestone.md, met from a new
direction: not "the timestamp did not advance" but "ordering by it is not an
ordering". Checked against the database directly before touching anything, which
showed the trigger emitting exactly the right two rows; the assertions are now
order-independent and say why.

### 2026-09-24 — The RBI rules this is actually built against
**What:** docs/rbi-compliance.md — the KYC Master Direction (as updated 14 August
2025) plus the 12 June 2025 periodic-updation revision, mapped paragraph by
paragraph onto this codebase, with an honest list of what is not satisfied.
Added to the README doc map, along with deployment.md which had been missing
from it since it was written.
**Why:** the product is being shown to a bank, and until now nothing in the
repository named the regulation it claims to serve. Written as a MAP rather
than a transcription: a copy of the Direction is available from RBI and is more
authoritative than anything here, whereas "which paragraph does this column
answer to, and which ones does nothing answer to" is the thing only we can
write.

Two findings changed how the rest of the work should be read.

Para 8(b) says KYC decision-making shall not be outsourced. That is the
regulatory basis for the golden line rules-engine.md already held on
engineering instinct — evidence from models, decisions from rules, with
reasons. It means verification_checks.reason being NOT NULL is a compliance
artefact rather than good manners, and that an opaque score would not merely be
poor design, it would put the decision function somewhere a bank is not
permitted to put it.

Para 40 is the one that stings. Everything here is non-face-to-face onboarding,
so para 40 governs the whole product, and it requires such customers to be
categorised HIGH RISK with enhanced monitoring. The schema has no notion of
risk category at all. Para 12 additionally makes the category confidential and
not to be revealed to the customer, which is a hard constraint on any future
API response rather than a policy note. Nothing in the milestone plan covers
either.

Also worth recording because it inverts something the project has been carrying
as debt: "a consented customer cannot be deleted" is not a defect. Para 46
requires identification records to be kept at least five years AFTER the
relationship ends, which is incompatible with unconditional erasure, and
encoding that refusal in the database beats trusting an application to remember
it. It stays a position the bank must own in its privacy notice, and the
cascade is wider than first recorded - customer, application, case and the
acting employee are all undeletable once a case event exists.
**Decisions:** none - this records external constraints rather than choosing
anything. No ADR, because nothing here is ours to decide. The two gaps it
surfaces (risk categorisation, Form 60) are legal preconditions rather than
features and want a plan change, which is a separate conversation.
**Docs touched:** docs/rbi-compliance.md (new), README.md (doc map).
**Tests:** none - documentation only, and no code was touched. Unit tests and
lint re-run clean; the integration suite was not re-run for this commit and
stands as verified at ca51fe1. Sourced from rbi.org.in primary documents rather
than from commentary; paragraph numbers move between amendments and the
document says so.
