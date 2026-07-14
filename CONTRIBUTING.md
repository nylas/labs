# Contributing to Nylas Labs

Thanks for helping shape what Nylas ships next. Labs is intentionally
lightweight — the bar is "does this make the experiment better?"

## Ways to contribute

- **Feedback beats code.** Trying a lab and writing up what confused you in a
  [discussion](https://github.com/nylas/labs/discussions) is the single most
  valuable contribution.
- **Bugs**: use the bug template; include the lab name and, for CLI labs, the
  command output (secrets are shown once and never logged — don't paste them).
- **Pull requests**: welcome for any lab. Keep changes scoped to one lab (or
  `shared/*`), and remember the golden rule: **no lab→lab imports**.
- **New lab ideas**: open a lab proposal issue first — a maintainer will help
  you scope it before you scaffold with `pnpm create-lab`.

## Development

```bash
pnpm install
pnpm build          # turbo build across packages
pnpm test           # vitest
pnpm lint           # biome (pnpm lint:fix to auto-fix)
pnpm typecheck
```

- Node ≥ 20, pnpm 10.
- Before making a change, create a new JIRA ticket in the `DEV` project and
  associate it with an Epic. Each change requires its own ticket; do not reuse
  an existing ticket.
- Every commit must use Conventional Commits with its JIRA ticket ID prefix:
  `[DEV-123] type(scope): short description`. The scope identifies the affected
  service or package where one exists. For example:
  `[DEV-100] feat(@ownmail/app): add dashboard overview page`.
- Every change requires a changeset entry: run `pnpm changeset`, select the
  affected package(s), and commit the generated file with the change.

### Test coverage (ownmail)

The `ownmail` lab (`labs/ownmail/packages/*`) is held to **100% test coverage**.
This is enforced, not aspirational: each package's vitest config sets 100%
thresholds for statements, branches, functions, and lines, and CI runs coverage
on every PR. A change that drops any file below 100% fails the build.

```bash
pnpm --filter ownmail coverage            # CLI package
pnpm --filter @ownmail/app coverage       # deployed app package
```

If you add code, add the tests that cover it. The only permitted exclusions are
declared (with rationale) in each package's `vitest.config.ts` — generated files
(`routeTree.gen.ts`), ambient type declarations (`env.d.ts`), and the CLI's
`bin` entrypoint. Do not add exclusions to dodge writing a test.

## Lab lifecycle

🧪 Experiment → 🚀 Graduated (own repo, supported product) or 🗄 Archived.
Maintainers decide graduation based on usage and community signal — which is
to say: your feedback is the roadmap.

## Code of conduct

Be excellent to each other. Harassment, hate, or spam gets you removed.
