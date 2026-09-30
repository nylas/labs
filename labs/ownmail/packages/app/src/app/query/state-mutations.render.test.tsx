// @vitest-environment jsdom
import type { Contact, Event } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
	createContact: vi.fn(),
	createEvent: vi.fn(),
	deleteContact: vi.fn(),
	deleteDraft: vi.fn(),
	deleteEvent: vi.fn(),
	getContacts: vi.fn(),
	markThreadRead: vi.fn(),
	rsvpEvent: vi.fn(),
	saveDraft: vi.fn(),
	sendDraft: vi.fn(),
	updateContact: vi.fn(),
	updateEvent: vi.fn(),
	updateThreadState: vi.fn(),
}))

vi.mock('#features/calendar/server/calendar-fns', () => ({
	createEvent: api.createEvent,
	deleteEvent: api.deleteEvent,
	getEvents: vi.fn(),
	rsvpEvent: api.rsvpEvent,
	updateEvent: api.updateEvent,
}))
vi.mock('#server/fns', () => ({
	createContact: api.createContact,
	deleteContact: api.deleteContact,
	deleteDraft: api.deleteDraft,
	getContact: vi.fn(),
	getContacts: api.getContacts,
	getMailboxInfo: vi.fn(),
	markThreadRead: api.markThreadRead,
	saveDraft: api.saveDraft,
	sendDraft: api.sendDraft,
	updateContact: api.updateContact,
	updateThreadState: api.updateThreadState,
}))

import {
	type CalendarRouteData,
	calendarKeys,
	useCreateEventMutation,
	useDeleteEventMutation,
	useRsvpEventMutation,
	useUpdateEventMutation,
} from '#features/calendar/state/calendar-state'
import {
	type ContactsPages,
	contactsKeys,
	useContactsPages,
	useCreateContactMutation,
	useDeleteContactMutation,
	useUpdateContactMutation,
} from '#features/contacts/state/contacts-state'
import {
	markThreadReadOnOpen,
	openThreadDetail,
	useDeleteDraftMutation,
	useSaveDraftMutation,
	useSendDraftMutation,
	useUpdateThreadMutation,
} from '#features/mail/state/mail-mutations'
import {
	type MailDraft,
	type MailFolder,
	type MailThreadListData,
	mailKeys,
} from '#features/mail/state/mail-queries'

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={client}>{children}</QueryClientProvider>
)
const event = {
	id: 'event-1',
	calendar_id: 'calendar-1',
	title: 'Planning',
	when: { object: 'timespan', start_time: 100, end_time: 200 },
	participants: [{ email: 'one@example.com' }, { email: 'two@example.com' }],
} as Event
const calendarData = { events: [event] } as CalendarRouteData
const contact = { id: 'contact-1', given_name: 'Ada' } as Contact
const contactPages = { pages: [{ contacts: [contact] }], pageParams: [undefined] } as ContactsPages
const draft = { id: 'draft-1', subject: 'Draft' } as MailDraft
const folders = [{ id: 'drafts', total_count: 1 }] as MailFolder[]

beforeEach(() => {
	vi.clearAllMocks()
	client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
	client.setQueryData(calendarKeys.range(1, 2), calendarData)
	client.setQueryData(contactsKeys.list(), contactPages)
	client.setQueryData(contactsKeys.detail(contact.id), contact)
	client.setQueryData(mailKeys.drafts(), [draft])
	client.setQueryData(mailKeys.folders(), folders)
	client.setQueryData<MailThreadListData>(mailKeys.threadList({ folderId: 'inbox' }), {
		pages: [{ threads: [{ id: 'thread-1', folders: ['inbox'], unread: true }] }],
		pageParams: [undefined],
	})
})

afterEach(cleanup)

describe('calendar mutation hooks', () => {
	it('reconciles create/update/delete/rsvp fallback receipts', async () => {
		api.createEvent.mockResolvedValue({ eventId: 'event-2' })
		api.updateEvent.mockResolvedValue({ eventId: event.id })
		api.deleteEvent.mockResolvedValue({ removedEventId: event.id })
		api.rsvpEvent.mockResolvedValue({ eventId: event.id, status: 'yes' })
		const create = renderHook(() => useCreateEventMutation(), { wrapper }).result
		await act(() => create.current.mutateAsync({ title: 'Created', startTime: 300, endTime: 400 }))
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events).toContainEqual(
			expect.objectContaining({ id: 'event-2', title: 'Created' }),
		)

		const update = renderHook(() => useUpdateEventMutation(event), { wrapper }).result
		await act(() =>
			update.current.mutateAsync({
				eventId: event.id,
				title: 'Updated',
				location: 'HQ',
				description: 'Notes',
			}),
		)
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events[0]).toMatchObject({
			title: 'Updated',
			location: 'HQ',
			description: 'Notes',
		})

		const rsvp = renderHook(() => useRsvpEventMutation(event.id), { wrapper }).result
		await act(() => rsvp.current.mutateAsync({ eventId: event.id, status: 'yes' }))
		expect(
			client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events[0]?.participants?.[0]?.status,
		).toBe('yes')
		expect(
			client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events[0]?.participants?.[1]?.status,
		).toBeUndefined()

		const remove = renderHook(() => useDeleteEventMutation(event.id), { wrapper }).result
		await act(() => remove.current.mutateAsync({ eventId: event.id }))
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events).not.toContainEqual(event)
	})

	it('uses canonical event receipts and rolls back a failed optimistic update', async () => {
		const canonical = { ...event, title: 'Canonical' }
		api.createEvent.mockResolvedValue({ eventId: canonical.id, event: canonical })
		const create = renderHook(() => useCreateEventMutation(), { wrapper }).result
		await act(() =>
			create.current.mutateAsync({
				title: 'Local',
				startTime: 300,
				endTime: 400,
			}),
		)
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events).toContainEqual(canonical)
		api.updateEvent.mockResolvedValue({
			eventId: event.id,
			event: { ...canonical, location: 'Canonical HQ' },
		})
		const canonicalUpdate = renderHook(() => useUpdateEventMutation(canonical), { wrapper }).result
		await act(() =>
			canonicalUpdate.current.mutateAsync({
				eventId: event.id,
				location: 'Local HQ',
				startTime: 500,
				endTime: 600,
			}),
		)
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events[0]?.location).toBe(
			'Canonical HQ',
		)

		api.updateEvent.mockRejectedValue(new Error('offline'))
		const update = renderHook(() => useUpdateEventMutation(event), { wrapper }).result
		await expect(
			act(() => update.current.mutateAsync({ eventId: event.id, title: 'Should roll back' })),
		).rejects.toThrow('offline')
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events).toContainEqual({
			...canonical,
			location: 'Canonical HQ',
		})
	})

	it('fails closed when an update hook has no authorized event', async () => {
		const update = renderHook(() => useUpdateEventMutation(null), { wrapper }).result
		await expect(act(() => update.current.mutateAsync({ eventId: 'missing', title: 'No' }))).rejects.toThrow(
			'Event is required',
		)
	})
})

describe('contact mutation hooks', () => {
	it('uses fallback receipts for create/update and propagates delete', async () => {
		api.createContact.mockResolvedValue({ contactId: 'contact-2' })
		api.updateContact.mockResolvedValue({ contactId: contact.id })
		api.deleteContact.mockResolvedValue({ removedContactId: contact.id })
		const create = renderHook(() => useCreateContactMutation(), { wrapper }).result
		await act(() =>
			create.current.mutateAsync({
				givenName: 'Grace',
				emails: [{ email: ' grace@example.com ', type: ' work ' }],
				phoneNumbers: [{ number: ' 123 ', type: ' mobile ' }],
			}),
		)
		expect(client.getQueryData<Contact>(contactsKeys.detail('contact-2'))).toMatchObject({
			given_name: 'Grace',
			emails: [{ email: 'grace@example.com', type: 'work' }],
			phone_numbers: [{ number: '123', type: 'mobile' }],
		})

		const update = renderHook(() => useUpdateContactMutation(contact), { wrapper }).result
		await act(() => update.current.mutateAsync({ surname: 'Lovelace' }))
		expect(client.getQueryData<Contact>(contactsKeys.detail(contact.id))?.surname).toBe('Lovelace')

		const remove = renderHook(() => useDeleteContactMutation(contact.id), { wrapper }).result
		await act(() => remove.current.mutateAsync())
		expect(client.getQueryData(contactsKeys.detail(contact.id))).toBeUndefined()
	})

	it('uses canonical receipts and restores snapshots after failures', async () => {
		const canonical = { ...contact, given_name: 'Canonical' }
		api.createContact.mockResolvedValue({ contactId: canonical.id, contact: canonical })
		const create = renderHook(() => useCreateContactMutation(), { wrapper }).result
		await act(() =>
			create.current.mutateAsync({
				givenName: 'Local',
			}),
		)
		expect(client.getQueryData(contactsKeys.detail(canonical.id))).toEqual(canonical)
		api.updateContact.mockResolvedValue({
			contactId: contact.id,
			contact: { ...canonical, surname: 'Server' },
		})
		const canonicalUpdate = renderHook(() => useUpdateContactMutation(canonical), { wrapper }).result
		await act(() => canonicalUpdate.current.mutateAsync({ surname: 'Local' }))
		expect(client.getQueryData<Contact>(contactsKeys.detail(contact.id))?.surname).toBe('Server')

		api.updateContact.mockRejectedValue(new Error('offline'))
		const update = renderHook(() => useUpdateContactMutation(contact), { wrapper }).result
		await expect(act(() => update.current.mutateAsync({ givenName: 'Rollback' }))).rejects.toThrow('offline')
		expect(client.getQueryData<Contact>(contactsKeys.detail(contact.id))?.surname).toBe('Server')
	})

	it('fetches the first contact page without a cursor during explicit reconciliation', async () => {
		api.getContacts.mockResolvedValue({ contacts: [] })
		const contacts = renderHook(() => useContactsPages({ contacts: [contact] }), { wrapper }).result
		await act(() => contacts.current.refetch())
		expect(api.getContacts).toHaveBeenCalledWith({ data: {} })
	})

	it('fails closed when an update hook has no authorized contact', async () => {
		const update = renderHook(() => useUpdateContactMutation(null), { wrapper }).result
		await expect(act(() => update.current.mutateAsync({ givenName: 'No' }))).rejects.toThrow(
			'Contact is required',
		)
	})
})

describe('mail mutation hooks', () => {
	it('commits canonical receipts for thread and draft lifecycle mutations', async () => {
		api.updateThreadState.mockResolvedValue({
			thread: { id: 'thread-1', folders: ['inbox'], unread: false },
			folders: [{ id: 'inbox', unread_count: 0 }],
		})
		const updateThread = renderHook(() => useUpdateThreadMutation(), { wrapper }).result
		await act(() =>
			updateThread.current.mutateAsync({
				threadId: 'thread-1',
				unread: false,
			}),
		)

		api.saveDraft.mockResolvedValue({
			draftId: draft.id,
			draft: { id: draft.id, grant_id: 'private', subject: 'Canonical' },
			created: false,
			folders: [{ id: 'drafts', total_count: 1 }],
		})
		const save = renderHook(() => useSaveDraftMutation(), { wrapper }).result
		await act(() =>
			save.current.mutateAsync({
				draftId: draft.id,
				to: '',
				subject: 'Local',
				body: '',
			}),
		)
		expect(client.getQueryData<MailDraft[]>(mailKeys.drafts())?.[0]).toEqual({
			id: draft.id,
			subject: 'Canonical',
		})

		api.sendDraft.mockResolvedValue({
			removedDraftId: draft.id,
			message: { id: 'message-1', grant_id: 'private', folders: ['sent'] },
			folders: [{ id: 'drafts', total_count: 0 }],
		})
		const send = renderHook(() => useSendDraftMutation(), { wrapper }).result
		await act(() =>
			send.current.mutateAsync({
				draftId: draft.id,
				to: 'you@example.com',
				subject: 'Sent',
				body: 'Body',
			}),
		)
		expect(client.getQueryData<MailDraft[]>(mailKeys.drafts())).toEqual([])

		api.deleteDraft.mockResolvedValue({
			removedDraftId: draft.id,
			folders: [{ id: 'drafts', total_count: 0 }],
		})
		const removeDraft = renderHook(() => useDeleteDraftMutation(), { wrapper }).result
		await act(() => removeDraft.current.mutateAsync(draft.id))
	})

	it('rolls back rejected optimistic mail operations', async () => {
		api.updateThreadState.mockRejectedValue(new Error('offline'))
		const mutation = renderHook(() => useUpdateThreadMutation(), { wrapper }).result
		await expect(
			act(() => mutation.current.mutateAsync({ threadId: 'thread-1', starred: true })),
		).rejects.toThrow('offline')
		expect(
			client.getQueryData<MailThreadListData>(mailKeys.threadList({ folderId: 'inbox' }))?.pages[0]
				?.threads[0]?.starred,
		).toBeUndefined()
	})
})

describe('marking a thread read on open', () => {
	const inboxKey = mailKeys.threadList({ folderId: 'inbox' })
	const cachedRow = () => client.getQueryData<MailThreadListData>(inboxKey)?.pages[0]?.threads[0]
	const inboxFolders = [{ id: 'inbox', unread_count: 1 }] as MailFolder[]

	beforeEach(() => client.setQueryData(mailKeys.folders(), inboxFolders))

	it('updates the row and folder badge before the provider answers, then keeps the canonical receipt', async () => {
		let answer: (value: unknown) => void = () => {}
		api.markThreadRead.mockReturnValue(new Promise((resolve) => (answer = resolve)))

		expect(markThreadReadOnOpen(client, 'thread-1')).toBe(true)
		await vi.waitFor(() => expect(cachedRow()?.unread).toBe(false))
		expect(client.getQueryData<MailFolder[]>(mailKeys.folders())?.[0]?.unread_count).toBe(0)
		expect(client.isMutating()).toBe(1)

		answer({ thread: { id: 'thread-1', grant_id: 'private', folders: ['inbox'], unread: false } })
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
		expect(api.markThreadRead).toHaveBeenCalledWith({ data: { threadId: 'thread-1' } })
		expect(cachedRow()).toEqual({ id: 'thread-1', folders: ['inbox'], unread: false })
	})

	it('sends one read per open even when the loader and reader both ask', async () => {
		api.markThreadRead.mockResolvedValue({ thread: { id: 'thread-1', unread: false } })
		expect(markThreadReadOnOpen(client, 'thread-1')).toBe(true)
		expect(markThreadReadOnOpen(client, 'thread-1')).toBe(true)
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
		expect(api.markThreadRead).toHaveBeenCalledTimes(1)
	})

	it('skips threads that are already read or not cached', () => {
		expect(markThreadReadOnOpen(client, 'unknown-thread')).toBe(false)
		expect(markThreadReadOnOpen(client, 'thread-1', { id: 'thread-1', unread: false })).toBe(false)
		expect(api.markThreadRead).not.toHaveBeenCalled()
	})

	it('restores the unread row and badge when the provider rejects the read', async () => {
		api.markThreadRead.mockRejectedValue(new Error('offline'))
		markThreadReadOnOpen(client, 'thread-1')
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
		expect(cachedRow()?.unread).toBe(true)
		expect(client.getQueryData<MailFolder[]>(mailKeys.folders())?.[0]?.unread_count).toBe(1)
	})

	it('never writes read state during server rendering', () => {
		vi.stubGlobal('window', undefined)
		try {
			expect(markThreadReadOnOpen(client, 'thread-1')).toBe(false)
		} finally {
			vi.unstubAllGlobals()
		}
		expect(api.markThreadRead).not.toHaveBeenCalled()
	})

	it('does not cancel the detail request that is loading the opened thread', async () => {
		api.markThreadRead.mockResolvedValue({ thread: { id: 'thread-1', unread: false } })
		let deliver: (value: unknown) => void = () => {}
		const detailKey = mailKeys.threadDetail('thread-1')
		const loading = client.fetchQuery({
			queryKey: detailKey,
			queryFn: () => new Promise((resolve) => (deliver = resolve)),
		})

		const opened = openThreadDetail(client, 'thread-1', { preload: false, queryKey: detailKey }, async () => {
			deliver({ thread: { id: 'thread-1', unread: true }, messages: [] })
			return (await loading) as { thread: { id: string; unread: boolean } }
		})

		// The detail was read before the provider applied the read; it must not
		// flip the reader back to unread.
		await expect(opened).resolves.toEqual({ thread: { id: 'thread-1', unread: false }, messages: [] })
		expect(client.getQueryData(detailKey)).toEqual({
			thread: { id: 'thread-1', unread: false },
			messages: [],
		})
	})

	it('aligns an uncached search selection with the read already sent', async () => {
		api.markThreadRead.mockResolvedValue({ thread: { id: 'thread-1', unread: false } })
		await expect(
			openThreadDetail(client, 'thread-1', { preload: false }, async () => ({
				thread: { id: 'thread-1', unread: true },
			})),
		).resolves.toEqual({ thread: { id: 'thread-1', unread: false } })
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
	})

	it('leaves read state untouched for hover preloads and read threads', async () => {
		const detail = { thread: { id: 'thread-1', unread: true } }
		await expect(openThreadDetail(client, 'thread-1', { preload: true }, async () => detail)).resolves.toBe(
			detail,
		)
		expect(api.markThreadRead).not.toHaveBeenCalled()
		expect(cachedRow()?.unread).toBe(true)

		api.markThreadRead.mockResolvedValue({ thread: { id: 'thread-1', unread: false } })
		const read = { thread: { id: 'thread-1', unread: false } }
		await expect(openThreadDetail(client, 'thread-1', { preload: false }, async () => read)).resolves.toBe(
			read,
		)
		const unaligned = { thread: { id: 'thread-2', unread: true } }
		await expect(
			openThreadDetail(client, 'thread-2', { preload: false }, async () => unaligned),
		).resolves.toBe(unaligned)
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
	})
})
