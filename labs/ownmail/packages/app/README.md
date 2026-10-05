# @ownmail/app

The ready-to-use mail, calendar, and contacts web app behind
[OwnMail](https://www.npmjs.com/package/ownmail). OwnMail creates an email
address on a domain you control—or a Nylas-provided `nylas.email` trial
subdomain—then deploys this app to your Cloudflare, Vercel, or Netlify account,
or runs it on a local Node server. Nylas hosts the mailbox service through
Agent Accounts.

This is the customizable half of OwnMail: a complete app codebase for
developers who want their inbox to look, behave, and deploy their way.

![OwnMail's local mock inbox with The Dispatch open, divided diagonally between light and dark modes](https://cdn.jsdelivr.net/npm/ownmail@0.2.0/assets/screenshots/ownmail-mail-modes.png)

Most people should start with the CLI:

```bash
npx ownmail
```

The CLI provisions the required Nylas resources, configures the chosen runtime,
then deploys or starts this app. Reach for this package directly when you want
to develop, customize, or host an ejected OwnMail app yourself.

Cloudflare uses its bound KV namespace for sessions and realtime counters.
Guided Vercel deployments use an Upstash Redis resource connected through the
Vercel Marketplace. Other Node deployments remain stateless unless both
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured. Shared
storage is required for sliding sessions: with it, the 14-day session window
moves forward on activity; without it there is no server-side record a sign-out
could revoke, so the window stays fixed from the last sign-in.

Sign-in uses `@nylas/connect` to start the authorization flow. OwnMail exchanges
the callback code and stores the verified grant in its server-owned session, so
API credentials and bearer tokens are never persisted in browser storage.

## Start simple, then take control

```bash
ownmail app eject ./my-ownmail
cd my-ownmail
pnpm install
pnpm dev
```

That starts the ejected project's own development server. Configure the
environment values in `.env.example` before exercising the real Nylas flow.
The repository-only mock UI is available from the repository root below.

## Documentation

- [OwnMail quickstart](https://github.com/nylas/labs/tree/main/labs/ownmail/docs/quickstart.md)
- [Source and local-development guidance](https://github.com/nylas/labs/tree/main/labs/ownmail#local-development)
- [Changelog](https://github.com/nylas/labs/blob/main/labs/ownmail/packages/app/CHANGELOG.md)

## Local development

From the repository root, start the UI with local mock data:

```bash
pnpm --filter @ownmail/app dev:ui
```

For a real Nylas integration, configure the environment variables documented
in the quickstart and run:

```bash
pnpm --filter @ownmail/app dev:local
```

Do not commit credentials or deployment secrets. Production secrets belong in
your hosting provider's secret manager.

## License

[MIT](https://github.com/nylas/labs/blob/main/LICENSE)

### Diagnosing slow loads and unavailable images

Cloudflare Workers Observability is enabled by the deployment template. In the
Worker's Observability view, filter structured console events by `event`:
`image.failed`, `mailbox.failed`, or `session.failed`. Failed image responses
include an `X-Request-ID`; filter `requestId` by that value to correlate the
failure without copying the signed image URL. Events include the release,
failure stage, bounded reason code, duration, and upstream HTTP status when
available. Public errors remain generic.

Image reasons distinguish token validation, DNS, blocked destinations, transport,
upstream status, redirect limits, size limits, timeouts, and processing. For a
reported sender (for example a Google account notification), first identify the
actual image host privately and reproduce through the deployed Worker. An email
sender address alone does not identify its image host or prove provider blocking.
Never paste signed image URLs, token payloads, email HTML, or response bodies into
logs or bug reports. Remote transfers and inline attachment reads are bounded by
8 seconds and 8 MiB; tracking protection and destination checks remain active.

Platform invocation logs may capture request URLs independently of application
logging. Signed image paths contain sensitive data: restrict access and retention
and disable invocation URL logging where required. Application events intentionally
omit URLs, cookies, account identifiers, and arbitrary exception messages.

Each server request also includes `X-Request-ID` and `Server-Timing` for request
handling and any session, KV, renewal, mailbox, folder, or thread work completed
before headers are sent. Deferred work can finish after those headers; compare
these timings with browser `ttfb`, `hydration`, `inbox_ready`, and `lcp` metrics.
`request.completed` measures response creation, not completion of a streamed body.

Browser performance reporting samples 10% of document loads. The authenticated,
same-origin `/api/diagnostics` endpoint accepts only bounded metric names, numeric
values, and an installed-app flag; it caps payloads at 512 bytes and logging at
60 reports per minute per running isolate. `browser.performance` events also
include a release version. LCP is reported on page hide when supported. Missing
reports can mean sampling, an unsupported browser API, or the logging budget;
they do not imply a successful or fast load. Client and background sync failures
report counts only, without exception messages or stacks.

For iOS acceptance, compare repeated cold and warm homescreen launches and Safari
loads on the same device/network. Record p75 LCP (target <=2.5 seconds), TTFB,
inbox readiness, and whether useful loading feedback appears. Authentication
remains mandatory before mailbox data is streamed. Session validation is shared
only inside one HTTP request; optional display-name lookup moves off the initial
path, and folder/thread requests start concurrently. No private mailbox data is
persisted in a service-worker cache. Evaluate that additional caching only after
these measurements identify a remaining startup bottleneck.
