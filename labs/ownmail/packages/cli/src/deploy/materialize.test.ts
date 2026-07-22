import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	exportManualBundle,
	loadManifest,
	materialize,
	materializeLocal,
	materializeNetlify,
	materializeVercel,
	templateRoot,
} from './materialize.js'

const { manifest, wranglerConfig, existsMap } = vi.hoisted(() => ({
	manifest: {
		templateVersion: '2.0.0',
		minCliVersion: '0.1.0',
		requiredSecrets: ['NYLAS_API_KEY'],
		requiredVars: ['NYLAS_CLIENT_ID'],
		kvBindings: ['SESSIONS'],
		migrations: [],
	},
	wranglerConfig: {
		name: 'stale',
		topLevelName: 'stale',
		configPath: '/build/machine/path.json',
		userConfigPath: '/build/machine/path.json',
	},
	existsMap: new Map<string, boolean>(),
}))

vi.mock('node:module', () => ({
	createRequire: () =>
		Object.assign((id: string) => id, {
			resolve: () => '/fake/template/package.json',
		}),
}))

vi.mock('node:fs', () => ({
	readFileSync: vi.fn((path: string) => {
		if (path.endsWith('template.json')) return JSON.stringify(manifest)
		if (path.endsWith('wrangler.json')) return JSON.stringify(wranglerConfig)
		throw new Error(`unexpected readFileSync ${path}`)
	}),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	mkdtempSync: vi.fn((path: string) => `${path}abc123`),
	rmSync: vi.fn(),
	cpSync: vi.fn(),
	existsSync: vi.fn((path: string) => existsMap.get(path) ?? false),
}))

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

beforeEach(() => {
	vi.clearAllMocks()
	existsMap.clear()
})

describe('templateRoot / loadManifest', () => {
	it('prefers the template bundled inside the published CLI', () => {
		const bundled = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'template')
		existsMap.set(join(bundled, 'template.json'), true)
		expect(templateRoot()).toBe(bundled)
	})

	it('resolves the template root from the package.json location', () => {
		expect(templateRoot()).toBe('/fake/template')
	})

	it('parses template.json into a manifest', () => {
		expect(loadManifest()).toEqual(manifest)
	})
})

describe('materialize', () => {
	const base = {
		slug: 'acme',
		workerName: 'acme-worker',
		kvNamespaceId: 'kv123',
		vars: { NYLAS_CLIENT_ID: 'client-abc', APP_NAME: 'acme' },
	}

	it('throws when NYLAS_CLIENT_ID is missing', () => {
		expect(() => materialize({ ...base, vars: { APP_NAME: 'acme' } })).toThrow(/NYLAS_CLIENT_ID is required/)
	})

	it('patches the wrangler config with worker name, KV, and vars', () => {
		const { dir, configPath } = materialize(base)
		expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true })
		expect(cpSync).toHaveBeenCalled()
		const [[, contents]] = vi.mocked(writeFileSync).mock.calls
		const written = JSON.parse(contents as string)
		expect(written.name).toBe('acme-worker')
		expect(written.topLevelName).toBe('acme-worker')
		expect(written.kv_namespaces).toEqual([{ binding: 'SESSIONS', id: 'kv123' }])
		expect(written.vars).toEqual(base.vars)
		expect(written.routes).toBeUndefined()
		// Build-machine paths are rewritten to the materialized copy.
		expect(written.configPath).toBe(configPath)
		expect(written.userConfigPath).toBe(configPath)
	})

	it('adds a custom_domain route when an app domain is supplied', () => {
		materialize({ ...base, appDomain: 'mail.acme.com' })
		const [[, contents]] = vi.mocked(writeFileSync).mock.calls
		const written = JSON.parse(contents as string)
		expect(written.routes).toEqual([{ pattern: 'mail.acme.com', custom_domain: true }])
	})
})

describe('Node provider materialization', () => {
	it('copies prebuilt Vercel output into a private temporary directory', () => {
		existsMap.set('/fake/template/.vercel/output', true)
		const result = materializeVercel('acme')
		expect(result.dir).toContain('/ownmail/acme/vercel-abc123')
		expect(cpSync).toHaveBeenCalledWith(
			'/fake/template/.vercel/output',
			expect.stringContaining('/.vercel/output'),
			{ recursive: true },
		)
	})

	it('assembles a Netlify fetch function and static bundle', () => {
		existsMap.set('/fake/template/dist-vercel/client', true)
		existsMap.set('/fake/template/dist-vercel/server', true)
		const result = materializeNetlify('acme')
		const writes = vi.mocked(writeFileSync).mock.calls.map(([path, body]) => [String(path), String(body)])
		expect(result.dir).toContain('/ownmail/acme/netlify-abc123')
		expect(writes.some(([path, body]) => path.endsWith('ssr.mjs') && body.includes('preferStatic'))).toBe(
			true,
		)
		expect(writes.some(([path, body]) => path.endsWith('netlify.toml') && body.includes('dist/client'))).toBe(
			true,
		)
	})

	it('replaces a durable local runtime with the Node build and server scripts', () => {
		for (const path of [
			'/fake/template/dist-vercel',
			'/fake/template/scripts/node-adapter.mjs',
			'/fake/template/scripts/serve-node.mjs',
		]) {
			existsMap.set(path, true)
		}
		expect(materializeLocal('/runtime/acme')).toEqual({ dir: '/runtime/acme' })
		expect(rmSync).toHaveBeenCalledWith('/runtime/acme', { recursive: true, force: true })
		expect(cpSync).toHaveBeenCalledTimes(3)
	})

	it('fails closed when a required bundled target is missing', () => {
		expect(() => materializeVercel('acme')).toThrow(/bundled Vercel app target is missing/)
	})
})

describe('exportManualBundle', () => {
	const base = {
		slug: 'acme',
		region: 'us' as const,
		applicationId: 'app-123',
		inboxEmail: 'hi@acme.com',
		templateVersion: '2.0.0',
		targetDir: '/out/acme',
		sessionSecret: 'sekret',
	}

	function written(name: string): string {
		const call = vi.mocked(writeFileSync).mock.calls.find(([p]) => String(p).endsWith(name))
		if (!call) throw new Error(`no write for ${name}`)
		return call[1] as string
	}

	it('throws when the application id is blank', () => {
		expect(() => exportManualBundle({ ...base, applicationId: '   ' })).toThrow(/NYLAS_CLIENT_ID is required/)
	})

	it('copies existing template entries and writes the full bundle', () => {
		// Every candidate source entry exists → each is copied.
		for (const entry of [
			'src',
			'public',
			'scripts',
			'components.json',
			'vite.config.ts',
			'vite.config.vercel.ts',
			'tsconfig.json',
			'template.json',
		]) {
			existsMap.set(`/fake/template/${entry}`, true)
		}
		const target = exportManualBundle({
			...base,
			apiBaseUrl: 'https://api-eu.example.com',
			apiKey: 'nyk_live_key',
		})
		expect(target).toBe('/out/acme')
		expect(cpSync).toHaveBeenCalledTimes(8)
		expect(vi.mocked(existsSync)).toHaveBeenCalledTimes(9)

		const packageJson = JSON.parse(written('package.json'))
		expect(packageJson.name).toBe('acme')
		expect(packageJson.imports['#shared/components/*']).toBe('./src/shared/components/*.tsx')
		expect(packageJson.scripts['build:vercel']).toBe('vite build -c vite.config.vercel.ts')
		expect(packageJson.dependencies.nitro).toBe('3.0.260610-beta')
		expect(written('.env.example')).toContain('NYLAS_API_BASE_URL=https://api-eu.example.com')
		expect(written('.env.example')).toContain('NYLAS_CLIENT_ID=app-123')
		expect(written('secrets.env')).toContain('NYLAS_API_KEY=nyk_live_key')

		const secretsCall = vi.mocked(writeFileSync).mock.calls.find(([p]) => String(p).endsWith('secrets.env'))
		expect(secretsCall?.[2]).toEqual({ mode: 0o600 })
	})

	it('skips missing entries and uses placeholders when optional inputs are absent', () => {
		// existsSync returns false for all → nothing copied.
		exportManualBundle(base)
		expect(cpSync).not.toHaveBeenCalled()
		expect(written('.env.example')).not.toContain('NYLAS_API_BASE_URL')
		expect(written('secrets.env')).toContain('NYLAS_API_KEY=<create an API key in the Nylas dashboard>')
	})
})
