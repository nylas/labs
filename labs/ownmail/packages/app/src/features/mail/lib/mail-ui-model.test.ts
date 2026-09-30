import { describe, expect, it } from 'vitest'
import type { MailThread } from '../state/mail-queries.js'
import { adjacentThreadId } from './mail-ui-model.js'

const thread = (id: string, received: number) =>
	({ id, latest_message_received_date: received }) as MailThread

describe('adjacentThreadId', () => {
	// Cache order is provider page order; the list renders newest first, so the
	// neighbour must follow what the reader actually sees.
	const threads = [thread('older', 100), thread('newest', 300), thread('middle', 200)]

	it('continues with the next conversation in display order', () => {
		expect(adjacentThreadId(threads, 'newest')).toBe('middle')
		expect(adjacentThreadId(threads, 'middle')).toBe('older')
	})

	it('steps back to the newer neighbour from the last conversation', () => {
		expect(adjacentThreadId(threads, 'older')).toBe('middle')
	})

	it('ignores a conversation repeated across overlapping pages', () => {
		// Without de-duplication the duplicate sorts right after itself and
		// archiving would "advance" to the conversation that was just moved.
		const overlapping = [
			thread('newest', 300),
			thread('middle', 200),
			thread('middle', 200),
			thread('older', 100),
		]
		expect(adjacentThreadId(overlapping, 'middle')).toBe('older')
	})

	it('has nothing to open for an unknown or only conversation', () => {
		expect(adjacentThreadId(threads, 'missing')).toBeUndefined()
		expect(adjacentThreadId([thread('only', 1)], 'only')).toBeUndefined()
		expect(adjacentThreadId([{ id: 'a' } as MailThread, { id: 'b' } as MailThread], 'a')).toBe('b')
	})
})
