import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
	spawn: vi.fn(),
	files: new Map<string, string>(),
	writes: [] as Array<{ path: string; value: string; options?: unknown }>,
	removed: [] as string[],
	resolveFails: false,
	missingBin: false,
}))

vi.mock('node:child_process', () => ({ spawn: hoisted.spawn }))
vi.mock('node:crypto', () => ({ randomBytes: () => Buffer.from('abcdef', 'utf8') }))
vi.mock('node:module', () => ({
	createRequire: () =>
		Object.assign(
			(id: string) => {
				if (id === 'vercel/package.json') {
					return { bin: hoisted.missingBin ? {} : { vercel: './dist/index.js' } }
				}
				if (id === 'netlify-cli/package.json') return { bin: './bin/run.js' }
				throw new Error('unexpected package')
			},
			{
				resolve: (id: string) => {
					if (hoisted.resolveFails) throw new Error('missing')
					return `/deps/${id}`
				},
			},
		),
}))
vi.mock('node:fs', () => ({
	mkdirSync: vi.fn(),
	readFileSync: vi.fn((path: string) => {
		const value = hoisted.files.get(path)
		if (value === undefined) throw new Error('missing file')
		return value
	}),
	writeFileSync: vi.fn((path: string, value: string, options?: unknown) => {
		hoisted.writes.push({ path, value, options })
		hoisted.files.set(path, value)
	}),
	rmSync: vi.fn((path: string) => {
		hoisted.removed.push(path)
		hoisted.files.delete(path)
	}),
}))

import {
	deployNetlify,
	deployVercel,
	ensureNetlifySite,
	ensureVercelProject,
	listVercelScopes,
	resolveVercelProductionUrl,
	setNetlifyEnvironment,
	setVercelEnvironment,
} from './provider-cli.js'

type FakeResult = { code: number | null; stdout?: string; stderr?: string; error?: boolean }

beforeEach(() => {
	vi.clearAllMocks()
	hoisted.files.clear()
	hoisted.writes.length = 0
	hoisted.removed.length = 0
	hoisted.resolveFails = false
	hoisted.missingBin = false
})

describe('Vercel provider CLI', () => {
	it('reuses and validates recorded project identifiers', async () => {
		const result = await ensureVercelProject('/tmp/app', 'acme-ownmail', 'team_123', {
			projectId: 'prj_123',
			orgId: 'team_123',
		})
		expect(result).toEqual({ projectId: 'prj_123', orgId: 'team_123' })
		expect(hoisted.files.get('/tmp/app/.vercel/project.json')).toContain('prj_123')
		expect(hoisted.spawn).not.toHaveBeenCalled()
	})

	it('signs in, links a new project, and reads its identifiers', async () => {
		queueCli({ code: 1, stderr: 'not authenticated' }, { code: 0 }, { code: 0 })
		hoisted.files.set(
			'/tmp/app/.vercel/project.json',
			JSON.stringify({ projectId: 'prj_new', orgId: 'team_new' }),
		)
		await expect(ensureVercelProject('/tmp/app', 'acme-ownmail', 'team_chosen')).resolves.toEqual({
			projectId: 'prj_new',
			orgId: 'team_new',
		})
		expect(spawnedArgs(1)).toContain('login')
		expect(spawnedArgs(2)).toEqual(
			expect.arrayContaining(['link', '--scope', 'team_chosen', '--non-interactive']),
		)
		expect(stdinEnded(2)).toBe(true)
	})

	it('lists and validates the personal and team scopes available to the signed-in user', async () => {
		queueCli(
			{ code: 0, stdout: 'user' },
			{
				code: 0,
				stdout: JSON.stringify({
					teams: [
						{
							id: 'user_1',
							slug: 'aaron@example.com',
							name: 'aaron@example.com',
							current: true,
						},
						{ id: 'team_1', slug: 'acme', name: 'Acme', current: false },
					],
					pagination: { count: 2 },
				}),
			},
		)

		await expect(listVercelScopes()).resolves.toEqual([
			{
				id: 'user_1',
				slug: 'aaron@example.com',
				name: 'aaron@example.com',
				current: true,
			},
			{ id: 'team_1', slug: 'acme', name: 'Acme', current: false },
		])
		expect(spawnedArgs(1)).toEqual(
			expect.arrayContaining(['teams', 'list', '--format', 'json', '--non-interactive']),
		)
	})

	it('rejects missing, empty, or malformed Vercel scope lists', async () => {
		queueCli({ code: 0 }, { code: 0, stdout: 'null' })
		await expect(listVercelScopes()).rejects.toThrow(/invalid account list/)

		queueCli({ code: 0 }, { code: 0, stdout: '{}' })
		await expect(listVercelScopes()).rejects.toThrow(/invalid account list/)

		queueCli({ code: 0 }, { code: 0, stdout: '{"teams":[]}' })
		await expect(listVercelScopes()).rejects.toThrow(/invalid deployment account details/)
	})

	it.each([
		['non-object entry', null],
		['invalid id', { id: '../bad', slug: 'acme', name: 'Acme', current: false }],
		['invalid slug type', { id: 'team_1', slug: null, name: 'Acme', current: false }],
		['invalid slug format', { id: 'team_1', slug: '../bad', name: 'Acme', current: false }],
		['missing name', { id: 'team_1', slug: 'acme', current: false }],
		['empty name', { id: 'team_1', slug: 'acme', name: '', current: false }],
		['oversized name', { id: 'team_1', slug: 'acme', name: 'a'.repeat(161), current: false }],
		['control character in name', { id: 'team_1', slug: 'acme', name: 'Acme\nTeam', current: false }],
		['invalid current marker', { id: 'team_1', slug: 'acme', name: 'Acme', current: 'yes' }],
	])('rejects a %s returned by Vercel', async (_case, scope) => {
		queueCli({ code: 0 }, { code: 0, stdout: JSON.stringify({ teams: [scope] }) })

		await expect(listVercelScopes()).rejects.toThrow(/invalid deployment account details/)
	})

	it('reports a Vercel account-list failure without exposing provider output', async () => {
		queueCli({ code: 0 }, { code: 1, stderr: 'private provider detail' })

		const error = await listVercelScopes().catch((caught: unknown) => caught)
		expect(error).toBeInstanceOf(Error)
		expect((error as Error).message).toMatch(/could not list deployment accounts/)
		expect((error as Error).message).not.toMatch(/private provider detail/)
	})

	it('fails safely for invalid recorded or returned identifiers', async () => {
		await expect(
			ensureVercelProject('/tmp/app', 'acme-ownmail', 'team_ok', {
				projectId: '../bad',
				orgId: 'team_ok',
			}),
		).rejects.toThrow(/identifiers are invalid/)

		queueCli({ code: 0 }, { code: 0 })
		hoisted.files.set('/tmp/app/.vercel/project.json', JSON.stringify({ projectId: 'bad id', orgId: 'x' }))
		await expect(ensureVercelProject('/tmp/app', 'acme-ownmail', 'team_ok')).rejects.toThrow(
			/invalid project identifiers/,
		)
	})

	it('rejects an invalid selected scope before starting Vercel', async () => {
		await expect(ensureVercelProject('/tmp/app', 'acme-ownmail', '../bad')).rejects.toThrow(
			/Selected Vercel deployment account is invalid/,
		)
		expect(hoisted.spawn).not.toHaveBeenCalled()
	})

	it('reports an unverifiable link without exposing provider output', async () => {
		queueCli({ code: 0 }, { code: 0 })
		await expect(ensureVercelProject('/tmp/app', 'acme-ownmail', 'team_ok')).rejects.toThrow(
			/may have linked/,
		)
	})

	it('classifies link and environment-setting failures', async () => {
		queueCli({ code: 0 }, { code: 1, stderr: 'network failure' })
		await expect(ensureVercelProject('/tmp/app', 'acme-ownmail', 'team_ok')).rejects.toThrow(/could not link/)

		queueCli({ code: 1, stderr: 'network failure' })
		await expect(setVercelEnvironment('/tmp', { APP_NAME: 'acme' }, new Set())).rejects.toThrow(
			/could not store deployment settings/,
		)
	})

	it('rejects non-object Vercel link metadata', async () => {
		queueCli({ code: 0 }, { code: 0 })
		hoisted.files.set('/tmp/app/.vercel/project.json', '[]')
		await expect(ensureVercelProject('/tmp/app', 'acme-ownmail', 'team_ok')).rejects.toThrow(
			/invalid project identifiers/,
		)
	})

	it('sends environment values over stdin and marks secrets sensitive', async () => {
		queueCli({ code: 0 }, { code: 0 })
		await setVercelEnvironment(
			'/tmp/app',
			{ NYLAS_API_KEY: 'secret-value', APP_NAME: 'acme' },
			new Set(['NYLAS_API_KEY']),
		)
		expect(spawnedArgs(0)).toContain('--sensitive')
		expect(spawnedArgs(0)).toContain('--yes')
		expect(spawnedArgs(1)).not.toContain('--sensitive')
		expect(stdinValue(0)).toBe('secret-value\n')
		expect(JSON.stringify(hoisted.spawn.mock.calls)).not.toContain('secret-value')
	})

	it('rejects invalid environment entries before invoking the provider', async () => {
		await expect(setVercelEnvironment('/tmp', { 'bad-name': 'x' }, new Set())).rejects.toThrow(
			/Invalid deployment setting name/,
		)
		await expect(setVercelEnvironment('/tmp', { GOOD_NAME: 'line\nbreak' }, new Set())).rejects.toThrow(
			/invalid value/,
		)
		expect(hoisted.spawn).not.toHaveBeenCalled()
	})

	it('deploys prebuilt output and validates the provider URL', async () => {
		queueCli(
			{ code: 0, stdout: 'https://acme-build.vercel.app\n' },
			{
				code: 0,
				stdout: '{"readyState":"READY","url":"acme-build.vercel.app","aliases":["acme.vercel.app"]}',
			},
		)
		await expect(deployVercel('/tmp/app', 'team_ok')).resolves.toBe('https://acme.vercel.app')
		expect(spawnedArgs(0)).toEqual(expect.arrayContaining(['--format', 'json']))
		expect(spawnedArgs(1)).toEqual(
			expect.arrayContaining([
				'inspect',
				'https://acme-build.vercel.app',
				'--wait',
				'--timeout',
				'2m',
				'--scope',
				'team_ok',
			]),
		)

		queueCli(
			{
				code: 0,
				stdout: JSON.stringify({
					status: 'ok',
					deployment: { url: 'https://structured.vercel.app' },
				}),
			},
			{
				code: 0,
				stdout:
					'{"readyState":"READY","url":"structured.vercel.app","aliases":["structured-team.vercel.app"]}',
			},
		)
		await expect(deployVercel('/tmp/app', 'team_ok')).resolves.toBe('https://structured-team.vercel.app')

		queueCli(
			{ code: 0, stdout: '{"url":"https://top-level.vercel.app"}' },
			{
				code: 0,
				stdout: '{"readyState":"READY","url":"top-level.vercel.app","aliases":["top-level-team.vercel.app"]}',
			},
		)
		await expect(deployVercel('/tmp/app', 'team_ok')).resolves.toBe('https://top-level-team.vercel.app')

		queueCli({ code: 0, stdout: 'https://attacker.example.com' })
		await expect(deployVercel('/tmp/app', 'team_ok')).rejects.toThrow(/invalid deployment URL/)

		queueCli({ code: 0, stdout: '{"deployment":[]}' })
		await expect(deployVercel('/tmp/app', 'team_ok')).rejects.toThrow(/invalid deployment URL/)
	})

	it('resolves only a validated stable Vercel production alias', async () => {
		queueCli({
			code: 0,
			stdout: JSON.stringify({
				readyState: 'READY',
				url: 'build-id.vercel.app',
				aliases: [
					'https://custom.example.com',
					'https://user:password@attacker.vercel.app',
					'build-id.vercel.app',
					'main-team.vercel.app',
				],
			}),
		})
		await expect(resolveVercelProductionUrl('https://build-id.vercel.app', 'team_ok')).resolves.toBe(
			'https://main-team.vercel.app',
		)

		queueCli({
			code: 0,
			stdout: '{"readyState":"READY","url":"https://build-id.vercel.app","aliases":["main-team.vercel.app"]}',
		})
		await expect(resolveVercelProductionUrl('https://main-team.vercel.app', 'team_ok')).resolves.toBe(
			'https://main-team.vercel.app',
		)

		queueCli({
			code: 0,
			stdout: '{"readyState":"READY","url":"build-id.vercel.app","aliases":["custom.example.com"]}',
		})
		await expect(resolveVercelProductionUrl('https://build-id.vercel.app', 'team_ok')).rejects.toThrow(
			/did not return its stable production URL/,
		)

		queueCli({
			code: 0,
			stdout: '{"readyState":"READY","url":"build-id.vercel.app","aliases":[123]}',
		})
		await expect(resolveVercelProductionUrl('https://build-id.vercel.app', 'team_ok')).rejects.toThrow(
			/did not return its stable production URL/,
		)

		queueCli({ code: 0, stdout: '{"readyState":"READY","url":"build-id.vercel.app"}' })
		await expect(resolveVercelProductionUrl('https://build-id.vercel.app', 'team_ok')).rejects.toThrow(
			/did not return its stable production URL/,
		)

		queueCli({ code: 0, stdout: '{"readyState":"READY","aliases":["main-team.vercel.app"]}' })
		await expect(resolveVercelProductionUrl('https://main-team.vercel.app', 'team_ok')).rejects.toThrow(
			/did not identify its immutable deployment URL/,
		)

		queueCli({
			code: 0,
			stdout: '{"readyState":"READY","url":"https://custom.example.com","aliases":["main-team.vercel.app"]}',
		})
		await expect(resolveVercelProductionUrl('https://main-team.vercel.app', 'team_ok')).rejects.toThrow(
			/did not identify its immutable deployment URL/,
		)
	})

	it('reports queued and failed deployments with actionable inspection commands', async () => {
		queueCli(
			{ code: 0, stdout: '{"url":"https://queued.vercel.app"}' },
			{ code: 1, stderr: 'Deployment is still initializing; timed out waiting' },
		)
		await expect(deployVercel('/tmp/app', 'team_ok')).rejects.toThrow(
			/still initializing after 2 minutes.*vercel inspect https:\/\/queued\.vercel\.app --wait/s,
		)

		queueCli(
			{ code: 0, stdout: '{"url":"https://building.vercel.app"}' },
			{ code: 0, stdout: '{"readyState":"BUILDING"}' },
		)
		await expect(deployVercel('/tmp/app', 'team_ok')).rejects.toThrow(/still initializing after 2 minutes/)

		queueCli(
			{ code: 0, stdout: '{"url":"https://unknown.vercel.app"}' },
			{ code: 1, stderr: 'unexpected inspect failure' },
		)
		await expect(deployVercel('/tmp/app', 'team_ok')).rejects.toThrow(
			/could not confirm that it became ready.*vercel inspect https:\/\/unknown\.vercel\.app --wait/s,
		)

		queueCli(
			{ code: 0, stdout: '{"url":"https://failed.vercel.app"}' },
			{ code: 0, stdout: '{"readyState":"ERROR"}' },
		)
		await expect(deployVercel('/tmp/app', 'team_ok')).rejects.toThrow(
			/vercel inspect https:\/\/failed\.vercel\.app --logs/,
		)

		queueCli({ code: 0, stdout: '{"url":"https://invalid-state.vercel.app"}' }, { code: 0, stdout: '[]' })
		await expect(deployVercel('/tmp/app', 'team_ok')).rejects.toThrow(/it did not become ready/)

		queueCli({ code: 0, stdout: '{"url":"https://missing-state.vercel.app"}' }, { code: 0, stdout: '{}' })
		await expect(deployVercel('/tmp/app', 'team_ok')).rejects.toThrow(/it did not become ready/)
	})
})

describe('Netlify provider CLI', () => {
	it('reuses a recorded site without a network call', async () => {
		await expect(
			ensureNetlifySite('/tmp/app', 'acme', '123e4567-e89b-42d3-a456-426614174000'),
		).resolves.toEqual({ siteId: '123e4567-e89b-42d3-a456-426614174000' })
		expect(hoisted.spawn).not.toHaveBeenCalled()
	})

	it('creates and validates a new site after checking login', async () => {
		queueCli({ code: 0, stdout: '[]' }, { code: 0, stdout: '{"id":"123e4567-e89b-42d3-a456-426614174000"}' })
		await expect(ensureNetlifySite('/tmp/app', 'acme')).resolves.toEqual({
			siteId: '123e4567-e89b-42d3-a456-426614174000',
		})
	})

	it('accepts log-wrapped JSON and the alternate site_id field', async () => {
		queueCli(
			{ code: 0 },
			{
				code: 0,
				stdout: 'Creating site…\n{"site_id":"123e4567-e89b-42d3-a456-426614174000"}\nDone',
			},
		)
		await expect(ensureNetlifySite('/tmp/app', 'acme')).resolves.toEqual({
			siteId: '123e4567-e89b-42d3-a456-426614174000',
		})
	})

	it('reports create failures and unverifiable site output', async () => {
		queueCli({ code: 0 }, { code: 1, stderr: 'service unavailable' })
		await expect(ensureNetlifySite('/tmp/app', 'acme')).rejects.toThrow(/could not create/)

		queueCli({ code: 0 }, { code: 0, stdout: '[]' })
		await expect(ensureNetlifySite('/tmp/app', 'acme')).rejects.toThrow(/could not verify its site ID/)

		queueCli({ code: 0 }, { code: 0, stdout: 'prefix {bad json} suffix' })
		await expect(ensureNetlifySite('/tmp/app', 'acme')).rejects.toThrow(/could not verify its site ID/)

		queueCli({ code: 0 }, { code: 0, stdout: 'no json here' })
		await expect(ensureNetlifySite('/tmp/app', 'acme')).rejects.toThrow(/could not verify its site ID/)
	})

	it('imports settings through a protected temporary file and always removes it', async () => {
		queueCli({ code: 0 })
		await setNetlifyEnvironment('/tmp/app', '123e4567-e89b-42d3-a456-426614174000', {
			NYLAS_API_KEY: 'secret-value',
			APP_NAME: 'acme',
		})
		const secretWrite = hoisted.writes.find(({ value }) => value.includes('secret-value'))
		expect(secretWrite?.options).toEqual({ mode: 0o600, flag: 'wx' })
		expect(hoisted.removed).toContain(secretWrite?.path)
		expect(hoisted.files.has(secretWrite?.path ?? '')).toBe(false)
	})

	it('marks imported Netlify secrets without placing values in process arguments', async () => {
		queueCli({ code: 0 }, { code: 0 }, { code: 0 })
		await setNetlifyEnvironment(
			'/tmp/app',
			'123e4567-e89b-42d3-a456-426614174000',
			{ NYLAS_API_KEY: 'api-secret', SESSION_SECRET: 'session-secret' },
			new Set(['NYLAS_API_KEY', 'SESSION_SECRET', 'NOT_PRESENT']),
		)
		expect(spawnedArgs(1)).toEqual(expect.arrayContaining(['env:set', 'NYLAS_API_KEY', '--secret']))
		expect(spawnedArgs(2)).toEqual(expect.arrayContaining(['env:set', 'SESSION_SECRET', '--secret']))
		expect(JSON.stringify(hoisted.spawn.mock.calls)).not.toContain('api-secret')
		expect(JSON.stringify(hoisted.spawn.mock.calls)).not.toContain('session-secret')
	})

	it('removes the temporary file when secret protection fails', async () => {
		queueCli({ code: 0 }, { code: 1, stderr: 'service unavailable' })
		await expect(
			setNetlifyEnvironment(
				'/tmp/app',
				'123e4567-e89b-42d3-a456-426614174000',
				{ NYLAS_API_KEY: 'api-secret' },
				new Set(['NYLAS_API_KEY']),
			),
		).rejects.toThrow(/could not protect deployment secrets/)
		expect(hoisted.removed).toHaveLength(1)
	})

	it('removes the temporary file when import fails', async () => {
		queueCli({ code: 1, stderr: 'network unavailable' })
		await expect(
			setNetlifyEnvironment('/tmp/app', '123e4567-e89b-42d3-a456-426614174000', {
				APP_NAME: 'acme',
			}),
		).rejects.toThrow(/could not store deployment settings/)
		expect(hoisted.removed).toHaveLength(1)
	})

	it('deploys functions and selects a validated Netlify URL', async () => {
		queueCli({
			code: 0,
			stdout: '{"ssl_url":"https://acme.netlify.app","deploy_url":"https://draft.netlify.app"}',
		})
		await expect(deployNetlify('/tmp/app', '123e4567-e89b-42d3-a456-426614174000')).resolves.toBe(
			'https://acme.netlify.app',
		)
		expect(spawnedArgs(0)).toContain('--no-build')
	})

	it('uses the deploy URL fallback and reports provider deployment failures', async () => {
		queueCli({ code: 0, stdout: '{"url":"https://primary.netlify.app"}' })
		await expect(deployNetlify('/tmp', '123e4567-e89b-42d3-a456-426614174000')).resolves.toBe(
			'https://primary.netlify.app',
		)

		queueCli({ code: 0, stdout: '{"deploy_url":"https://draft.netlify.app"}' })
		await expect(deployNetlify('/tmp', '123e4567-e89b-42d3-a456-426614174000')).resolves.toBe(
			'https://draft.netlify.app',
		)

		queueCli({ code: 1, stderr: 'service unavailable' })
		await expect(deployNetlify('/tmp', '123e4567-e89b-42d3-a456-426614174000')).rejects.toThrow(
			/could not deploy/,
		)
	})

	it('rejects malformed site IDs and deployment output', async () => {
		await expect(ensureNetlifySite('/tmp', 'acme', 'not-a-uuid')).rejects.toThrow(/site ID is invalid/)
		queueCli({ code: 0, stdout: '{}' })
		await expect(deployNetlify('/tmp', '123e4567-e89b-42d3-a456-426614174000')).rejects.toThrow(
			/could not verify its URL/,
		)
		queueCli({ code: 0, stdout: '[]' })
		await expect(deployNetlify('/tmp', '123e4567-e89b-42d3-a456-426614174000')).rejects.toThrow(
			/could not verify its URL/,
		)
	})
})

describe('safe provider failures', () => {
	it.each([
		['authentication', 'not authenticated', /authentication or permission/],
		['conflict', '409 already exists', /project name already exists/],
		['quota', '429 quota limit', /service limit/],
		['generic', 'unexpected raw provider detail', /Check the provider dashboard/],
	])('classifies %s failures without returning raw output', async (_name, stderr, expected) => {
		queueCli({ code: 1, stderr })
		await expect(deployVercel('/tmp', 'team_ok')).rejects.toThrow(expected)
	})

	it('reports a missing bundled provider helper', async () => {
		hoisted.resolveFails = true
		await expect(deployVercel('/tmp', 'team_ok')).rejects.toThrow(/could not start its bundled Vercel/)
	})

	it('reports a provider package that does not expose the expected binary', async () => {
		hoisted.missingBin = true
		await expect(deployVercel('/tmp', 'team_ok')).rejects.toThrow(/could not start its bundled Vercel/)
	})

	it('reports failed interactive login without assuming a remote mutation', async () => {
		queueCli({ code: 1 }, { code: 1, stderr: 'login cancelled' })
		await expect(ensureVercelProject('/tmp', 'acme', 'team_ok')).rejects.toThrow(
			/No deployment change was made/,
		)
	})

	it('treats a missing process exit code as failure', async () => {
		queueCli({ code: null, stderr: 'process stopped' })
		await expect(deployVercel('/tmp', 'team_ok')).rejects.toThrow(/could not deploy/)
	})

	it('reports a provider process start failure', async () => {
		queueCli({ code: 1, error: true })
		await expect(deployVercel('/tmp', 'team_ok')).rejects.toThrow(/helper failed to start/)
	})
})

function queueCli(...results: FakeResult[]): void {
	for (const result of results) hoisted.spawn.mockImplementationOnce(() => fakeChild(result))
}

function fakeChild(result: FakeResult) {
	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter
		stderr: EventEmitter
		stdin: { end(value?: string): void; value?: string; ended?: boolean }
	}
	child.stdout = new EventEmitter()
	child.stderr = new EventEmitter()
	child.stdin = {
		end(value?: string) {
			this.value = value
			this.ended = true
		},
	}
	queueMicrotask(() => {
		if (result.error) {
			child.emit('error', new Error('spawn failed'))
			return
		}
		if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout))
		if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr))
		child.emit('close', result.code)
	})
	return child
}

function spawnedArgs(index: number): string[] {
	return hoisted.spawn.mock.calls[index]?.[1] as string[]
}

function stdinValue(index: number): string | undefined {
	return (hoisted.spawn.mock.results[index]?.value as { stdin?: { value?: string } })?.stdin?.value
}

function stdinEnded(index: number): boolean | undefined {
	return (hoisted.spawn.mock.results[index]?.value as { stdin?: { ended?: boolean } })?.stdin?.ended
}
