# Coding Agent Workflow

Follow this workflow for every code or configuration change in this repository.

1. Before making changes, find an open JIRA ticket in the `TW` project that is
   associated with the `TW-5882` Epic and directly covers the work. If none
   applies, create a new `TW` ticket and associate it with `TW-5882`. Do not
   reuse an unrelated ticket. If you cannot create or associate the ticket,
   stop and ask for the required access or Epic; do not make the change.
2. Create a changeset entry with `pnpm changeset` only when a change alters
   customer-facing behavior in a published package, such as its public API,
   CLI, configuration, or user-visible behavior. Select the affected package(s)
   and an appropriate release type. Do not create a changeset for documentation,
   CI, tooling, repository configuration, tests, policy, release automation, or
   internal refactors unless they directly change customer-facing package
   behavior.
3. Use Conventional Commits for every commit, with the JIRA ticket ID prefix:
   `[TW-123] type(scope): short description`.

Allowed Conventional Commit types include `feat`, `fix`, `docs`, `refactor`,
`test`, `chore`, `build`, `ci`, `perf`, `style`, and `revert`. The scope must
identify the affected service or package where one exists. For example:

```text
[TW-100] feat(@ownmail/app): add dashboard overview page
```

Before committing, when a changeset is required, verify that it is included in
the commit and that the commit subject matches the required format.

4. Before every commit, run `pnpm lint` from the repository root. Do not commit
   if it exits non-zero. If the command reports warnings, record their count in
   the handoff and do not describe them as lint errors unless they fail the
   command. Re-run `pnpm lint` after any lint fix before committing.
5. Keep delivery moving visibly. Do not leave an interactive command (for
   example, `pnpm changeset`) awaiting input across turns: complete it, cancel
   it safely, or immediately report the precise blocker. For multi-part work,
   ship each coherent, validated increment promptly rather than waiting for all
   remaining work. A shipped increment means: run its relevant checks, commit,
   push, and open a draft GitHub PR unless the user explicitly says not to.
   Report progress at each validation, PR, and deployment milestone; never
   describe work as shipped until those actions have actually completed.

Automated Changesets version commits created by `.github/workflows/release.yml`
are exempt from the new-ticket and JIRA-prefix requirements. They must use the
subject `chore(release): version packages`.
