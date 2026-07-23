import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
	mkdirSync: vi.fn(),
	readFileSync: vi.fn(),
	rmSync: vi.fn(),
	writeFileSync: vi.fn(),
}))

vi.mock('node:fs', () => hoisted)
vi.mock('./store.js', () => ({ configDir: () => '/config/ownmail' }))

import { acquireProjectLock } from './project-lock.js'

beforeEach(() => {
	vi.clearAllMocks()
	vi.restoreAllMocks()
})

describe('acquireProjectLock', () => {
	it.each(['', 'UPPER', '../escape', 'two words', 'a'.repeat(41)])(
		'rejects an unsafe project name before touching disk: %j',
		(slug) => {
			expect(() => acquireProjectLock(slug)).toThrow(/Project name is invalid/)
			expect(hoisted.mkdirSync).not.toHaveBeenCalled()
		},
	)

	it('creates a private lock and releases it exactly once', () => {
		const release = acquireProjectLock('acme')

		expect(hoisted.mkdirSync).toHaveBeenNthCalledWith(1, '/config/ownmail/locks', {
			recursive: true,
			mode: 0o700,
		})
		expect(hoisted.mkdirSync).toHaveBeenNthCalledWith(2, '/config/ownmail/locks/acme.lock', {
			mode: 0o700,
		})
		expect(hoisted.writeFileSync).toHaveBeenCalledWith(
			'/config/ownmail/locks/acme.lock/owner.json',
			expect.stringMatching(/"pid":\d+.*"startedAt":\d+/),
			{ mode: 0o600, flag: 'wx' },
		)

		release()
		release()

		expect(hoisted.rmSync).toHaveBeenCalledTimes(1)
		expect(hoisted.rmSync).toHaveBeenCalledWith('/config/ownmail/locks/acme.lock', {
			recursive: true,
			force: true,
		})
	})

	it('reports a live owner without removing its lock', () => {
		hoisted.mkdirSync
			.mockImplementationOnce(() => undefined)
			.mockImplementationOnce(() => {
				throw Object.assign(new Error('exists'), { code: 'EEXIST' })
			})
		hoisted.readFileSync.mockReturnValue(JSON.stringify({ pid: 1234, startedAt: Date.now() }))
		vi.spyOn(process, 'kill').mockReturnValue(true)

		expect(() => acquireProjectLock('acme')).toThrow(/Another OwnMail command/)

		expect(process.kill).toHaveBeenCalledWith(1234, 0)
		expect(hoisted.rmSync).not.toHaveBeenCalled()
	})

	it('removes a dead owner and acquires the lock', () => {
		hoisted.mkdirSync
			.mockImplementationOnce(() => undefined)
			.mockImplementationOnce(() => {
				throw Object.assign(new Error('exists'), { code: 'EEXIST' })
			})
			.mockImplementationOnce(() => undefined)
		hoisted.readFileSync.mockReturnValue(JSON.stringify({ pid: 1234, startedAt: 1 }))
		vi.spyOn(process, 'kill').mockImplementation(() => {
			throw Object.assign(new Error('missing'), { code: 'ESRCH' })
		})

		const release = acquireProjectLock('acme')
		release()

		expect(hoisted.rmSync).toHaveBeenCalledTimes(2)
	})

	it('treats permission errors while checking a process as a live owner', () => {
		hoisted.mkdirSync
			.mockImplementationOnce(() => undefined)
			.mockImplementationOnce(() => {
				throw Object.assign(new Error('exists'), { code: 'EEXIST' })
			})
		hoisted.readFileSync.mockReturnValue(JSON.stringify({ pid: 1234, startedAt: 1 }))
		vi.spyOn(process, 'kill').mockImplementation(() => {
			throw Object.assign(new Error('denied'), { code: 'EPERM' })
		})

		expect(() => acquireProjectLock('acme')).toThrow(/Another OwnMail command/)
		expect(hoisted.rmSync).not.toHaveBeenCalled()
	})

	it.each([
		['invalid JSON', '{'],
		['scalar', '1'],
		['null', 'null'],
		['missing pid', JSON.stringify({ startedAt: 1 })],
		['string pid', JSON.stringify({ pid: '1', startedAt: 1 })],
		['fractional pid', JSON.stringify({ pid: 1.5, startedAt: 1 })],
		['zero pid', JSON.stringify({ pid: 0, startedAt: 1 })],
		['missing start', JSON.stringify({ pid: 1 })],
		['string start', JSON.stringify({ pid: 1, startedAt: '1' })],
		['fractional start', JSON.stringify({ pid: 1, startedAt: 1.5 })],
		['zero start', JSON.stringify({ pid: 1, startedAt: 0 })],
	])('does not remove a lock with %s owner metadata', (_label, owner) => {
		hoisted.mkdirSync
			.mockImplementationOnce(() => undefined)
			.mockImplementationOnce(() => {
				throw Object.assign(new Error('exists'), { code: 'EEXIST' })
			})
		hoisted.readFileSync.mockReturnValue(owner)

		expect(() => acquireProjectLock('acme')).toThrow(/Another OwnMail command/)
		expect(hoisted.rmSync).not.toHaveBeenCalled()
	})

	it('reports when another operation wins the dead-lock recovery race', () => {
		hoisted.mkdirSync
			.mockImplementationOnce(() => undefined)
			.mockImplementationOnce(() => {
				throw Object.assign(new Error('exists'), { code: 'EEXIST' })
			})
			.mockImplementationOnce(() => {
				throw new Error('raced')
			})
		hoisted.readFileSync.mockReturnValue(JSON.stringify({ pid: 1234, startedAt: 1 }))
		vi.spyOn(process, 'kill').mockImplementation(() => {
			throw Object.assign(new Error('missing'), { code: 'ESRCH' })
		})

		expect(() => acquireProjectLock('acme')).toThrow(/started changing/)
	})

	it('cleans up if writing owner metadata fails', () => {
		hoisted.writeFileSync.mockImplementation(() => {
			throw new Error('disk failure')
		})

		expect(() => acquireProjectLock('acme')).toThrow(/disk failure/)
		expect(hoisted.rmSync).toHaveBeenCalledWith('/config/ownmail/locks/acme.lock', {
			recursive: true,
			force: true,
		})
	})

	it('does not misreport lock-directory failures as concurrent work', () => {
		hoisted.mkdirSync
			.mockImplementationOnce(() => undefined)
			.mockImplementationOnce(() => {
				throw Object.assign(new Error('denied'), { code: 'EACCES' })
			})

		expect(() => acquireProjectLock('acme')).toThrow(/could not create a safe operation lock/)
	})
})
