# Coding Agent Workflow

Follow this workflow for every code or configuration change in this repository.

1. Before making changes, create a new JIRA ticket in the `DEV` project and
   associate it with an existing Epic. Do not reuse an existing ticket. If you
   cannot create or associate the ticket, stop and ask for the required access
   or Epic; do not make the change.
2. Create a changeset entry for every change with `pnpm changeset`. Select the
   affected package(s) and an appropriate release type. Do not omit a
   changeset for documentation, configuration, or internal changes.
3. Use Conventional Commits for every commit, with the JIRA ticket ID prefix:
   `[DEV-123] type(scope): short description`.

Allowed Conventional Commit types include `feat`, `fix`, `docs`, `refactor`,
`test`, `chore`, `build`, `ci`, `perf`, `style`, and `revert`. The scope must
identify the affected service or package where one exists. For example:

```text
[DEV-100] feat(@ownmail/app): add dashboard overview page
```

Before committing, verify that the new changeset file is included in the
commit and that the commit subject matches the required format.

Automated Changesets version commits created by `.github/workflows/release.yml`
are exempt from the new-ticket and JIRA-prefix requirements. They must use the
subject `chore(release): version packages`.
