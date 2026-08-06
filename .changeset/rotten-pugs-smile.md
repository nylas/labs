---
"@ownmail/app": patch
---

Keep signed-in mailboxes signed in: on deployments with shared storage (Cloudflare KV, or Vercel with its Upstash Redis resource) the session deadline now slides forward on activity instead of expiring 14 days after the first login. Netlify and local deployments keep sessions in a signed cookie with nothing server-side to revoke, so a refreshed cookie could outlive a sign-out; they keep the fixed 14-day window running from the last sign-in. Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to enable sliding sessions there.
