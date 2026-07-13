import { requireNylasProviderId } from './ids.js'

export type ThreadListInput = {
	folderId?: string
	pageToken?: string
	q?: string
	starred?: boolean
}

export function normalizeThreadListInput(input: ThreadListInput): ThreadListInput {
	if (input.q !== undefined) {
		if (typeof input.q !== 'string' || input.q.length > 500) throw new Error('Search query too long')
	}
	if (input.starred !== undefined && typeof input.starred !== 'boolean') {
		throw new Error('Invalid starred filter')
	}
	return {
		...(input.folderId !== undefined ? { folderId: requireNylasProviderId(input.folderId, 'folder') } : {}),
		...(input.pageToken !== undefined
			? { pageToken: requireNylasProviderId(input.pageToken, 'page token') }
			: {}),
		...(input.q !== undefined ? { q: input.q } : {}),
		...(input.starred !== undefined ? { starred: input.starred } : {}),
	}
}
