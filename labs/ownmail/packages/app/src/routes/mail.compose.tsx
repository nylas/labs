import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { type ComposeRequest, useCompose } from '#features/mail/components/ComposeProvider'

type ComposeLinkSearch = {
	draft?: string
	folderId?: string
	threadId?: string
	to?: string
	subject?: string
	body?: string
	replyToMessageId?: string
}

/**
 * Compose is app state, not a page. This route only keeps old links and
 * bookmarks working: it opens the composer from the link's fields over the
 * folder (or conversation) it names, and replaces itself in history.
 */
export const Route = createFileRoute('/mail/compose')({
	validateSearch: (search): ComposeLinkSearch => ({
		...(typeof search.draft === 'string' ? { draft: search.draft } : {}),
		...(typeof search.folderId === 'string' ? { folderId: search.folderId } : {}),
		...(typeof search.threadId === 'string' ? { threadId: search.threadId } : {}),
		...(typeof search.to === 'string' ? { to: search.to } : {}),
		...(typeof search.subject === 'string' ? { subject: search.subject } : {}),
		...(typeof search.body === 'string' && search.body.length <= 4000 ? { body: search.body } : {}),
		...(typeof search.replyToMessageId === 'string' ? { replyToMessageId: search.replyToMessageId } : {}),
	}),
	component: ComposeLink,
})

/** The composer a compose link describes. */
export function composeRequestFromLink(search: ComposeLinkSearch): ComposeRequest {
	if (search.draft) return { kind: 'draft', draftId: search.draft }
	return {
		kind: search.replyToMessageId ? 'reply' : 'new',
		...(search.threadId ? { threadId: search.threadId } : {}),
		...(search.to ? { to: search.to } : {}),
		...(search.subject ? { subject: search.subject } : {}),
		...(search.body ? { body: search.body } : {}),
		...(search.replyToMessageId ? { replyToMessageId: search.replyToMessageId } : {}),
	}
}

function ComposeLink() {
	const search = Route.useSearch()
	const navigate = useNavigate()
	const { openCompose } = useCompose()
	const handled = useRef(false)

	useEffect(() => {
		if (handled.current) return
		handled.current = true
		const folderId = search.folderId ?? 'inbox'
		// Land on the page first, so a reply finds its thread to sit in.
		const landed = search.threadId
			? navigate({
					to: '/mail/f/$folderId/t/$threadId',
					params: { folderId, threadId: search.threadId },
					replace: true,
				})
			: navigate({ to: '/mail/f/$folderId', params: { folderId }, replace: true })
		void landed.then(() => openCompose(composeRequestFromLink(search)))
	}, [navigate, openCompose, search])

	return null
}
