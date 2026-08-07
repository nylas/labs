import { requireNylasProviderId } from '#server/ids'
import { requireValidMailSearchQuery } from '../lib/mail-search.js'

export type ThreadListInput = {
	folderId?: string
	pageToken?: string
	q?: string
	starred?: boolean
}

export function normalizeThreadListInput(input: ThreadListInput): ThreadListInput {
	const q = input.q !== undefined ? requireValidMailSearchQuery(input.q) : undefined
	if (input.starred !== undefined && typeof input.starred !== 'boolean') {
		throw new Error('Invalid starred filter')
	}
	return {
		...(input.folderId !== undefined ? { folderId: requireNylasProviderId(input.folderId, 'folder') } : {}),
		...(input.pageToken !== undefined
			? { pageToken: requireNylasProviderId(input.pageToken, 'page token') }
			: {}),
		...(q !== undefined ? { q } : {}),
		...(input.starred !== undefined ? { starred: input.starred } : {}),
	}
}
