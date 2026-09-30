import { describe, expect, it } from 'vitest'
import { InvitationLockState, type InvitationLockStorage } from './invitation-lock.js'

function memoryStorage() {
	const values = new Map<string, unknown>()
	const alarms: number[] = []
	const storage: InvitationLockStorage = {
		get: async <T>(key: string) => values.get(key) as T | undefined,
		put: async (key, value) => {
			values.set(key, value)
		},
		delete: async (key) => values.delete(key),
		setAlarm: async (time) => {
			alarms.push(time)
		},
	}
	return { storage, values, alarms }
}

function lockAt(start = 1_000_000) {
	const clock = { now: start }
	const memory = memoryStorage()
	return { lock: new InvitationLockState(memory.storage, () => clock.now), clock, ...memory }
}

describe('InvitationLockState', () => {
	it('lets exactly one caller hold the mutation lock until it expires', async () => {
		// Two workers racing to add the same invitation must not both proceed, or
		// the calendar gets duplicate events.
		const { lock, clock } = lockAt()
		await expect(lock.putIfAbsent('token-a', 120)).resolves.toBe(true)
		await expect(lock.putIfAbsent('token-b', 120)).resolves.toBe(false)
		await expect(lock.read()).resolves.toBe('token-a')

		// An abandoned lock (crashed request) must not block the invitation forever.
		clock.now += 120_000
		await expect(lock.read()).resolves.toBeNull()
		await expect(lock.putIfAbsent('token-b', 120)).resolves.toBe(true)
	})

	it('only releases the lock for the caller that still owns it', async () => {
		// A slow request whose lock expired and was re-acquired must not delete
		// the new owner's lock.
		const { lock } = lockAt()
		await lock.putIfAbsent('owner', 120)
		await lock.deleteIfValue('someone-else')
		await expect(lock.read()).resolves.toBe('owner')
		await lock.deleteIfValue('owner')
		await expect(lock.read()).resolves.toBeNull()
	})

	it('only lets a strictly newer invitation revision take over a creation claim', async () => {
		// An older SEQUENCE of the same invitation must never overwrite a newer
		// one's claim, or the stale revision would be written to the calendar.
		const { lock, clock } = lockAt()
		await expect(lock.claimRevision(2, 600)).resolves.toBe(true)
		await expect(lock.claimRevision(2, 600)).resolves.toBe(false)
		await expect(lock.claimRevision(1, 600)).resolves.toBe(false)
		await expect(lock.read()).resolves.toBe('2')
		await expect(lock.claimRevision(3, 600)).resolves.toBe(true)
		await expect(lock.read()).resolves.toBe('3')

		clock.now += 600_000
		await expect(lock.claimRevision(0, 600)).resolves.toBe(true)
	})

	it('schedules cleanup at expiry and removes only entries that have expired', async () => {
		const { lock, clock, values, alarms } = lockAt()
		await lock.expire()
		expect(alarms).toEqual([])

		await lock.putIfAbsent('token', 60)
		expect(alarms).toEqual([clock.now + 60_000])

		await lock.expire()
		expect(values.size).toBe(1)
		expect(alarms).toEqual([clock.now + 60_000, clock.now + 60_000])

		clock.now += 60_000
		await lock.expire()
		expect(values.size).toBe(0)
	})

	it('rejects malformed revisions, values, and expirations', async () => {
		const { lock } = lockAt()
		await expect(lock.claimRevision(-1, 60)).rejects.toThrow('Invalid lock revision')
		await expect(lock.claimRevision(1.5, 60)).rejects.toThrow('Invalid lock revision')
		await expect(lock.claimRevision(2_147_483_648, 60)).rejects.toThrow('Invalid lock revision')
		await expect(lock.putIfAbsent('', 60)).rejects.toThrow('Invalid lock value')
		await expect(lock.putIfAbsent('token', 0)).rejects.toThrow('Invalid lock expiration')
		await expect(lock.putIfAbsent('token', 86_401)).rejects.toThrow('Invalid lock expiration')
	})

	it('uses the wall clock by default', async () => {
		const { storage } = memoryStorage()
		const lock = new InvitationLockState(storage)
		await expect(lock.putIfAbsent('token', 60)).resolves.toBe(true)
		await expect(lock.read()).resolves.toBe('token')
	})
})
