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

	it('rejects a malformed MIME content type', () => {
		expect(() =>
			normalizeOutboundAttachments([
				{ filename: 'notes.txt', content_type: 'not-a-mime-type', content: btoa('hello') },
			]),
		).toThrow('Invalid attachment type')
	})

	it('rejects content that is not valid base64', () => {
		expect(() =>
			normalizeOutboundAttachments([
				{ filename: 'notes.txt', content_type: 'text/plain', content: 'not*base64!' },
			]),
		).toThrow('Invalid attachment content')
	})

	it('passes through undefined so callers can omit attachments entirely', () => {
		expect(normalizeOutboundAttachments(undefined)).toBeUndefined()
	})

	it('rejects a non-array attachments field', () => {
		// The JSON API contract requires an array; anything else is a malformed request.
		expect(() => normalizeOutboundAttachments({ filename: 'x' })).toThrow('Invalid attachments')
	})

	it('rejects more attachments than the per-message limit allows', () => {
		const item = { filename: 'a.txt', content_type: 'text/plain', content: btoa('x') }
		expect(() => normalizeOutboundAttachments(Array(11).fill(item))).toThrow('Too many attachments')
	})

	it('rejects entries that are not objects', () => {
		expect(() => normalizeOutboundAttachments([null])).toThrow('Invalid attachment')
		expect(() => normalizeOutboundAttachments(['not-an-object'])).toThrow('Invalid attachment')
	})

	it('rejects an entry whose filename is missing', () => {
		// Missing filename normalizes to '' and must be rejected, not silently sent unnamed.
		expect(() => normalizeOutboundAttachments([{ content_type: 'text/plain', content: btoa('x') }])).toThrow(
			'Invalid attachment filename',
		)
	})

	it('defaults the content type and tolerates empty content', () => {
		// Optional fields: content_type falls back to octet-stream and absent content becomes ''.
		expect(normalizeOutboundAttachments([{ filename: 'blank.bin' }])).toEqual([
			{ filename: 'blank.bin', content_type: 'application/octet-stream', content: '' },
		])
	})

	it('returns undefined for an explicitly empty attachments array', () => {
		// An empty array is a well-formed but attachment-free request; it must normalize to
		// undefined (the "no attachments" signal) rather than an empty array, so callers omit
		// the attachments field entirely.
		expect(normalizeOutboundAttachments([])).toBeUndefined()
	})

	it('accounts for both one- and two-character base64 padding when measuring size', () => {
		// btoa('a') === 'YQ==' (2 pad chars) and btoa('abc') === 'YWJj' (no padding); both must
		// decode to correct byte counts so the 2 MB total is measured accurately.
		expect(
			normalizeOutboundAttachments([
				{ filename: 'one.bin', content_type: 'text/plain', content: btoa('a') },
				{ filename: 'three.bin', content_type: 'text/plain', content: btoa('abc') },
			]),
		).toEqual([
			{ filename: 'one.bin', content_type: 'text/plain', content: 'YQ==' },
			{ filename: 'three.bin', content_type: 'text/plain', content: 'YWJj' },
		])
	})
})
