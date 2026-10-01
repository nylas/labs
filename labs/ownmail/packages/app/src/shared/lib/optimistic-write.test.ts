import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { recordOptimisticWrite, undoOptimisticWrite } from './optimistic-write.js'

const root = ['calendar', 'ada@ownmail.com']
const march = [...root, 'range', 1, 2]
const april = [...root, 'range', 3, 4]

function seed() {
	const client = new QueryClient()
	client.setQueryData(march, { events: ['standup'] })
	client.setQueryData(april, { events: ['review'] })
	client.setQueryData(['calendar', 'grace@ownmail.com', 'range', 1, 2], { events: ['grace'] })
	return client
}

describe('optimistic write', () => {
	it('records only the entries the write changed', () => {
		const client = seed()

		const written = recordOptimisticWrite(client, root, () => {
			client.setQueryData(march, { events: ['standup', 'lunch'] })
			// Rewriting an entry with an equal value is not a change.
			client.setQueryData(april, { events: ['review'] })
		})

		expect(written.map((entry) => entry.queryKey)).toEqual([march])
		expect(written[0]).toMatchObject({
			before: { events: ['standup'] },
			after: { events: ['standup', 'lunch'] },
		})
	})

	it('undoes the write when its request fails', () => {
		const client = seed()
		const written = recordOptimisticWrite(client, root, () =>
			client.setQueryData(march, { events: ['standup', 'lunch'] }),
		)

		undoOptimisticWrite(client, written)

		expect(client.getQueryData(march)).toEqual({ events: ['standup'] })
	})

	it('keeps a refetch that landed mid-mutation instead of restoring the older snapshot over it', () => {
		const client = seed()
		const written = recordOptimisticWrite(client, root, () =>
			client.setQueryData(march, { events: ['standup', 'lunch'] }),
		)
		// The server answers a poll while the request is still in flight.
		client.setQueryData(march, { events: ['standup', 'moved-by-someone-else'] })

		undoOptimisticWrite(client, written)

		expect(client.getQueryData(march)).toEqual({ events: ['standup', 'moved-by-someone-else'] })
	})

	it('restores an entry the write removed, and tolerates a mutation that never wrote', () => {
		const client = seed()
		const written = recordOptimisticWrite(client, root, () =>
			client.removeQueries({ queryKey: march, exact: true }),
		)

		undoOptimisticWrite(client, written)
		undoOptimisticWrite(client, undefined)

		expect(client.getQueryData(march)).toEqual({ events: ['standup'] })
	})
})
