import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * runWrangler shells out to the bundled wrangler binary; every consumer here
 * makes irreversible Cloudflare changes (KV creation, secret writes, deploys).
 * The tests drive the child-process contract (exit codes + stdout/stderr) so a
 * regression in how we parse wrangler's output is caught before it corrupts a
 * user's deploy.
 */

// Controllable createRequire so we can exercise both the real bin field and the
// './bin/wrangler.js' fallback used when a wrangler build omits it.
const modCtl = vi.hoisted(() => ({
	pkg: { bin: { wrangler: './bin/wrangler.js' } } as { bin: Record<string, string> },
}))

vi.mock('node:module', () => {
	const req = ((id: string) => {
		if (id === 'wrangler/package.json') return modCtl.pkg
		throw new Error(`unexpected require: ${id}`)
	}) as unknown as { resolve: (id: string) => string } & ((id: string) => unknown)
	req.resolve = (id: string) => {
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
	putSecret,
	runWrangler,
	wranglerLoggedIn,
	wranglerLogin,
} from './wrangler.js'

const HEX32 = 'a'.repeat(32)

beforeEach(() => {
	vi.clearAllMocks()
	spawnCtl.queue.length = 0
	spawnCtl.calls.length = 0
	modCtl.pkg = { bin: { wrangler: './bin/wrangler.js' } }
})

afterEach(() => {
	delete process.env.CLOUDFLARE_API_TOKEN
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

	it('rejects when the process emits an error', async () => {
		spawnCtl.queue.push({ error: new Error('spawn ENOENT') })
		await expect(runWrangler(['x'])).rejects.toThrow('spawn ENOENT')
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

	it('throws when login fails (openBrowser=false default)', async () => {
		spawnCtl.queue.push({ code: 1, noStreams: true })
		await expect(wranglerLogin()).rejects.toThrow('Cloudflare login failed')
		const args = spawnCtl.calls[0]?.args as string[]
		expect(args).toContain('--browser=false')
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

	it('creates a namespace and parses the id from output when list is unparseable', async () => {
		spawnCtl.queue.push({ code: 0, stdout: 'not json' }) // list -> JSON.parse throws
		spawnCtl.queue.push({ code: 0, stdout: `Created namespace with id: "${HEX32}"` })
		expect(await ensureKvNamespace('mykv')).toBe(HEX32)
	})

	it('creates a namespace when the list call itself fails', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'list failed' }) // list skipped
		spawnCtl.queue.push({ code: 0, stdout: `id = ${HEX32}` })
		expect(await ensureKvNamespace('mykv')).toBe(HEX32)
	})

	it('throws when creation fails, surfacing stderr', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' }) // list ok, none found
		spawnCtl.queue.push({ code: 1, stderr: 'create denied' })
		await expect(ensureKvNamespace('mykv')).rejects.toThrow('create denied')
	})

	it('falls back to stdout in the create-failure message when stderr is empty', async () => {
		spawnCtl.queue.push({ code: 0, stdout: '[]' }) // list ok, none found
		spawnCtl.queue.push({ code: 1, stdout: 'quota exceeded' }) // no stderr
		await expect(ensureKvNamespace('mykv')).rejects.toThrow('quota exceeded')
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
		await expect(ensureKvNamespace('mykv')).rejects.toThrow('id could not be determined')
	})
})

describe('putSecret', () => {
	it('pipes the value to wrangler secret put on success', async () => {
		spawnCtl.queue.push({ code: 0 })
		await expect(putSecret('worker', 'API_KEY', 'sekret')).resolves.toBeUndefined()
		expect(spawnCtl.calls[0]?.child._stdin).toBe('sekret')
		expect(spawnCtl.calls[0]?.child._stdinEnded).toBe(true)
	})

	it('throws when the secret write fails', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'nope' })
		await expect(putSecret('worker', 'API_KEY', 'sekret')).rejects.toThrow('Failed to set secret API_KEY')
	})

	it('falls back to stdout in the failure message when stderr is empty', async () => {
		spawnCtl.queue.push({ code: 1, stdout: 'quota exceeded' })
		await expect(putSecret('worker', 'API_KEY', 'sekret')).rejects.toThrow('quota exceeded')
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

	it('throws when deploy succeeds but prints no URL', async () => {
		spawnCtl.queue.push({ code: 0, stdout: 'Published, somewhere.' })
		await expect(deploy('/cfg')).rejects.toThrow('no workers.dev URL')
	})

	it('throws when deploy fails', async () => {
		spawnCtl.queue.push({ code: 1, stderr: 'deploy error' })
		await expect(deploy('/cfg')).rejects.toThrow('wrangler deploy failed')
	})

	it('falls back to stdout in the failure message when stderr is empty', async () => {
		spawnCtl.queue.push({ code: 1, stdout: 'auth expired' })
		await expect(deploy('/cfg')).rejects.toThrow('auth expired')
	})
})

describe('wranglerBin fallback', () => {
	it('uses the default bin path when the wrangler package omits its bin field', async () => {
		modCtl.pkg = { bin: {} }
		spawnCtl.queue.push({ code: 0 })
		await runWrangler(['whoami'])
		const args = spawnCtl.calls[0]?.args as string[]
		expect(args[0]).toContain('bin/wrangler.js')
	})
})
