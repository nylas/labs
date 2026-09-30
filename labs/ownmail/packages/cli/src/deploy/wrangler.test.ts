import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * runWrangler shells out to the exact pinned Wrangler binary; every consumer here
 * makes irreversible Cloudflare changes (KV creation, secret writes, deploys).
 * The tests drive the child-process contract (exit codes + stdout/stderr) so a
 * regression in how we parse wrangler's output is caught before it corrupts a
 * user's deploy.
 */

// Controllable createRequire so we can exercise both the real bin field and the
// './bin/wrangler.js' fallback used when a wrangler build omits it.
const modCtl = vi.hoisted(() => ({
	pkg: { version: '4.114.0', bin: { wrangler: './bin/wrangler.js' } } as {
		version: string
		bin: Record<string, string>
	},
	resolveError: null as Error | null,
}))

vi.mock('node:module', () => {
	const req = ((id: string) => {
		if (id === 'wrangler/package.json') return modCtl.pkg
		throw new Error(`unexpected require: ${id}`)
	}) as unknown as { resolve: (id: string) => string } & ((id: string) => unknown)
	req.resolve = (id: string) => {
		if (modCtl.resolveError) throw modCtl.resolveError
		if (id === 'wrangler/package.json') return '/fake/node_modules/wrangler/package.json'
		throw new Error(`unexpected resolve: ${id}`)
	}
	return { createRequire: () => req }
})

type SpawnSpec = {
	code?: number | null
	stdout?: string
	stderr?: string
	error?: Error
	noStreams?: boolean
}

const spawnCtl = vi.hoisted(() => {
	const queue: SpawnSpec[] = []
	const calls: Array<{ args: unknown; options: unknown; child: FakeChild }> = []
	type FakeChild = {
		stdout: { on: (e: string, cb: (d: Buffer) => void) => void } | null
		stderr: { on: (e: string, cb: (d: Buffer) => void) => void } | null
		stdin: { write: (v: string) => void; end: () => void } | null
		on: (e: string, cb: (arg?: unknown) => void) => FakeChild
		_stdin: string
		_stdinEnded: boolean
	}
	const spawn = (_cmd: unknown, args: unknown, options: unknown): FakeChild => {
		const spec = queue.shift() ?? { code: 0, stdout: '', stderr: '' }
		const dataHandlers: { stdout?: (d: Buffer) => void; stderr?: (d: Buffer) => void } = {}
		const handlers: Record<string, (arg?: unknown) => void> = {}
		const child: FakeChild = {
			stdout: spec.noStreams
				? null
				: {
						on: (e, cb) => {
							if (e === 'data') dataHandlers.stdout = cb
						},
					},
			stderr: spec.noStreams
				? null
				: {
						on: (e, cb) => {
							if (e === 'data') dataHandlers.stderr = cb
						},
					},
			stdin: spec.noStreams
				? null
				: {
						write: (v) => {
							child._stdin += v
						},
						end: () => {
							child._stdinEnded = true
						},
					},
			on: (e, cb) => {
				handlers[e] = cb
				return child
			},
			_stdin: '',
			_stdinEnded: false,
		}
		calls.push({ args, options, child })
		queueMicrotask(() => {
			if (spec.stdout && dataHandlers.stdout) dataHandlers.stdout(Buffer.from(spec.stdout))
			if (spec.stderr && dataHandlers.stderr) dataHandlers.stderr(Buffer.from(spec.stderr))
			if (spec.error) handlers.error?.(spec.error)
			else handlers.close?.(spec.code)
		})
		return child
	}
	return { queue, calls, spawn }
})

vi.mock('node:child_process', () => ({ spawn: spawnCtl.spawn }))

import {
	cloudflareApiTokenConfigured,
	deploy,
	ensureKvNamespace,
	listCloudflareWorkers,
	putSecret,
	runWrangler,
	workerHasSecret,
	wranglerLoggedIn,
	wranglerLogin,
} from './wrangler.js'

const HEX32 = 'a'.repeat(32)

beforeEach(() => {
	vi.clearAllMocks()
	spawnCtl.queue.length = 0
	spawnCtl.calls.length = 0
	modCtl.pkg = { version: '4.114.0', bin: { wrangler: './bin/wrangler.js' } }
	modCtl.resolveError = null
})

afterEach(() => {
	delete process.env.CLOUDFLARE_API_TOKEN
	delete process.env.CLOUDFLARE_ACCOUNT_ID
	vi.unstubAllGlobals()
})

describe('runWrangler', () => {
	it('captures stdout/stderr and resolves with the exit code', async () => {
		spawnCtl.queue.push({ code: 0, stdout: 'out', stderr: 'err' })
		const res = await runWrangler(['whoami'])
		expect(res).toEqual({ code: 0, stdout: 'out', stderr: 'err' })
	})

	it('passes through cwd and merged env', async () => {
		spawnCtl.queue.push({ code: 0 })
		await runWrangler(['x'], { cwd: '/work', env: { FOO: 'bar' } })
		const opts = spawnCtl.calls[0]?.options as { cwd: string; env: Record<string, string> }
		expect(opts.cwd).toBe('/work')
		expect(opts.env.FOO).toBe('bar')
	})

	it('defaults a missing exit code to 1', async () => {
		spawnCtl.queue.push({ code: null })
		const res = await runWrangler(['x'])
		expect(res.code).toBe(1)
	})

	it('explains how to recover when the deployment helper cannot start', async () => {
		spawnCtl.queue.push({ error: new Error('spawn ENOENT') })
		await expect(runWrangler(['x'])).rejects.toThrow(/npm can reach the registry/)
	})

	it('downloads the exact pinned helper when no local Wrangler is installed', async () => {
		modCtl.resolveError = new Error('MODULE_NOT_FOUND')
		spawnCtl.queue.push({ code: 0 })
		await expect(runWrangler(['x'])).resolves.toEqual({ code: 0, stdout: '', stderr: '' })
		expect(spawnCtl.calls[0]?.args).toEqual([
			'exec',
			'--yes',
			'--package=wrangler@4.114.0',
			'--',
			'wrangler',
			'x',
		])
	})

	it('uses inherited stdio and no pipes when interactive', async () => {
		spawnCtl.queue.push({ code: 0, noStreams: true })
		await runWrangler(['login'], { interactive: true })
		const opts = spawnCtl.calls[0]?.options as { stdio: string }
		expect(opts.stdio).toBe('inherit')
	})
})

describe('wranglerLoggedIn', () => {
	it('is true when whoami exits 0 without an auth warning', async () => {
		spawnCtl.queue.push({ code: 0, stdout: 'You are logged in as foo@bar.com' })
		expect(await wranglerLoggedIn()).toBe(true)
	})

	it('is false when whoami reports not authenticated', async () => {
		spawnCtl.queue.push({ code: 0, stdout: 'You are not authenticated. Please run wrangler login' })
		expect(await wranglerLoggedIn()).toBe(false)
	})

	it('is false when whoami exits non-zero', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'boom' })
		expect(await wranglerLoggedIn()).toBe(false)
	})
})

describe('cloudflareApiTokenConfigured', () => {
	it('is true only when a non-empty token is present', () => {
		process.env.CLOUDFLARE_API_TOKEN = '  token  '
		expect(cloudflareApiTokenConfigured()).toBe(true)
	})

	it('is false when the token is unset or blank', () => {
		delete process.env.CLOUDFLARE_API_TOKEN
		expect(cloudflareApiTokenConfigured()).toBe(false)
		process.env.CLOUDFLARE_API_TOKEN = '   '
		expect(cloudflareApiTokenConfigured()).toBe(false)
	})
})

describe('wranglerLogin', () => {
	it('resolves when login succeeds (openBrowser=true)', async () => {
		spawnCtl.queue.push({ code: 0, noStreams: true })
		await expect(wranglerLogin({ openBrowser: true })).resolves.toBeUndefined()
		const args = spawnCtl.calls[0]?.args as string[]
		expect(args).toContain('--browser=true')
	})

	it('gives credential recovery guidance when login fails (openBrowser=false default)', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'authentication failed', noStreams: true })
		await expect(wranglerLogin()).rejects.toThrow(/choose Wrangler OAuth/)
		const args = spawnCtl.calls[0]?.args as string[]
		expect(args).toContain('--browser=false')
	})

	it('classifies a captured login error without showing its raw output', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'authentication failed' })
		await expect(wranglerLogin()).rejects.toThrow(/current credentials were rejected/)
	})
})

describe('ensureKvNamespace', () => {
	it('returns an existing namespace matched by exact title', async () => {
		spawnCtl.queue.push({ code: 0, stdout: JSON.stringify([{ id: HEX32, title: 'mykv' }]) })
		expect(await ensureKvNamespace('mykv')).toBe(HEX32)
	})

	it('returns an existing namespace matched by suffix', async () => {
		spawnCtl.queue.push({ code: 0, stdout: JSON.stringify([{ id: HEX32, title: 'proj-mykv' }]) })
		expect(await ensureKvNamespace('mykv')).toBe(HEX32)
	})

	it('returns the ID Cloudflare reports after creating session storage', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' })
		spawnCtl.queue.push({ code: 0, stdout: `Created namespace with id: "${HEX32}"` })
		expect(await ensureKvNamespace('mykv')).toBe(HEX32)
	})

	it('fails closed when the namespace inventory is unparseable', async () => {
		spawnCtl.queue.push({ code: 0, stdout: 'not json' })
		await expect(ensureKvNamespace('mykv')).rejects.toThrow(/did not create anything/)
		expect(spawnCtl.calls).toHaveLength(1)
	})

	it('fails closed when Cloudflare rejects the namespace inventory request', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'permission denied' })
		await expect(ensureKvNamespace('mykv')).rejects.toThrow(/current credentials were rejected/)
		expect(spawnCtl.calls).toHaveLength(1)
	})

	it('gives recovery guidance when creation fails', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' }) // list ok, none found
		spawnCtl.queue.push({ code: 1, stderr: 'create denied' })
		await expect(ensureKvNamespace('mykv')).rejects.toThrow(/could not create session storage/)
	})

	it('gives limit recovery guidance when creation reaches quota', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' }) // list ok, none found
		spawnCtl.queue.push({ code: 1, stdout: 'quota exceeded' }) // no stderr
		await expect(ensureKvNamespace('mykv')).rejects.toThrow(/reached a service limit/)
	})

	it('gives conflict recovery guidance when storage already exists', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' })
		spawnCtl.queue.push({ code: 1, stderr: 'resource conflict' })
		await expect(ensureKvNamespace('mykv')).rejects.toThrow(/resource conflicts/)
	})

	it('gives network recovery guidance when Cloudflare is unavailable', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' })
		spawnCtl.queue.push({ code: 1, stderr: 'network timeout' })
		await expect(ensureKvNamespace('mykv')).rejects.toThrow(/service or network connection was unavailable/)
	})

	it('matches a relisted namespace by suffix when the create output has no id', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' }) // list none
		spawnCtl.queue.push({ code: 0, stdout: 'created, but no id here' }) // create no id
		spawnCtl.queue.push({ code: 0, stdout: JSON.stringify([{ id: HEX32, title: 'proj-mykv' }]) }) // relist suffix
		expect(await ensureKvNamespace('mykv')).toBe(HEX32)
	})

	it('falls back to relisting when the create output has no id', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' }) // list none
		spawnCtl.queue.push({ code: 0, stdout: 'created, but no id here' }) // create no id
		spawnCtl.queue.push({ code: 0, stdout: JSON.stringify([{ id: HEX32, title: 'mykv' }]) }) // relist
		expect(await ensureKvNamespace('mykv')).toBe(HEX32)
	})

	it('throws when even the relist cannot determine the id', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' }) // list none
		spawnCtl.queue.push({ code: 0, stdout: 'created, but no id here' }) // create no id
		spawnCtl.queue.push({ code: 0, stdout: '[]' }) // relist none
		await expect(ensureKvNamespace('mykv')).rejects.toThrow(/may have created session storage/)
	})

	it('gives the same safe recovery guidance when the relist is unreadable', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' })
		spawnCtl.queue.push({ code: 0, stdout: 'created, but no id here' })
		spawnCtl.queue.push({ code: 0, stdout: 'not json' })
		await expect(ensureKvNamespace('mykv')).rejects.toThrow(/may have created session storage/)
	})

	it('explains the result is unknown when Cloudflare cannot confirm new storage', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' })
		spawnCtl.queue.push({ code: 0, stdout: 'created, but no id here' })
		spawnCtl.queue.push({ code: 1, stderr: 'network timeout' })
		await expect(ensureKvNamespace('mykv')).rejects.toThrow(/result may be unknown/)
	})
})

describe('workerHasSecret', () => {
	it('reports an existing secret from the names Cloudflare returns', async () => {
		spawnCtl.queue.push({
			code: 0,
			stdout: JSON.stringify([
				{ name: 'NYLAS_API_KEY', type: 'secret_text' },
				{ name: 'SESSION_SECRET', type: 'secret_text' },
			]),
		})
		expect(await workerHasSecret('worker', 'SESSION_SECRET')).toBe(true)
		expect(spawnCtl.calls[0]?.args).toEqual(expect.arrayContaining(['secret', 'list', '--name', 'worker']))
	})

	it('reports a missing secret on a worker that has never held one', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' })
		expect(await workerHasSecret('worker', 'SESSION_SECRET')).toBe(false)
	})

	it('fails closed when Cloudflare rejects the secret inventory request', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'permission denied' })
		await expect(workerHasSecret('worker', 'SESSION_SECRET')).rejects.toThrow(
			/current credentials were rejected/,
		)
	})

	it('fails closed when the secret inventory is unparseable', async () => {
		spawnCtl.queue.push({ code: 0, stdout: 'not json' })
		await expect(workerHasSecret('worker', 'SESSION_SECRET')).rejects.toThrow(
			/unreadable deployment secret inventory/,
		)
	})
})

describe('putSecret', () => {
	it('pipes the value to wrangler secret put on success', async () => {
		spawnCtl.queue.push({ code: 0 })
		await expect(putSecret('worker', 'API_KEY', 'sekret')).resolves.toBeUndefined()
		expect(spawnCtl.calls[0]?.child._stdin).toBe('sekret')
		expect(spawnCtl.calls[0]?.child._stdinEnded).toBe(true)
	})

	it('gives safe recovery guidance when the secret write fails', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'nope' })
		await expect(putSecret('worker', 'API_KEY', 'sekret')).rejects.toThrow(
			/could not store deployment secrets/,
		)
	})

	it('does not expose Wrangler output when a secret write reaches quota', async () => {
		spawnCtl.queue.push({ code: 1, stdout: 'quota exceeded' })
		await expect(putSecret('worker', 'API_KEY', 'sekret')).rejects.toThrow(/reached a service limit/)
	})
})

describe('deploy', () => {
	it('returns the workers.dev URL parsed from stdout', async () => {
		spawnCtl.queue.push({
			code: 0,
			stdout: 'Published to https://my-app.workers.dev\nDone.',
		})
		expect(await deploy('/cfg')).toBe('https://my-app.workers.dev')
	})

	it('explains safe recovery when deploy succeeds but prints no URL', async () => {
		spawnCtl.queue.push({ code: 0, stdout: 'Published, somewhere.' })
		await expect(deploy('/cfg')).rejects.toThrow(/may have deployed/)
	})

	it('gives safe recovery guidance when deploy fails', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'deploy error' })
		await expect(deploy('/cfg')).rejects.toThrow(/could not deploy the mailbox app/)
	})

	it('classifies expired credentials without exposing Wrangler output', async () => {
		spawnCtl.queue.push({ code: 1, stdout: 'auth expired' })
		await expect(deploy('/cfg')).rejects.toThrow(/current credentials were rejected/)
	})
})

describe('Wrangler acquisition fallback', () => {
	it('downloads the pinned package when the local package omits its bin field', async () => {
		modCtl.pkg = { version: '4.114.0', bin: {} }
		spawnCtl.queue.push({ code: 0 })
		await runWrangler(['whoami'])
		const args = spawnCtl.calls[0]?.args as string[]
		expect(args).toEqual(expect.arrayContaining(['--package=wrangler@4.114.0', '--', 'wrangler', 'whoami']))
	})
})

describe('listCloudflareWorkers', () => {
	const ACCOUNT = 'b'.repeat(32)

	/** Stubs the Cloudflare API per path; unknown paths fail the test. */
	function stubCloudflare(routes: Record<string, Response>) {
		const fetchMock = vi.fn(async (input: string | URL) => {
			const path = String(input).replace('https://api.cloudflare.com/client/v4', '')
			const response = routes[path]
			if (!response) throw new Error(`unexpected ${path}`)
			return response
		})
		vi.stubGlobal('fetch', fetchMock)
		return fetchMock
	}

	it("lists matching Workers with their workers.dev URLs using Wrangler's own sign-in", async () => {
		spawnCtl.queue.push(
			{ code: 0, stdout: JSON.stringify({ type: 'oauth', token: 'tok-1' }) },
			{ code: 0, stdout: JSON.stringify({ accounts: [{ id: ACCOUNT }, { id: 'not-an-account' }] }) },
		)
		const fetchMock = stubCloudflare({
			[`/accounts/${ACCOUNT}/workers/subdomain`]: Response.json({
				success: true,
				result: { subdomain: 'me' },
			}),
			[`/accounts/${ACCOUNT}/workers/scripts`]: Response.json({
				success: true,
				result: [{ id: 'acme-ownmail' }, { id: 'unrelated' }, { id: 'bad name-ownmail' }],
			}),
		})

		await expect(listCloudflareWorkers('-ownmail')).resolves.toEqual([
			{ name: 'acme-ownmail', url: 'https://acme-ownmail.me.workers.dev' },
		])
		expect(spawnCtl.calls.map((call) => call.args)).toEqual([
			expect.arrayContaining(['auth', 'token', '--json']),
			expect.arrayContaining(['whoami', '--json']),
		])
		expect(fetchMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ headers: { Authorization: 'Bearer tok-1' } }),
		)
	})

	it('uses a configured API token and account without asking Wrangler', async () => {
		process.env.CLOUDFLARE_API_TOKEN = 'env-token'
		process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT
		stubCloudflare({
			[`/accounts/${ACCOUNT}/workers/subdomain`]: Response.json({ success: true, result: {} }),
		})

		// An account without a workers.dev subdomain has no URL to resume from.
		await expect(listCloudflareWorkers('-ownmail')).resolves.toEqual([])
		expect(spawnCtl.calls).toHaveLength(0)
	})

	it('never puts the token in an error when Cloudflare refuses the request', async () => {
		process.env.CLOUDFLARE_API_TOKEN = 'secret-token'
		process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT
		stubCloudflare({ [`/accounts/${ACCOUNT}/workers/subdomain`]: new Response('', { status: 403 }) })

		const error = (await listCloudflareWorkers('-ownmail').catch((caught: unknown) => caught)) as Error
		expect(error.message).toMatch(/did not allow OwnMail to list your Workers/)
		expect(error.message).not.toContain('secret-token')
	})

	it.each([
		{
			name: 'an unreadable token',
			spawns: [{ code: 0, stdout: 'nope' }],
			error: /unreadable sign-in details/,
		},
		{
			name: 'an empty token',
			spawns: [{ code: 0, stdout: '{"token":""}' }],
			error: /unreadable sign-in details/,
		},
		{
			name: 'a failed account lookup',
			spawns: [
				{ code: 0, stdout: '{"token":"t"}' },
				{ code: 1, stderr: 'Not authenticated' },
			],
			error: /credentials were rejected/,
		},
		{
			name: 'an unreadable account list',
			spawns: [
				{ code: 0, stdout: '{"token":"t"}' },
				{ code: 0, stdout: 'nope' },
			],
			error: /unreadable account list/,
		},
	])('fails closed on $name', async ({ spawns, error }) => {
		spawnCtl.queue.push(...spawns)

		await expect(listCloudflareWorkers('-ownmail')).rejects.toThrow(error)
	})

	it('finds nothing when Wrangler reports no accounts or the configured account is invalid', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '{"token":"t"}' }, { code: 0, stdout: '{}' })
		await expect(listCloudflareWorkers('-ownmail')).resolves.toEqual([])

		process.env.CLOUDFLARE_API_TOKEN = 't'
		process.env.CLOUDFLARE_ACCOUNT_ID = 'not-an-account'
		await expect(listCloudflareWorkers('-ownmail')).resolves.toEqual([])
	})

	it.each([
		{ name: 'is unreachable', response: new Error('offline'), error: /Could not reach Cloudflare/ },
		{ name: 'fails', response: new Response('', { status: 500 }), error: /HTTP 500/ },
	])('reports when Cloudflare $name', async ({ response, error }) => {
		process.env.CLOUDFLARE_API_TOKEN = 't'
		process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				if (response instanceof Error) throw response
				return response
			}),
		)

		await expect(listCloudflareWorkers('-ownmail')).rejects.toThrow(error)
	})

	it('treats unreadable or unsuccessful listings as no Workers', async () => {
		process.env.CLOUDFLARE_API_TOKEN = 't'
		process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT
		stubCloudflare({
			[`/accounts/${ACCOUNT}/workers/subdomain`]: Response.json({
				success: true,
				result: { subdomain: 'me' },
			}),
			[`/accounts/${ACCOUNT}/workers/scripts`]: new Response('not json'),
		})
		await expect(listCloudflareWorkers('-ownmail')).resolves.toEqual([])

		stubCloudflare({
			[`/accounts/${ACCOUNT}/workers/subdomain`]: Response.json({
				success: false,
				result: { subdomain: 'me' },
			}),
		})
		await expect(listCloudflareWorkers('-ownmail')).resolves.toEqual([])

		stubCloudflare({
			[`/accounts/${ACCOUNT}/workers/subdomain`]: Response.json({
				success: true,
				result: { subdomain: 'me' },
			}),
			[`/accounts/${ACCOUNT}/workers/scripts`]: Response.json({ success: true, result: [{ id: 7 }] }),
		})
		await expect(listCloudflareWorkers('-ownmail')).resolves.toEqual([])
	})

	it('explains a failed Wrangler sign-in lookup', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'Not authenticated' })

		await expect(listCloudflareWorkers('-ownmail')).rejects.toThrow(/credentials were rejected/)
	})
})
