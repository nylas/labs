// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// TanStack Router is stubbed so the route module can be imported and its component
// rendered without a live router. `navigate` is captured to assert where the link lands.
const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	useNavigate: () => navigate,
}))

// Compose itself is app state (ComposeProvider.test.tsx); the link only asks for it.
const openCompose = vi.fn()
vi.mock('#features/mail/components/ComposeProvider', () => ({
	useCompose: () => ({ openCompose, composing: null, registerInlineSlot: () => {} }),
}))

import { composeRequestFromLink, Route } from './mail.compose.js'

afterEach(() => {
	cleanup()
})
beforeEach(() => {
	vi.clearAllMocks()
	navigate.mockResolvedValue(undefined)
	openCompose.mockResolvedValue(undefined)
})

function renderLink(search: Record<string, string>) {
	const route = Route as typeof Route & { useSearch: () => Record<string, string> }
	route.useSearch = vi.fn(() => search)
	const Component = Route.options.component as () => null
	return render(<Component />)
}

describe('mail.compose validateSearch', () => {
	it('keeps only well-typed search params and drops oversized bodies to bound the URL', () => {
		const result = Route.options.validateSearch({
			draft: 'd1',
			folderId: 'inbox',
			threadId: 't1',
			to: 'a@b.com',
			subject: 'Hi',
			body: 'short body',
			replyToMessageId: 'm9',
		})
		expect(result).toEqual({
			draft: 'd1',
			folderId: 'inbox',
			threadId: 't1',
			to: 'a@b.com',
			subject: 'Hi',
			body: 'short body',
			replyToMessageId: 'm9',
		})
	})

	it('rejects non-string values and bodies over 4000 chars so bad input never reaches the composer', () => {
		const result = Route.options.validateSearch({
			draft: 123,
			folderId: null,
			threadId: undefined,
			to: {},
			subject: [],
			body: 'x'.repeat(4001),
			replyToMessageId: 7,
		})
		expect(result).toEqual({})
	})
})

describe('composeRequestFromLink', () => {
	it('opens a saved draft by id, ignoring any other fields the link carries', () => {
		// The draft's own saved fields win; the link only says which draft.
		expect(composeRequestFromLink({ draft: 'd1', to: 'a@b.com', subject: 'Hi', threadId: 't1' })).toEqual({
			kind: 'draft',
			draftId: 'd1',
		})
	})

	it('makes a reply of a link with a reply-to id, carrying every field', () => {
		expect(
			composeRequestFromLink({
				folderId: 'inbox',
				threadId: 't1',
				to: 'a@b.com',
				subject: 'Re: Hi',
				body: 'quoted',
				replyToMessageId: 'm9',
			}),
		).toEqual({
			kind: 'reply',
			threadId: 't1',
			to: 'a@b.com',
			subject: 'Re: Hi',
			body: 'quoted',
			replyToMessageId: 'm9',
		})
	})

	it('keeps a reply a reply even when only its reply-to id survives validation', () => {
		expect(composeRequestFromLink({ replyToMessageId: 'm9' })).toEqual({
			kind: 'reply',
			replyToMessageId: 'm9',
		})
	})

	it('makes a new message of a prefilled link without a reply-to id', () => {
		expect(composeRequestFromLink({ subject: 'Fwd: Hi', body: 'forwarded' })).toEqual({
			kind: 'new',
			subject: 'Fwd: Hi',
			body: 'forwarded',
		})
		expect(composeRequestFromLink({ to: 'x@y.com' })).toEqual({ kind: 'new', to: 'x@y.com' })
	})

	it('opens a blank new message for a bare link, leaving out empty fields', () => {
		// The folder is where the link lands, not part of the message.
		expect(composeRequestFromLink({})).toEqual({ kind: 'new' })
		expect(composeRequestFromLink({ folderId: 'starred', to: '', subject: '' })).toEqual({ kind: 'new' })
	})
})

describe('mail.compose link', () => {
	it('replaces itself with the conversation it names, then opens the reply there', async () => {
		let land: () => void = () => {}
		navigate.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				land = resolve
			}),
		)
		renderLink({ folderId: 'archive', threadId: 't1', replyToMessageId: 'm9', subject: 'Re: Hi' })

		// Replace, not push: Back must not return to a URL that reopens the composer.
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'archive', threadId: 't1' },
			replace: true,
		})
		// The reply waits for its thread to be on screen, so it can sit inside it.
		expect(openCompose).not.toHaveBeenCalled()

		await act(async () => {
			land()
		})
		expect(openCompose).toHaveBeenCalledWith({
			kind: 'reply',
			threadId: 't1',
			subject: 'Re: Hi',
			replyToMessageId: 'm9',
		})
	})

	it('lands on the inbox when the link names no folder or conversation', async () => {
		renderLink({ to: 'a@b.com' })

		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId',
			params: { folderId: 'inbox' },
			replace: true,
		})
		await act(async () => {})
		expect(openCompose).toHaveBeenCalledWith({ kind: 'new', to: 'a@b.com' })
	})

	it('lands on the folder it names', async () => {
		renderLink({ folderId: 'drafts', draft: 'd1' })

		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId',
			params: { folderId: 'drafts' },
			replace: true,
		})
		await act(async () => {})
		expect(openCompose).toHaveBeenCalledWith({ kind: 'draft', draftId: 'd1' })
	})

	it('acts on the link once, even when it renders again', async () => {
		const view = renderLink({ subject: 'Once' })
		await act(async () => {})

		// A new search object re-runs the effect, as a router re-render would.
		;(Route as typeof Route & { useSearch: () => Record<string, string> }).useSearch = vi.fn(() => ({
			subject: 'Once',
		}))
		const Component = Route.options.component as () => null
		view.rerender(<Component />)
		await act(async () => {})

		expect(navigate).toHaveBeenCalledTimes(1)
		expect(openCompose).toHaveBeenCalledTimes(1)
	})
})
