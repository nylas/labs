import type { SendMessageRequest } from '@nylas-labs/cli-kit/v3'

export type OutboundAttachment = NonNullable<SendMessageRequest['attachments']>[number]

export const MAX_JSON_ATTACHMENTS = 10
export const MAX_JSON_ATTACHMENT_BYTES = 2 * 1024 * 1024

export function normalizeOutboundAttachments(input: unknown): OutboundAttachment[] | undefined {
	if (input === undefined) return undefined
	if (!Array.isArray(input)) throw new Error('Invalid attachments')
	if (input.length > MAX_JSON_ATTACHMENTS) throw new Error('Too many attachments')

	let totalBytes = 0
	const attachments = input.map((item) => {
		if (!item || typeof item !== 'object') throw new Error('Invalid attachment')
		const attachment = item as Record<string, unknown>
		const filename = String(attachment.filename ?? '').trim()
		const contentType = String(attachment.content_type ?? '').trim() || 'application/octet-stream'
		const content = String(attachment.content ?? '').trim()
		if (!filename || filename.length > 255 || hasUnsafeFilenameChar(filename)) {
			throw new Error('Invalid attachment filename')
		}
		if (contentType.length > 120 || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:\s*;.*)?$/.test(contentType)) {
			throw new Error('Invalid attachment type')
		}
		if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
			throw new Error('Invalid attachment content')
		}
		totalBytes += base64DecodedBytes(content)
		if (totalBytes > MAX_JSON_ATTACHMENT_BYTES) {
			throw new Error('Attachments must be under 2 MB total')
		}
		return { filename, content_type: contentType, content }
	})

	return attachments.length > 0 ? attachments : undefined
}

function base64DecodedBytes(value: string): number {
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
	return Math.floor((value.length * 3) / 4) - padding
}

function hasUnsafeFilenameChar(value: string): boolean {
	for (const char of value) {
		const code = char.charCodeAt(0)
		if (code < 32 || char === '/' || char === '\\') return true
	}
	return false
}
