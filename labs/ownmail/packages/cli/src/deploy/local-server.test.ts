import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
	spawn: vi.fn(),
	createServer: vi.fn(),
	checkAppHealth: vi.fn(),
	portResults: [] as boolean[],
}))

vi.mock('node:child_process', () => ({ spawn: hoisted.spawn }))
vi.mock('node:net', () => ({ createServer: hoisted.createServer }))
vi.mock('./app-health.js', () => ({ checkAppHealth: hoisted.checkAppHealth }))

import { findLocalPort, startLocalServer } from './local-server.js'

beforeEach(() => {
	vi.clearAllMocks()
	hoisted.portResults.length = 0
	hoisted.createServer.mockImplementation(() => fakeNetServer(hoisted.portResults.shift() ?? true))
	hoisted.checkAppHealth.mockResolvedValue(true)
	hoisted.spawn.mockImplementation(() => fakeChild())
})

describe('findLocalPort', () => {
	it('returns the preferred available loopback port', async () => {
		await expect(findLocalPort(4321)).resolves.toBe(4321)
	})

	it('falls back to port 3000 and skips ports already in use', async () => {
		hoisted.portResults.push(false, true)
		await expect(findLocalPort(80)).resolves.toBe(3001)
	})

	it('fails when the bounded port range is exhausted', async () => {
		hoisted.portResults.push(...Array.from({ length: 101 }, () => false))
		await expect(findLocalPort(65_500)).rejects.toThrow(/No available loopback port/)
	})
})

describe('startLocalServer', () => {
	const input = {
		dir: '/runtime/acme',
		port: 3000,
		environment: { NYLAS_API_KEY: 'secret', APP_NAME: 'acme' },
	}

	it('starts an attached loopback process and waits for health', async () => {
		await expect(startLocalServer(input)).resolves.toBe('http://localhost:3000')
		expect(hoisted.spawn).toHaveBeenCalledWith(
			process.execPath,
			['/runtime/acme/scripts/serve-node.mjs'],
			expect.objectContaining({
				cwd: '/runtime/acme',
				stdio: 'inherit',
				env: expect.objectContaining({ HOST: '127.0.0.1', PORT: '3000', NYLAS_API_KEY: 'secret' }),
			}),
		)
	})

	it('rejects invalid ports and environment boundaries', async () => {
		await expect(startLocalServer({ ...input, port: 80 })).rejects.toThrow(/between 1024 and 65535/)
		await expect(startLocalServer({ ...input, environment: { 'BAD-NAME': 'value' } })).rejects.toThrow(
			/environment is invalid/,
		)
		await expect(startLocalServer({ ...input, environment: { GOOD_NAME: 'line\nbreak' } })).rejects.toThrow(
			/environment is invalid/,
		)
		expect(hoisted.spawn).not.toHaveBeenCalled()
	})

	it('terminates a process that never becomes healthy', async () => {
		const child = fakeChild()
		hoisted.spawn.mockReturnValue(child)
		hoisted.checkAppHealth.mockResolvedValue(false)
		await expect(startLocalServer(input)).rejects.toThrow(/could not start/)
		expect(child.kill).toHaveBeenCalledWith('SIGTERM')
	})

	it('does not terminate a process that has already exited', async () => {
		const child = fakeChild()
		child.exitCode = 1
		hoisted.spawn.mockReturnValue(child)
		hoisted.checkAppHealth.mockResolvedValue(false)
		await expect(startLocalServer(input)).rejects.toThrow(/could not start/)
		expect(child.kill).not.toHaveBeenCalled()
	})

	it('fails when the child errors or exits during startup', async () => {
		for (const event of ['error', 'exit'] as const) {
			const child = fakeChild()
			hoisted.spawn.mockImplementationOnce(() => {
				queueMicrotask(() => child.emit(event))
				return child
			})
			await expect(startLocalServer(input)).rejects.toThrow(/could not start/)
		}
	})
})

function fakeNetServer(available: boolean) {
	const listeners = new Map<string, () => void>()
	return {
		unref: vi.fn(),
		once: vi.fn((event: string, callback: () => void) => {
			listeners.set(event, callback)
		}),
		listen: vi.fn((_port: number, _host: string, callback: () => void) => {
			queueMicrotask(() => (available ? callback() : listeners.get('error')?.()))
		}),
		close: vi.fn((callback: () => void) => callback()),
	}
}

function fakeChild() {
	const child = new EventEmitter() as EventEmitter & {
		exitCode: number | null
		kill: ReturnType<typeof vi.fn>
	}
	child.exitCode = null
	child.kill = vi.fn()
	return child
}
