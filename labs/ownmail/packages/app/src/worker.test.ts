import { describe, expect, it, vi } from 'vitest'

const handler = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@tanstack/react-start/server-entry', () => ({ default: handler }))

const { default: worker, InvitationLocks } = await import('./worker.js')

function durableStorage() {
	const values = new Map<string, unknown>()
	return {
		values,
		get: async (key: string) => values.get(key),
		put: async (key: string, value: unknown) => {
			values.set(key, value)
		},
		delete: async (key: string) => values.delete(key),
		setAlarm: vi.fn(async () => undefined),
	}
}

describe('Cloudflare worker entry', () => {
	it('serves the unchanged TanStack Start handler', () => {
		expect(worker).toBe(handler)
	})

	it('exposes atomic invitation claims through the Durable Object', async () => {
		const storage = durableStorage()
		const locks = new InvitationLocks({ storage } as never, {} as never)

		await expect(locks.putIfAbsent('token', 120)).resolves.toBe(true)
		await expect(locks.putIfAbsent('other', 120)).resolves.toBe(false)
		await expect(locks.read()).resolves.toBe('token')
		await locks.deleteIfValue('token')
		await expect(locks.read()).resolves.toBeNull()

		await expect(locks.claimRevision(4, 600)).resolves.toBe(true)
		await expect(locks.claimRevision(3, 600)).resolves.toBe(false)
		await expect(locks.alarm()).resolves.toBeUndefined()
		expect(storage.setAlarm).toHaveBeenCalled()
	})
})
