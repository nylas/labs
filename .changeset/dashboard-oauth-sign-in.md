---
"ownmail": minor
"@nylas-labs/cli-kit": minor
---

Sign in to Nylas on the dashboard login page. `npx ownmail` and `ownmail auth login` now open the Nylas dashboard in your browser instead of asking how you sign in: log in with any method the dashboard offers (email and password, Google, Microsoft, GitHub or Enterprise SAML, with MFA if you use it) or create a free account there, then approve OwnMail. The terminal no longer asks for your Nylas password or authenticator code. If you belong to several organizations, you choose the one that owns the mailbox on that page; to use a different one later, run `ownmail auth login` again. A session saved by an earlier version keeps working until it ends. `@nylas-labs/cli-kit` adds `createOAuthPkcePair`, `DASHBOARD_SESSION_OAUTH_SCOPE` and the `oauthAuthorizeUrl`, `oauthToken`, `oauthRefresh` and `oauthExchange` methods on `DashboardAccountClient`.
