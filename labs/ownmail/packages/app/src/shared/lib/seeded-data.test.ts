import { describe, expect, it } from 'vitest'
import { seededData } from './seeded-data.js'

describe('seededData', () => {
	it('uses the query data once the cache entry has any', () => {
		expect(seededData({ id: 'fresh' }, { id: 'seed' })).toEqual({ id: 'fresh' })
	})

	it('falls back to the loader seed while a seedless cache entry has no data, so a render never sees undefined', () => {
		expect(seededData(undefined, { id: 'seed' })).toEqual({ id: 'seed' })
	})

	it('keeps legitimately empty data instead of replacing it with the seed', () => {
		expect(seededData([] as string[], ['seed'])).toEqual([])
		expect(seededData(null, { id: 'seed' } as { id: string } | null)).toBeNull()
	})
})
