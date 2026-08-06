---
"ownmail": patch
---

Keep the sign-in rate-limit bindings when ejecting. `ownmail eject` built `wrangler.jsonc` from scratch and never declared `SIGNIN_EMAIL_LIMITER` / `SIGNIN_IP_LIMITER`, so an ejected project lost the only atomic brute-force control in front of sign-in and silently fell back to per-instance counting. The bindings are now read from the one place they are declared — the template's `wrangler.jsonc`, via the config its Cloudflare build emits, which is the same file `ownmail deploy` patches — so eject and deploy cannot drift. A build that declares none is a hard error, checked before eject mints a key or writes a file.
