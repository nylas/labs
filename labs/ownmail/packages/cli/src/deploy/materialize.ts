import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)

export type TemplateManifest = {
	templateVersion: string
	minCliVersion: string
	requiredSecrets: string[]
	requiredVars: string[]
	kvBindings: string[]
	migrations: { version: string; notes: string }[]
}

export function templateRoot(): string {
	return dirname(require.resolve('@ownmail/template/package.json'))
}

export function loadManifest(): TemplateManifest {
	const raw = readFileSync(join(templateRoot(), 'template.json'), 'utf8')
	return JSON.parse(raw) as TemplateManifest
}

export type MaterializeInput = {
	slug: string
	workerName: string
	kvNamespaceId: string
	vars: Record<string, string>
	/** Optional custom domain for the app itself (Cloudflare custom_domain route). */
	appDomain?: string
}

export type Materialized = {
	/** Directory containing the copied dist. */
	dir: string
	/** Path to the patched wrangler config — pass to `wrangler deploy -c`. */
	configPath: string
}

export type ManualExportInput = {
	slug: string
	region: 'us' | 'eu'
	apiBaseUrl?: string
	applicationId: string
	inboxEmail: string
	templateVersion: string
	targetDir: string
	apiKey?: string
	sessionSecret: string
}

/**
 * Copies the template's prebuilt dist (vite + @cloudflare/vite-plugin output:
 * dist/server + dist/client + dist/server/wrangler.json) into a scratch dir
 * and patches the emitted wrangler config with this user's worker name, KV
 * namespace id, and runtime vars.
 */
export function materialize(input: MaterializeInput): Materialized {
	if (!input.vars.NYLAS_CLIENT_ID?.trim()) {
		throw new Error('NYLAS_CLIENT_ID is required before deploying the mailbox app.')
	}
	const root = templateRoot()
	const dir = join(tmpdir(), 'ownmail', input.slug, `deploy-${Date.now()}`)
	mkdirSync(dir, { recursive: true })
	cpSync(join(root, 'dist'), join(dir, 'dist'), { recursive: true })

	const configPath = join(dir, 'dist', 'server', 'wrangler.json')
	const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
	config.name = input.workerName
	config.topLevelName = input.workerName
	config.kv_namespaces = [{ binding: 'SESSIONS', id: input.kvNamespaceId }]
	config.vars = input.vars
	if (input.appDomain) {
		config.routes = [{ pattern: input.appDomain, custom_domain: true }]
	}
	// The build-machine absolute paths are meaningless here; point them at the
	// materialized copy so wrangler resolves relative assets/main correctly.
	config.configPath = configPath
	config.userConfigPath = configPath
	writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
	return { dir, configPath }
}

export function exportManualBundle(input: ManualExportInput): string {
	if (!input.applicationId.trim()) {
		throw new Error('NYLAS_CLIENT_ID is required before exporting the mailbox app.')
	}
	const root = templateRoot()
	const target = resolve(input.targetDir)
	mkdirSync(target, { recursive: true })

	for (const entry of [
		'src',
		'public',
		'scripts',
		'vite.config.ts',
		'vite.config.vercel.ts',
		'tsconfig.json',
		'template.json',
	]) {
		const from = join(root, entry)
		if (existsSync(from)) cpSync(from, join(target, entry), { recursive: true })
	}

	writeFileSync(
		join(target, 'package.json'),
		`${JSON.stringify(
			{
				name: input.slug,
				private: true,
				type: 'module',
				scripts: {
					dev: 'vite dev',
					build: 'vite build',
					'build:vercel':
						'vite build -c vite.config.vercel.ts --outDir dist-vercel && node scripts/build-vercel.mjs',
					typecheck: 'tsc --noEmit',
				},
				dependencies: {
					'@nylas-labs/cli-kit': '^0.1.0',
					'@tanstack/react-router': '^1.130.0',
					'@tanstack/react-start': '^1.138.0',
					'lucide-react': '^1.23.0',
					react: '^19.1.0',
					'react-dom': '^19.1.0',
				},
				devDependencies: {
					'@tailwindcss/vite': '^4.1.0',
					'@types/react': '^19.1.0',
					'@types/react-dom': '^19.1.0',
					'@vitejs/plugin-react': '^4.5.0',
					tailwindcss: '^4.1.0',
					typescript: '^5.8.0',
					vite: '^7.0.0',
				},
			},
			null,
			2,
		)}\n`,
	)

	writeFileSync(
		join(target, '.env.example'),
		[
			'NYLAS_API_KEY=<set in your hosting provider secrets>',
			'SESSION_SECRET=<set in your hosting provider secrets>',
			'NYLAS_WEBHOOK_SECRET=<optional>',
			`NYLAS_CLIENT_ID=${input.applicationId}`,
			`NYLAS_REGION=${input.region}`,
			...(input.apiBaseUrl ? [`NYLAS_API_BASE_URL=${input.apiBaseUrl}`] : []),
			`APP_NAME=${input.slug}`,
			`INBOX_EMAIL=${input.inboxEmail}`,
			`TEMPLATE_VERSION=${input.templateVersion}`,
			'',
		].join('\n'),
	)
	writeFileSync(
		join(target, 'secrets.env'),
		[
			`NYLAS_API_KEY=${input.apiKey ?? '<create an API key in the Nylas dashboard>'}`,
			`SESSION_SECRET=${input.sessionSecret}`,
			'NYLAS_WEBHOOK_SECRET=<optional>',
			'',
		].join('\n'),
		{ mode: 0o600 },
	)
	writeFileSync(
		join(target, '.gitignore'),
		'node_modules/\ndist/\ndist-vercel/\n.vercel/\n.env*\nsecrets.env\n',
	)
	writeFileSync(
		join(target, 'README.md'),
		[
			`# ${input.slug}`,
			'',
			`Mailbox app export for ${input.inboxEmail}.`,
			'',
			'## Environment',
			'',
			'Set every variable from `.env.example` in your hosting provider.',
			'Values for deployment secrets are in `secrets.env`; keep that file local and do not commit it.',
			'',
			'## Build',
			'',
			'```bash',
			'pnpm install',
			'pnpm build:vercel',
			'```',
			'',
			'Upload `.vercel/output` to any host that supports the Vercel Build Output API.',
			'For other Node SSR hosts, adapt `scripts/node-adapter.mjs` and the server bundle in `dist-vercel/server`.',
			'',
			'After the app has a public HTTPS URL, rerun `ownmail` and choose manual hosting again so the CLI can register the hosted-auth callback URL.',
			'',
		].join('\n'),
	)
	return target
}
