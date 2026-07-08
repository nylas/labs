import { requireNylasProviderId } from './ids.js'

export type ThreadStateInput = {
	threadId: string
	unread?: boolean
	starred?: boolean
	folder?: string
}

export function normalizeThreadStateInput(input: ThreadStateInput): ThreadStateInput {
	if (input.unread !== undefined && typeof input.unread !== 'boolean') throw new Error('Invalid unread state')
	if (input.starred !== undefined && typeof input.starred !== 'boolean')
		throw new Error('Invalid starred state')
	return {
		...input,
		threadId: requireNylasProviderId(input.threadId, 'thread'),
		...(input.folder !== undefined ? { folder: requireNylasProviderId(input.folder, 'folder') } : {}),
	}
}
