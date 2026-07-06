# Nylas Labs

Incubator monorepo for experimental Nylas products ("labs"). Each lab lives in its own
self-contained folder under `labs/` and is designed to graduate into a standalone repo
once it picks up traction.

## Layout

```
shared/            Cross-lab packages, published to npm as @nylas-labs/*
labs/<name>/       One folder per lab project (packages/, docs/, README.md)
```

## Current labs

| Lab | What it is | Published packages |
|---|---|---|
| `ownmail` | `npx ownmail` — deploy a full mailbox + calendar app on your own domain, powered by Nylas Agent Accounts | `ownmail`, `@ownmail/template` |

## Legacy content (pre-incubator)

`apps/`, `packages/`, `postman/`, `docker-compose.yml`, `package-lock.json`, and
`tsconfig.json` predate the incubator layout (the recruiting-applets MCP monorepo,
npm workspaces). They are untouched and still install/run from their own
directories; migrating them into `labs/applets/` is a follow-up.

## Graduation rules

These keep every lab extractable with a clean `git subtree split` / `git filter-repo`:

1. **No lab→lab imports.** A lab may import only from its own folder and from `shared/*`.
2. **`shared/*` packages are published to npm** (`@nylas-labs/*`), so a graduated repo
   swaps `workspace:*` for published semver and nothing else changes.
3. **Changesets are scoped per lab** (fixed version group per lab). CI pipelines filter by
   `labs/<name>/**` so labs build and release independently.
4. **Graduating** = split `labs/<name>` history into a new repo, keep the npm names,
   archive the folder here with a pointer.

## Development

```bash
pnpm install
pnpm build         # turbo build across all packages
pnpm test
pnpm lint
```

Node >= 20, pnpm 10.
