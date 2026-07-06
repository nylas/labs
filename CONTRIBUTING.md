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
- Commits: `[TICKET] type(scope): message` if you have a JIRA ticket; plain
  `type(scope): message` is fine for community PRs.
- Every published-package change needs a changeset: `pnpm changeset`.

## Lab lifecycle

🧪 Experiment → 🚀 Graduated (own repo, supported product) or 🗄 Archived.
Maintainers decide graduation based on usage and community signal — which is
to say: your feedback is the roadmap.

## Code of conduct

Be excellent to each other. Harassment, hate, or spam gets you removed.
