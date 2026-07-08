import { describe, expect, it } from 'vitest'
import { MAX_JSON_ATTACHMENT_BYTES, normalizeOutboundAttachments } from './outbound-attachments.js'

describe('outbound attachment validation', () => {
	it('normalizes small Nylas JSON attachments', () => {
		expect(
			normalizeOutboundAttachments([
				{
					filename: 'notes.txt',
					content_type: 'text/plain',
					content: btoa('hello'),
				},
			]),
		).toEqual([{ filename: 'notes.txt', content_type: 'text/plain', content: 'aGVsbG8=' }])
	})

	it('rejects unsafe filenames and oversized JSON payloads', () => {
		expect(() =>
			normalizeOutboundAttachments([
				{ filename: '../secret.txt', content_type: 'text/plain', content: btoa('x') },
			]),
		).toThrow('Invalid attachment filename')

		const oversized = 'a'.repeat(Math.ceil((MAX_JSON_ATTACHMENT_BYTES + 1) / 3) * 4)
		expect(() =>
			normalizeOutboundAttachments([
				{ filename: 'large.bin', content_type: 'application/octet-stream', content: oversized },
			]),
		).toThrow('Attachments must be under 2 MB total')
	})
})
