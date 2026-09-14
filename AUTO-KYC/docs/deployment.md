# Deploying the demonstration

Three pieces, because the dashboards are only front ends: they proxy every
`/api/*` call to the API, which needs a database. Deploy the front ends alone
and you get two sign-in pages that cannot sign anyone in.

| Piece | Host | Why there |
| --- | --- | --- |
| `web-customer`, `web-employee` | Vercel | Next.js apps; Vercel is already connected to this repository on GitHub |
| `api` | Render | A long-running Express process — binds a port, holds a pool, keeps rate-limit counters in memory, drains on SIGTERM. Render runs it as built; a serverless platform would require rewriting it as a request handler and would break the rate limiter |
| PostgreSQL | Neon | Managed, and `pg` honours `sslmode=require` from the connection string with no code change |

The order matters: **database, then API, then front ends**, because each needs
the URL of the one before it.

## Read this before you start

This deployment runs entirely on **simulators**. No PAN lookup, no OCR, no real
verification of anything — that is M1 and M2. AGENTS.md invariant 10 says a
simulated result must never be mistakable for a real one, and the API now
enforces it: with `NODE_ENV=production` it refuses to start while any provider
is a simulator, unless `ALLOW_MOCK_PROVIDERS_IN_PROD=true` says out loud that
this is a demonstration.

That refusal is the safety catch. It is not a formality:

- The deployed customer app is **public**. Anyone who finds the URL can enter a
  real name, date of birth, PAN and address into it.
- Nothing is encrypted at rest beyond whatever the host provides.
- `consents` is append-only and `consents.user_id` is `ON DELETE RESTRICT`, so
  **a customer who consents cannot then be deleted**. This schema cannot honour
  an erasure request. Defensible for statutory KYC retention; indefensible as a
  surprise on a public demo.

Use invented data, restrict who has the URL, or turn on Vercel's Deployment
Protection. Do not put a real customer's documents through this.

## 1. Database — Neon

Create a project, then copy the **pooled** connection string (it contains
`-pooler` and ends `?sslmode=require`). Pooled matters: the API opens up to ten
connections per instance (`api/src/db/pool.ts`), and Neon's direct endpoint has
a far lower ceiling than its pooler.

## 2. API — Render

Render reads `render.yaml` at the repository root.

1. **New → Blueprint**, pick this repository.
2. Set `DATABASE_URL` to the Neon string when prompted. It is the only value
   marked `sync: false`; everything else is in the blueprint.
3. Deploy. The build runs `npm ci && npm run db:migrate && npm run build:api`,
   so the schema is created on the first deploy. Migrations are idempotent, so
   later deploys report "No migrations to run!".
4. Health check is `/api/health/ready`, which answers only once PostgreSQL
   does. Confirm it returns `{"status":"ready","db":"up"}`.

Note the free plan sleeps when idle, so the first request after a quiet period
takes a few seconds. Warm it before a demonstration.

## 3. Front ends — Vercel

Two projects from the same repository. For each:

1. **Add New → Project**, import `AUTO-KYC`.
2. Set **Root Directory** — this is the step people miss on a monorepo:
   - `AUTO-KYC/web-customer`
   - `AUTO-KYC/web-employee`
3. Add one environment variable: `API_ORIGIN` = your Render URL, e.g.
   `https://kycflow-api.onrender.com`. No trailing slash.
4. Deploy.

`next.config.ts` rewrites `/api/*` to `API_ORIGIN` **server-side**, so the
browser only ever sees the Vercel origin. That is what keeps the session cookie
first-party and `SameSite=Lax` honest (ADR-005), and it is why no CORS
configuration is needed anywhere. Do not "fix" this by calling the API origin
directly from the browser — it would force `SameSite=None` and a CORS policy,
which this design deliberately does not have.

## 4. Accounts

`npm run db:seed` refuses to run when `NODE_ENV=production`, deliberately and
with no override: it installs a known password on three accounts, which is test
data locally and a backdoor anywhere else.

To create staff on the deployed database, run it locally against Neon **with a
password of your own**:

```bash
cd AUTO-KYC
DATABASE_URL='<neon pooled string>' SEED_PASSWORD='<something private>' npm run db:seed
```

Never seed a public deployment with the default password. The default exists so
a local clone works in one command; on a public URL it is a published login.

## What is not solved by deploying

- **Rate limiting is per-instance and in memory** (`api/src/http/rate-limit.ts`
  says so itself). One Render instance is fine. Scale beyond one and the login
  limiter — the control that makes online password guessing impractical —
  multiplies by instance count. Move it to a shared store before scaling.
- **No password reset.** Registration is deliberately silent, so re-registering
  an address you already own returns 202 with the password unchanged and no way
  forward. On a public URL, ordinary users will hit this.
- **The review queue will be empty.** `GET /api/cases` is M0 slice 5 and does
  not exist yet; cases are created by the M1 verification worker. The staff
  dashboard says so plainly rather than inventing rows.
