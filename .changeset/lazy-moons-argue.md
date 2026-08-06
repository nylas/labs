---
"@ownmail/app": patch
---

Fix sign-in failing on every attempt with "could not reach the Nylas connect endpoint". The server-side credential POST asked for `redirect: 'error'`, which Cloudflare's workerd runtime rejects when the request is constructed — before any network call — so the error looked like a provider outage rather than a runtime rejection. The request now uses `redirect: 'manual'`, which hands a redirect back unfollowed for the existing status check to reject, so credentials are still never replayed at a redirect target.
