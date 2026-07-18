import { describe, expect, it, vi } from 'vitest'
import { bumpChangeVersionsInKv, readChangeVersions } from './change-version.js'
import type { KvLike } from './platform.js'

function kv(values: Record<string, string>): KvLike {
	const store = new Map(Object.entries(values))
	return {
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value)
		}),
	}
}

describe('change version counters', () => {
	it('falls back safely when persisted counters are malformed or exceed safe integer range', async () => {
		const store = kv({
			'version:g': '9007199254740992',
			'version:g:mail': 'not-a-number',
			'version:g:contacts': '4',
		})
		expect(await readChangeVersions(store, 'g')).toEqual({
			version: 0,
			domains: { mail: 0, contacts: 4, calendar: 0 },
		})
	})

	it('deduplicates scoped increments while retaining the aggregate counter', async () => {
		const store = kv({})
		await bumpChangeVersionsInKv(store, 'g', ['mail', 'mail'])
		expect(await readChangeVersions(store, 'g')).toEqual({
			version: 1,
			domains: { mail: 1, contacts: 1, calendar: 1 },
		})
	})
})
