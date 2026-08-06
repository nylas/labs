---
"@ownmail/app": minor
---

Sign in from OwnMail's own login form instead of the Nylas-hosted credential screen. Credentials are posted server-side and every rejected credential returns one generic message.

Sign-in attempts are rate-limited per mailbox and per client address, using an atomic counter on every path so a parallel burst cannot slip past: Cloudflare deployments use two new edge rate-limit bindings (`SIGNIN_EMAIL_LIMITER`, `SIGNIN_IP_LIMITER`, declared in `wrangler.jsonc` and carried through by `ownmail deploy` — no account resource to provision), and Redis-backed deployments use `INCR` with a separate `EXPIRE`. Cloudflare KV is deliberately not used for counting: it has no atomic increment and is eventually consistent. Two limitations are worth knowing: Cloudflare's binding supports only a 10s or 60s period, so the Workers budgets are per minute rather than per 15 minutes, and it is enforced per Cloudflare location rather than globally. A deployment with neither an edge limiter nor Redis falls back to per-instance counting, which bounds an attack against a single instance but not the deployment as a whole.
