<img src="./assets/banner.svg" alt="Nylas Labs — tomorrow's products, shipped in public" width="100%" />

# Nylas Labs

**Where Nylas ships tomorrow's products — in public.**

Labs is the incubator where we turn "what if…" into things you can `npx` today.
Every lab is a real, working product built on the Nylas platform: try it in
minutes, tell us what's broken, and watch the ones that resonate graduate into
fully supported Nylas products.

No roadmap theater. If a lab is here, you can run it right now.

## 🧪 Current labs

| Lab | One command | What you get | Stage |
|---|---|---|---|
| [**OwnMail**](./labs/ownmail) | `npx ownmail` | A full mailbox + calendar app on **your own domain**, deployed to **your own Cloudflare account**. Your inbox. Your domain. No per-seat fees. | 🧪 Experiment |

### Stages

| Badge | Meaning |
|---|---|
| 🧪 **Experiment** | Actively exploring — APIs and UX change without notice |
| 🚀 **Graduated** | Proven — moved to its own repo as a supported Nylas product |
| 🗄 **Archived** | The experiment answered its question; code stays for reference |

## ⚡ Try a lab in 60 seconds

```bash
npx ownmail
```

That's it — the wizard signs you up, claims your free `you.nylas.email` domain
(or verifies your own), creates your inbox, and deploys your app. See the
[OwnMail quickstart](./labs/ownmail/docs/quickstart.md).

## 💬 Get involved

Labs live or die on your feedback:

- **Try one** and [start a discussion](https://github.com/nylas/labs/discussions) — what clicked, what didn't?
- **File a bug** with the [issue templates](https://github.com/nylas/labs/issues/new/choose)
- **Propose a lab** — pitch the product you wish existed with the
  [lab proposal template](https://github.com/nylas/labs/issues/new/choose)
- **Contribute** — see [CONTRIBUTING.md](./CONTRIBUTING.md)

> **Support status:** labs are experiments, not yet covered by Nylas support
> SLAs. Graduated products get full support. Feedback here directly decides
> what graduates.

## 🛠 Spin up a new lab

Everything a lab needs — workspace wiring, TypeScript, tests, per-lab CI,
README with a generated banner — in one command:

```bash
pnpm create-lab my-idea "One line that sells it"
```

Banners for the repo and each lab are generated (as diff-friendly SVG) with:

```bash
pnpm banner              # repo banner → assets/banner.svg
pnpm banner my-idea "…"  # lab banner  → labs/my-idea/assets/banner.svg
```

## 🏗 How this repo works

```
shared/            Cross-lab packages, published as @nylas-labs/*
labs/<name>/       One folder per lab (packages/, docs/, assets/, README.md)
scripts/           create-lab + banner generators
```

Rules that keep every lab one `git subtree split` away from graduation:

1. **No lab→lab imports** — a lab may import only from itself and `shared/*`.
2. **`shared/*` is published to npm**, so a graduated repo swaps `workspace:*`
   for real versions and nothing else changes.
3. **Changesets are scoped per lab**; CI path-filters mean labs build, test,
   and release independently.
4. **Graduation** = split the folder's history into a new repo, keep the npm
   names, leave a pointer behind.

## Development

```bash
pnpm install
pnpm build && pnpm test && pnpm lint
```

Node ≥ 20, pnpm 10. Powered by the [Nylas](https://www.nylas.com) platform —
email, calendar, and contacts APIs, plus [Agent
Accounts](https://developer.nylas.com/docs/v3/agent-accounts/).

## License

[MIT](./LICENSE)
