import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as p from '@clack/prompts'
import { loadManifest, templateRoot } from '../deploy/materialize.js'
import { saveProject } from '../state/store.js'
import { createContext, requireGateway, tokens } from '../steps/context.js'
import { pickExistingProject } from './shared.js'

/**
 * Hands the user the full app source at the bundled template version, wired to
 * their existing worker/KV/inbox. After eject the CLI still manages Nylas
 * resources but never deploys this project again.
 */
export async function runEject(opts: { name?: string; dir?: string }): Promise<void> {
	p.intro('ownmail eject')
	const project = await pickExistingProject(opts.name)
	if (project.ejected) throw new Error(`"${project.slug}" is already ejected.`)

	const target = resolve(opts.dir ?? `./${project.slug}`)
	if (existsSync(target) && readdirSync(target).length > 0) {
		throw new Error(`${target} exists and is not empty — pick another directory.`)
	}

	const confirmed = await p.confirm({
		message: `Eject "${project.slug}" to ${target}? After this, updates are yours to manage (the CLI won’t deploy it again).`,
	})
	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Eject cancelled.')
		return
	}

	// Fresh API key for .dev.vars — the deployed key lives only in Cloudflare.
	let apiKey = ''
	const ctx = await createContext(project)
	if (ctx.auth && project.applicationId && project.orgPublicId) {
		try {
			const created = await requireGateway(ctx).createApiKey(
				tokens(ctx),
				project.region,
				project.applicationId,
				{ name: `ownmail ${project.slug} (ejected)` },
			)
			apiKey = created.apiKey
		} catch {
			p.log.warn(
				'Could not mint a fresh API key (session expired?). Create one in the Nylas dashboard and put it in .dev.vars.',
			)
		}
	}

	const manifest = loadManifest()
	const root = templateRoot()
	mkdirSync(target, { recursive: true })
	for (const entry of ['src', 'public', 'vite.config.ts', 'tsconfig.json', 'template.json']) {
		const from = join(root, entry)
		if (existsSync(from)) cpSync(from, join(target, entry), { recursive: true })
	}

	writeFileSync(
		join(target, 'package.json'),
		`${JSON.stringify(
			{
				name: project.slug,
				private: true,
				type: 'module',
				scripts: {
					dev: 'vite dev',
					build: 'vite build',
					deploy: 'vite build && wrangler deploy -c dist/server/wrangler.json',
					typecheck: 'tsc --noEmit',
				},
				dependencies: {
					'@nylas-labs/cli-kit': '^0.1.0',
					'@tanstack/react-router': '^1.130.0',
					'@tanstack/react-start': '^1.138.0',
					react: '^19.1.0',
					'react-dom': '^19.1.0',
				},
				devDependencies: {
					'@cloudflare/vite-plugin': '^1.13.0',
					'@cloudflare/workers-types': '^4.20260601.0',
					'@tailwindcss/vite': '^4.1.0',
					'@types/react': '^19.1.0',
					'@types/react-dom': '^19.1.0',
					'@vitejs/plugin-react': '^4.5.0',
					tailwindcss: '^4.1.0',
					typescript: '^5.8.0',
					vite: '^7.0.0',
					wrangler: '^4.20.0',
				},
			},
			null,
			2,
		)}\n`,
	)

	writeFileSync(
		join(target, 'wrangler.jsonc'),
		`${JSON.stringify(
			{
				$schema: 'node_modules/wrangler/config-schema.json',
				name: project.workerName ?? `${project.slug}-ownmail`,
				compatibility_date: '2026-06-01',
				compatibility_flags: ['nodejs_compat'],
				main: '@tanstack/react-start/server-entry',
				kv_namespaces: [{ binding: 'SESSIONS', id: project.kvNamespaceId ?? '' }],
				vars: {
					NYLAS_CLIENT_ID: project.applicationId ?? '',
					NYLAS_REGION: project.region,
					APP_NAME: project.slug,
					INBOX_EMAIL: project.inboxEmail ?? '',
					TEMPLATE_VERSION: manifest.templateVersion,
				},
				observability: { enabled: true },
			},
			null,
			2,
		)}\n`,
	)

	writeFileSync(
		join(target, '.dev.vars'),
		[
			`NYLAS_API_KEY=${apiKey || '<create an API key in the Nylas dashboard>'}`,
			`SESSION_SECRET=${crypto.randomUUID()}${crypto.randomUUID()}`,
			'',
		].join('\n'),
		{ mode: 0o600 },
	)
	writeFileSync(join(target, '.gitignore'), 'node_modules/\ndist/\n.dev.vars\n.wrangler/\n')
	writeFileSync(
		join(target, 'README.md'),
		[
			`# ${project.slug}`,
			'',
			`Your mailbox app (${project.inboxEmail ?? ''}), ejected from ownmail template v${manifest.templateVersion}.`,
			'',
			'```bash',
			'pnpm install   # or npm/yarn',
			'pnpm dev       # local dev on http://localhost:3000 (uses .dev.vars)',
			'pnpm deploy    # build + deploy to your Cloudflare worker',
			'```',
			'',
			'Deployed secrets (`NYLAS_API_KEY`, `SESSION_SECRET`) already live on the worker;',
			'`.dev.vars` only feeds local dev. Manage Nylas resources (inboxes, domains) with',
			'`npx ownmail grants` / the Nylas dashboard as before.',
			'',
			'Template changelog: https://github.com/nylas/nylas-labs/tree/main/labs/ownmail',
			'',
		].join('\n'),
	)

	project.ejected = true
	saveProject(project)
	p.outro(`Ejected to ${target}. It’s all yours — happy hacking.`)
}
