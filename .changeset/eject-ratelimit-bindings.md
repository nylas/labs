---
"ownmail": patch
---

Keep the sign-in rate-limit bindings when ejecting. `ownmail eject` regenerated `wrangler.jsonc` from scratch and omitted the `ratelimits` array, so an ejected project silently lost `SIGNIN_EMAIL_LIMITER` and `SIGNIN_IP_LIMITER` and fell back to per-instance attempt counting. Eject now reads the bindings from the same built template config that `deploy` patches, so the two can no longer drift.
