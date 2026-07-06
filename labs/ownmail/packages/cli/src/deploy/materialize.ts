import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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

/**
 * Copies the template's prebuilt dist (vite + @cloudflare/vite-plugin output:
 * dist/server + dist/client + dist/server/wrangler.json) into a scratch dir
 * and patches the emitted wrangler config with this user's worker name, KV
 * namespace id, and runtime vars.
 */
export function materialize(input: MaterializeInput): Materialized {
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
