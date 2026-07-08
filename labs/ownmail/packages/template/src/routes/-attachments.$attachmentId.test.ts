import { describe, expect, it } from 'vitest'
import { attachmentDownloadFilename, validNylasAttachmentDownloadId } from './attachments.$attachmentId.js'

describe('attachment download route helpers', () => {
	it('accepts provider attachment ids with special characters documented by Nylas', () => {
		expect(validNylasAttachmentDownloadId('att#abc=123')).toBe(true)
		expect(validNylasAttachmentDownloadId('message:id+provider@example')).toBe(true)
	})

	it('rejects missing, control-character, and overly long ids', () => {
		expect(validNylasAttachmentDownloadId(null)).toBe(false)
		expect(validNylasAttachmentDownloadId('')).toBe(false)
		expect(validNylasAttachmentDownloadId('att\nid')).toBe(false)
		expect(validNylasAttachmentDownloadId('a'.repeat(1001))).toBe(false)
	})

	it('keeps mock download filenames header-safe', () => {
		expect(attachmentDownloadFilename('att#abc=123')).toBe('att#abc=123')
		expect(attachmentDownloadFilename('../bad"name')).toBe('.._bad_name')
		expect(attachmentDownloadFilename('\n')).toBe('attachment')
	})
})
